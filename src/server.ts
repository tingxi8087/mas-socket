import { WebSocket, WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import type { Express } from 'express';
import type { Server as HttpServer } from 'http';
import type {
  FetchConfig,
  User,
  Message,
  InternalMessage,
  PendingFetch,
} from './type';

/**
 * 客户端连接信息
 */
interface ClientConnection {
  ws: WebSocket;
  user: User;
}

/**
 * 事件处理器类型
 */
type EventHandler = (args: {
  reply: (data: any) => void;
  body: Message;
  user: User;
  fetchId: string;
  header: Record<string, string>;
  event: string;
}) => Promise<void>;

/**
 * MasSocket 服务器类
 * 用于管理 WebSocket 连接、消息路由和客户端通信
 */
class MasSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ClientConnection> = new Map();
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private middlewares: EventHandler[] = [];
  private pendingFetches: Map<string, PendingFetch> = new Map();
  /** 反向索引：客户端 ID -> 该客户端的所有待处理请求 ID 集合 */
  private clientPendingFetches: Map<string, Set<string>> = new Map();
  /** 缓存的客户端列表 */
  private _cachedClientsList: User[] | null = null;

  constructor() {}

  /**
   * 默认的请求配置
   * 当调用 fetch 或 fetchByGroup 时，如果没有提供 config 参数，将使用此配置
   */
  fetchConfig: FetchConfig = {
    maxWait: 10000,
    hasReply: true,
    code: 200,
    msg: 'success',
  };

  /**
   * 最大消息大小（字节），默认 1MB
   * 超过此大小的消息将被拒绝
   */
  maxMessageSize: number = 1024 * 1024; // 1MB

  /**
   * 当前连接的客户端列表
   * 存储所有已连接的客户端信息
   */
  get clientsList(): User[] {
    if (this._cachedClientsList === null) {
      this._cachedClientsList = Array.from(this.clients.values()).map(
        (conn) => conn.user
      );
    }
    return this._cachedClientsList;
  }

  /**
   * 更新客户端列表缓存
   */
  private updateClientsListCache(): void {
    this._cachedClientsList = Array.from(this.clients.values()).map(
      (conn) => conn.user
    );
  }

  /**
   * 客户端分组映射（内部使用 Set 以提高性能）
   * key: 组名, value: 该组内的客户端 ID Set
   * 用于按组管理客户端，方便批量操作
   * 
   * 注意：为了保持向后兼容，通过 getter 提供数组访问
   */
  private _groups: Record<string, Set<string>> = {};

  /**
   * 客户端分组映射（兼容数组访问）
   * 提供数组形式的访问以保持向后兼容
   */
  get groups(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [group, members] of Object.entries(this._groups)) {
      result[group] = Array.from(members);
    }
    return result;
  }

  /**
   * 客户端连接时的回调函数
   * 当有新的客户端成功连接到服务器时触发
   * @param client - 新连接的客户端用户信息
   */
  onConnect = (_client: User) => {};

  /**
   * 客户端断开连接时的回调函数
   * 当客户端断开连接时触发（包括主动断开、网络错误等）
   * @param client - 断开连接的客户端用户信息
   * @param type - 断开连接的类型（如 'close', 'error', 'timeout' 等）
   */
  onDisconnect = (_client: User, _type: string) => {};

  /**
   * 生成唯一的请求 ID
   */
  private generateFetchId(): string {
    return randomUUID();
  }

  /**
   * 发送消息到客户端
   */
  private sendMessage(ws: WebSocket, message: InternalMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * 清理客户端连接
   */
  private cleanupClient(clientId: string): void {
    const connection = this.clients.get(clientId);
    if (!connection) return;

    // 清理该客户端的所有待处理请求（使用反向索引，O(1) 查找）
    const pendingFetchIds = this.clientPendingFetches.get(clientId);
    if (pendingFetchIds) {
      for (const fetchId of pendingFetchIds) {
        const pending = this.pendingFetches.get(fetchId);
        if (pending) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('Client disconnected'));
          this.pendingFetches.delete(fetchId);
        }
      }
      this.clientPendingFetches.delete(clientId);
    }

    // 从分组中移除（使用 Set，O(1) 删除）
    const user = connection.user;
    for (const group of user.groups) {
      const groupMembers = this._groups[group];
      if (groupMembers) {
        groupMembers.delete(clientId);
        if (groupMembers.size === 0) {
          delete this._groups[group];
        }
      }
    }

    // 从客户端列表中移除
    this.clients.delete(clientId);
    
    // 更新缓存
    this.updateClientsListCache();
  }

  /**
   * 处理收到的消息
   */
  private async handleMessage(
    ws: WebSocket,
    user: User,
    rawMessage: string
  ): Promise<void> {
    // 检查消息大小
    const messageSize = Buffer.byteLength(rawMessage, 'utf8');
    if (messageSize > this.maxMessageSize) {
      this.sendMessage(ws, {
        type: 'reply',
        body: {
          code: 413,
          data: null,
          msg: `Message too large. Maximum size is ${this.maxMessageSize} bytes`,
        },
      });
      return;
    }

    let message: InternalMessage;
    try {
      message = JSON.parse(rawMessage) as InternalMessage;
    } catch (_error) {
      // 消息解析失败，发送错误回复
      this.sendMessage(ws, {
        type: 'reply',
        body: {
          code: 400,
          data: null,
          msg: 'Invalid message format',
        },
      });
      return;
    }

    const { type, event, fetchId = '', body, header = {} } = message;

    // 如果是回复消息，处理待处理的请求
    if (type === 'reply' && fetchId) {
      const pending = this.pendingFetches.get(fetchId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingFetches.delete(fetchId);
        
        // 清理反向索引
        const clientPendingSet = this.clientPendingFetches.get(
          pending.clientId
        );
        if (clientPendingSet) {
          clientPendingSet.delete(fetchId);
          if (clientPendingSet.size === 0) {
            this.clientPendingFetches.delete(pending.clientId);
          }
        }
        
        pending.resolve(body);
      }
      return;
    }

    // 如果是事件消息，执行中间件和事件处理器
    if (type === 'event' && event) {
      let replied = false;
      const reply = (data: any) => {
        if (replied) return;
        replied = true;
        this.sendMessage(ws, {
          type: 'reply',
          fetchId,
          body: data,
        });
      };

      // 执行中间件
      for (const middleware of this.middlewares) {
        if (replied) break;
        try {
          await middleware({
            reply,
            body,
            user,
            fetchId,
            header,
            event,
          });
        } catch (error) {
          console.error('Middleware error:', error);
          if (!replied) {
            reply({
              code: 500,
              data: null,
              msg: 'Middleware error',
            });
          }
          return;
        }
      }

      // 执行事件处理器
      if (!replied) {
        const handlers = this.eventHandlers.get(event) || [];
        for (const handler of handlers) {
          if (replied) break;
          try {
            await handler({
              reply,
              body,
              user,
              fetchId,
              header,
              event,
            });
          } catch (error) {
            console.error(`Event handler error for ${event}:`, error);
            if (!replied) {
              reply({
                code: 500,
                data: null,
                msg: 'Handler error',
              });
            }
            return;
          }
        }

        // 如果没有处理器且需要回复，发送默认回复
        if (!replied && fetchId) {
          reply({
            code: 404,
            data: null,
            msg: `No handler for event: ${event}`,
          });
        }
      }
    }
  }

  /**
   * 将客户端添加到指定组
   * 客户端可以属于多个组，用于分组管理和消息广播
   * @param group - 组名
   * @param id - 客户端 ID
   */
  addGroup(group: string, id: string): void {
    if (!this.clients.has(id)) {
      throw new Error(`Client ${id} not found`);
    }

    // 添加到分组映射（使用 Set，O(1) 添加和查找）
    if (!this._groups[group]) {
      this._groups[group] = new Set();
    }
    this._groups[group].add(id);

    // 更新用户信息
    const connection = this.clients.get(id);
    if (connection) {
      if (!connection.user.groups.includes(group)) {
        connection.user.groups.push(group);
      }
    }
  }

  /**
   * 将客户端从指定组中移除
   * @param group - 组名
   * @param id - 客户端 ID
   */
  removeGroup(group: string, id: string): void {
    if (!this.clients.has(id)) {
      throw new Error(`Client ${id} not found`);
    }

    // 从分组映射中移除（使用 Set，O(1) 删除）
    if (this._groups[group]) {
      this._groups[group].delete(id);
      // 如果组为空，删除该组
      if (this._groups[group].size === 0) {
        delete this._groups[group];
      }
    }

    // 更新用户信息
    const connection = this.clients.get(id);
    if (connection) {
      const userGroupIndex = connection.user.groups.indexOf(group);
      if (userGroupIndex > -1) {
        connection.user.groups.splice(userGroupIndex, 1);
      }
    }
  }

  /**
   * 关闭所有客户端连接
   * 断开所有当前连接的客户端
   */
  closeAll(): void {
    for (const [id, connection] of this.clients.entries()) {
      connection.ws.close();
      this.cleanupClient(id);
    }
  }

  /**
   * 关闭指定组内的所有客户端连接
   * 根据组名批量关闭该组内所有客户端的连接
   * @param groups - 要关闭的组名数组
   */
  closeByGroups(groups: string[]): void {
    const clientIds = new Set<string>();
    for (const group of groups) {
      const members = this._groups[group];
      if (members) {
        for (const id of members) {
          clientIds.add(id);
        }
      }
    }
    this.close(Array.from(clientIds));
  }

  /**
   * 关闭指定的客户端连接
   * 可以传入单个客户端 ID 或 ID 数组来关闭对应的连接
   * @param ids - 要关闭的客户端 ID 或 ID 数组
   */
  close(ids: string[] | string): void {
    const idArray = Array.isArray(ids) ? ids : [ids];
    for (const id of idArray) {
      const connection = this.clients.get(id);
      if (connection) {
        connection.ws.close();
        this.cleanupClient(id);
      }
    }
  }

  /**
   * 向指定客户端发送请求并等待回复
   * 类似于 HTTP 请求-响应模式，发送消息后等待客户端回复
   * @param id - 目标客户端 ID 或 ID 数组（支持批量请求）
   * @param event - 事件名称，用于标识请求类型
   * @param data - 要发送的数据
   * @param config - 可选的请求配置（如超时时间、是否需要回复等）
   * @returns 返回 Promise，resolve 时包含客户端的回复数据
   */
  fetch = async (
    id: string[] | string,
    event: string,
    data: any,
    config?: FetchConfig
  ): Promise<any> => {
    const ids = Array.isArray(id) ? id : [id];
    const finalConfig = { ...this.fetchConfig, ...config };
    const {
      maxWait = 10000,
      hasReply = true,
      code = 200,
      msg = 'success',
    } = finalConfig;

    // 如果没有需要回复，直接发送并返回
    if (!hasReply) {
      for (const clientId of ids) {
        const connection = this.clients.get(clientId);
        if (connection) {
          this.sendMessage(connection.ws, {
            type: 'event',
            event,
            body: {
              code,
              data,
              msg,
            },
          });
        }
      }
      return;
    }

    // 需要回复，创建 Promise
    const promises: Promise<any>[] = [];

    for (const clientId of ids) {
      const connection = this.clients.get(clientId);
      if (!connection) {
        promises.push(
          Promise.reject(new Error(`Client ${clientId} not found`))
        );
        continue;
      }

      const fetchId = this.generateFetchId();
      const promise = new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          // 清理反向索引
          const pending = this.pendingFetches.get(fetchId);
          if (pending) {
            const clientPendingSet = this.clientPendingFetches.get(
              pending.clientId
            );
            if (clientPendingSet) {
              clientPendingSet.delete(fetchId);
              if (clientPendingSet.size === 0) {
                this.clientPendingFetches.delete(pending.clientId);
              }
            }
          }
          this.pendingFetches.delete(fetchId);
          reject(new Error(`Request timeout after ${maxWait}ms`));
        }, maxWait);

        const pendingFetch: PendingFetch = {
          resolve: (value: any) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (reason?: any) => {
            clearTimeout(timeout);
            reject(reason);
          },
          timeout,
          clientId,
        };

        this.pendingFetches.set(fetchId, pendingFetch);

        // 更新反向索引
        if (!this.clientPendingFetches.has(clientId)) {
          this.clientPendingFetches.set(clientId, new Set());
        }
        this.clientPendingFetches.get(clientId)!.add(fetchId);
      });

      promises.push(promise);

      // 发送消息
      this.sendMessage(connection.ws, {
        type: 'event',
        event,
        fetchId,
        body: {
          code,
          data,
          msg,
        },
      });
    }

    // 如果只有一个请求，直接返回结果
    if (promises.length === 1) {
      return promises[0];
    }

    // 多个请求，返回所有结果
    return Promise.all(promises);
  };

  /**
   * 向指定组内的所有客户端发送请求并等待回复
   * 向组内所有客户端发送消息，并收集所有回复
   * @param group - 目标组名或组名数组（支持多个组）
   * @param event - 事件名称，用于标识请求类型
   * @param data - 要发送的数据
   * @param config - 可选的请求配置（如超时时间、是否需要回复等）
   * @returns 返回 Promise，resolve 时包含所有客户端的回复数据
   */
  fetchByGroup = async (
    group: string | string[],
    event: string,
    data: any,
    config?: FetchConfig
  ): Promise<any> => {
    const groups = Array.isArray(group) ? group : [group];
    const clientIds = new Set<string>();

    // 收集所有组内的客户端 ID（使用 Set，O(1) 查找）
    for (const groupName of groups) {
      const members = this._groups[groupName];
      if (members) {
        for (const id of members) {
          clientIds.add(id);
        }
      }
    }

    if (clientIds.size === 0) {
      return [];
    }

    return this.fetch(Array.from(clientIds), event, data, config);
  };

  /**
   * 将 WebSocket 服务器绑定到 Express 应用或 HTTP 服务器
   * 将 WebSocket 功能集成到现有的 Express 应用中
   * @param appOrServer - Express 应用实例或 HTTP 服务器实例
   */
  bind(appOrServer: Express | HttpServer): void {
    let server: HttpServer;

    // 判断是 Express app 还是 HTTP Server
    // Express app 有 use、get、post 等路由方法，HTTP Server 没有
    const isExpressApp =
      typeof (appOrServer as any).use === 'function' &&
      typeof (appOrServer as any).get === 'function' &&
      typeof (appOrServer as any).post === 'function';

    if (isExpressApp) {
      // 是 Express app，尝试获取服务器实例
      // Express 5 中，app 可能还没有服务器实例，需要从 listen 返回的服务器获取
      // 或者使用 app.get('server') 获取（如果已设置）
      const expressApp = appOrServer as Express;
      const existingServer = (expressApp as any).get?.('server') as HttpServer | undefined;
      
      if (existingServer) {
        server = existingServer;
      } else {
        throw new Error(
          'Express app must have a server instance. Please call app.listen() first and pass the returned server instance, or use bind(server) instead.'
        );
      }
    } else {
      // 是 HTTP Server 实例
      server = appOrServer as HttpServer;
    }

    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', (ws: WebSocket) => {
      // 使用 randomUUID 生成唯一的客户端 ID
      const clientId = randomUUID();
      const user: User = {
        id: clientId,
        groups: [],
      };

      const connection: ClientConnection = {
        ws,
        user,
      };

      this.clients.set(clientId, connection);

      // 更新缓存
      this.updateClientsListCache();

      // 触发连接回调
      this.onConnect(user);

      // 连接成功后，自动发送系统 ID 信息给客户端
      this.sendMessage(ws, {
        type: 'event',
        event: '_system_id',
        body: {
          code: 200,
          data: {
            id: clientId,
          },
          msg: 'Connection established',
        },
      });

      // 处理消息
      ws.on('message', (data: Buffer) => {
        this.handleMessage(ws, user, data.toString()).catch((error) => {
          console.error('Error handling message:', error);
        });
      });

      // 处理关闭
      ws.on('close', () => {
        this.cleanupClient(clientId);
        this.onDisconnect(user, 'close');
      });

      // 处理错误
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.cleanupClient(clientId);
        this.onDisconnect(user, 'error');
      });
    });
  }

  /**
   * 注册事件监听器
   * 监听客户端发送的特定事件，当收到对应事件时执行处理函数
   * @param event - 要监听的事件名称
   * @param handler - 事件处理函数
   *   - reply: 用于向客户端发送回复的函数
   *   - body: 客户端发送的消息体
   *   - user: 发送消息的客户端用户信息
   *   - fetchId: 请求的唯一标识符（用于匹配请求和回复）
   *   - header: 消息的头部信息（可能包含认证、元数据等）
   */
  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  /**
   * 注册中间件
   * 中间件会在所有事件处理之前执行，可以用于认证、日志、数据转换等
   * 可以注册多个中间件，它们会按注册顺序依次执行
   * @param handler - 中间件处理函数
   *   - reply: 用于向客户端发送回复的函数
   *   - body: 客户端发送的消息体
   *   - user: 发送消息的客户端用户信息
   *   - fetchId: 请求的唯一标识符
   *   - header: 消息的头部信息
   */
  use(handler: EventHandler): void {
    this.middlewares.push(handler);
  }
}

export default MasSocketServer;
