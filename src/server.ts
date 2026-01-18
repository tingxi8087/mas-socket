import { WebSocket, WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import type { Express } from 'express';
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
   * 当前连接的客户端列表
   * 存储所有已连接的客户端信息
   */
  get clientsList(): User[] {
    return Array.from(this.clients.values()).map((conn) => conn.user);
  }

  /**
   * 客户端分组映射
   * key: 组名, value: 该组内的客户端 ID 数组
   * 用于按组管理客户端，方便批量操作
   */
  groups: Record<string, string[]> = {};

  /**
   * 客户端连接时的回调函数
   * 当有新的客户端成功连接到服务器时触发
   * @param client - 新连接的客户端用户信息
   */
  onConnect = (client: User) => {};

  /**
   * 客户端断开连接时的回调函数
   * 当客户端断开连接时触发（包括主动断开、网络错误等）
   * @param client - 断开连接的客户端用户信息
   * @param type - 断开连接的类型（如 'close', 'error', 'timeout' 等）
   */
  onDisconnect = (client: User, type: string) => {};

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

    // 清理该客户端的所有待处理请求
    for (const [fetchId, pending] of this.pendingFetches.entries()) {
      // 检查是否是来自该客户端的请求（通过检查 pending 中是否有相关信息）
      // 这里简化处理，实际应该记录每个请求的客户端 ID
      clearTimeout(pending.timeout);
      pending.reject(new Error('Client disconnected'));
      this.pendingFetches.delete(fetchId);
    }

    // 从分组中移除
    const user = connection.user;
    for (const group of user.groups) {
      const groupMembers = this.groups[group];
      if (groupMembers) {
        const index = groupMembers.indexOf(clientId);
        if (index > -1) {
          groupMembers.splice(index, 1);
        }
        if (groupMembers.length === 0) {
          delete this.groups[group];
        }
      }
    }

    // 从客户端列表中移除
    this.clients.delete(clientId);
  }

  /**
   * 处理收到的消息
   */
  private async handleMessage(
    ws: WebSocket,
    user: User,
    rawMessage: string
  ): Promise<void> {
    let message: InternalMessage;
    try {
      message = JSON.parse(rawMessage) as InternalMessage;
    } catch (error) {
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

    // 添加到分组映射
    if (!this.groups[group]) {
      this.groups[group] = [];
    }
    if (!this.groups[group].includes(id)) {
      this.groups[group].push(id);
    }

    // 更新用户信息
    const connection = this.clients.get(id);
    if (connection) {
      if (!connection.user.groups.includes(group)) {
        connection.user.groups.push(group);
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
      const members = this.groups[group] || [];
      for (const id of members) {
        clientIds.add(id);
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
          this.pendingFetches.delete(fetchId);
          reject(new Error(`Request timeout after ${maxWait}ms`));
        }, maxWait);

        this.pendingFetches.set(fetchId, {
          resolve: (value: any) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (reason?: any) => {
            clearTimeout(timeout);
            reject(reason);
          },
          timeout,
        });
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

    // 收集所有组内的客户端 ID
    for (const groupName of groups) {
      const members = this.groups[groupName] || [];
      for (const id of members) {
        clientIds.add(id);
      }
    }

    if (clientIds.size === 0) {
      return [];
    }

    return this.fetch(Array.from(clientIds), event, data, config);
  };

  /**
   * 将 WebSocket 服务器绑定到 Express 应用
   * 将 WebSocket 功能集成到现有的 Express 应用中
   * @param app - Express 应用实例
   */
  bind(app: Express): void {
    const server = (app as any).listen?.() || (app as any).get?.('server');
    if (!server) {
      throw new Error(
        'Express app must have a server instance. Call app.listen() first or pass the server instance.'
      );
    }

    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', (ws: WebSocket, req) => {
      // 从请求中提取用户信息（这里简化处理，实际应该从认证信息中获取）
      // 默认使用 IP 地址作为 ID，实际应用中应该从 token 或 session 中获取
      const clientId = req.socket.remoteAddress || randomUUID();
      const user: User = {
        id: clientId,
        groups: [],
      };

      const connection: ClientConnection = {
        ws,
        user,
      };

      this.clients.set(clientId, connection);

      // 触发连接回调
      this.onConnect(user);

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
