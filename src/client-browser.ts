import type { FetchConfig, Message, InternalMessage, PendingFetch } from './type';

/**
 * 服务器客户端配置接口
 * 用于配置客户端的连接行为
 */
interface ServerClinetConfig {
  /** 最大重连次数，当连接断开时会自动尝试重连，超过此次数后停止重连 */
  maxReconnectCount: number;
  /** 最大连接超时时间（毫秒），连接服务器时的超时限制 */
  maxConnectTimeout: number;
}

/**
 * 静态服务器客户端配置接口
 * 包含连接状态和 URL 信息
 */
interface staticServerClinetConfig {
  /** WebSocket 服务器地址 */
  url: string;
  /** 当前连接状态 */
  status: 'connecting' | 'connected' | 'disconnected';
}

/**
 * 完整的客户端配置类型
 * 合并了可配置项和静态状态
 */
type MasSocketServerClinetConfig = ServerClinetConfig &
  staticServerClinetConfig;

/**
 * 事件处理器类型
 */
type EventHandler = (args: {
  reply: (data: any) => void;
  body: Message;
  fetchId: string;
  header: Record<string, string>;
}) => Promise<void>;

/**
 * MasSocket 客户端类（浏览器版本）
 * 使用浏览器原生 WebSocket，无需额外依赖
 */
class MasSocketClinet {
  private ws: WebSocket | null = null;
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private middlewares: EventHandler[] = [];
  private pendingFetches: Map<string, PendingFetch> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectCount: number = 0;
  private shouldReconnect: boolean = false;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {}

  /**
   * 客户端私有配置
   * 包含连接参数和当前状态
   */
  private config: MasSocketServerClinetConfig = {
    maxReconnectCount: 5,
    maxConnectTimeout: 10000,
    url: '',
    status: 'disconnected',
  };

  /**
   * 默认的请求配置
   * 当调用 fetch 时，如果没有提供 config 参数，将使用此配置
   */
  fetchConfig: FetchConfig = {
    maxWait: 10000,
    hasReply: true,
    code: 200,
    msg: 'success',
  };

  /**
   * 生成唯一的请求 ID
   */
  private generateFetchId(): string {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
      return cryptoApi.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  /**
   * 发送消息到服务器
   */
  private sendMessage(message: InternalMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      throw new Error('WebSocket is not connected');
    }
  }

  /**
   * 处理收到的消息
   */
  private async handleMessage(rawMessage: string): Promise<void> {
    let message: InternalMessage;
    try {
      message = JSON.parse(rawMessage) as InternalMessage;
    } catch (error) {
      console.error('Failed to parse message:', error);
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
        this.sendMessage({
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
   * 设置 WebSocket 连接
   */
  private setupWebSocket(): void {
    if (!this.config.url) {
      throw new Error('URL is not set');
    }

    // 清除连接超时
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }

    // 设置连接超时
    this.connectTimeout = setTimeout(() => {
      if (this.config.status === 'connecting') {
        this.ws?.close();
        this.handleReconnect();
      }
    }, this.config.maxConnectTimeout);

    this.ws = new WebSocket(this.config.url);

    this.ws.addEventListener('open', () => {
      if (this.connectTimeout) {
        clearTimeout(this.connectTimeout);
        this.connectTimeout = null;
      }
      this.config.status = 'connected';
      this.reconnectCount = 0;
    });

    this.ws.addEventListener('message', async (event) => {
      let data: string | null = null;
      const payload = event.data;

      if (typeof payload === 'string') {
        data = payload;
      } else if (payload instanceof Blob) {
        data = await payload.text();
      } else if (payload instanceof ArrayBuffer) {
        data = new TextDecoder().decode(payload);
      } else if (ArrayBuffer.isView(payload)) {
        data = new TextDecoder().decode(payload.buffer);
      }

      if (data === null) {
        console.error('Unsupported message data type');
        return;
      }

      this.handleMessage(data).catch((error) => {
        console.error('Error handling message:', error);
      });
    });

    this.ws.addEventListener('close', () => {
      this.config.status = 'disconnected';
      this.onDisconnect();
      this.handleReconnect();
    });

    this.ws.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      if (this.connectTimeout) {
        clearTimeout(this.connectTimeout);
        this.connectTimeout = null;
      }
      this.config.status = 'disconnected';
      this.onDisconnect();
      this.handleReconnect();
    });
  }

  /**
   * 处理自动重连
   */
  private handleReconnect(): void {
    if (!this.shouldReconnect) {
      return;
    }

    if (this.reconnectCount >= this.config.maxReconnectCount) {
      console.error(
        `Max reconnect count (${this.config.maxReconnectCount}) reached`
      );
      this.shouldReconnect = false;
      return;
    }

    this.reconnectCount++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectCount - 1), 30000);

    this.reconnectTimer = setTimeout(() => {
      if (this.shouldReconnect && this.config.status === 'disconnected') {
        this.config.status = 'connecting';
        this.setupWebSocket();
      }
    }, delay);
  }

  /**
   * 清理所有待处理的请求
   */
  private cleanupPendingFetches(): void {
    for (const [fetchId, pending] of this.pendingFetches.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
      this.pendingFetches.delete(fetchId);
    }
  }

  /**
   * 获取当前客户端配置
   * 返回当前的配置信息（包括连接状态、URL 等）
   * @returns 返回当前的完整配置对象
   */
  getConfig = (): MasSocketServerClinetConfig => {
    return { ...this.config };
  };

  /**
   * 设置客户端配置
   * 更新客户端的连接行为参数（如重连次数、超时时间等）
   * @param config - 要更新的配置项（部分更新，不需要提供所有字段）
   */
  setConfig = (config: Partial<ServerClinetConfig>): void => {
    this.config = {
      ...this.config,
      ...config,
    };
  };

  /**
   * 连接到 WebSocket 服务器
   * 建立与指定 URL 的 WebSocket 连接，支持自动重连
   * @param url - WebSocket 服务器地址（如 'ws://localhost:3000' 或 'wss://example.com'）
   */
  connect = (url: string): void => {
    if (this.ws && this.config.status !== 'disconnected') {
      this.close();
    }

    this.config.url = url;
    this.config.status = 'connecting';
    this.shouldReconnect = true;
    this.reconnectCount = 0;
    this.setupWebSocket();
  };

  /**
   * 关闭与服务器的连接
   * 主动断开 WebSocket 连接，停止自动重连
   */
  close = (): void => {
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.config.status = 'disconnected';
    this.cleanupPendingFetches();
  };

  /**
   * 连接断开时的回调函数
   * 当与服务器的连接断开时触发（包括主动关闭、网络错误、服务器关闭等）
   */
  onDisconnect = (): void => {};

  /**
   * 向服务器发送请求并等待回复
   * 类似于 HTTP 请求-响应模式，发送消息后等待服务器回复
   * @param event - 事件名称，用于标识请求类型
   * @param data - 要发送的数据
   * @param config - 可选的请求配置（如超时时间、是否需要回复等）
   * @returns 返回 Promise，resolve 时包含服务器的回复数据
   */
  fetch = async (
    event: string,
    data: any,
    config?: FetchConfig
  ): Promise<any> => {
    if (this.config.status !== 'connected') {
      throw new Error('WebSocket is not connected');
    }

    const finalConfig = { ...this.fetchConfig, ...config };
    const {
      maxWait = 10000,
      hasReply = true,
      code = 200,
      msg = 'success',
    } = finalConfig;

    // 如果不需要回复，直接发送并返回
    if (!hasReply) {
      this.sendMessage({
        type: 'event',
        event,
        body: {
          code,
          data,
          msg,
        },
      });
      return;
    }

    // 需要回复，创建 Promise
    const fetchId = this.generateFetchId();
    const promise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingFetches.delete(fetchId);
        reject(new Error(`Request timeout after ${maxWait}ms`));
      }, maxWait);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
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

    // 发送消息
    this.sendMessage({
      type: 'event',
      event,
      fetchId,
      body: {
        code,
        data,
        msg,
      },
    });

    return promise;
  };

  /**
   * 注册事件监听器
   * 监听服务器发送的特定事件，当收到对应事件时执行处理函数
   * @param event - 要监听的事件名称
   * @param handler - 事件处理函数
   *   - reply: 用于向服务器发送回复的函数
   *   - body: 服务器发送的消息体
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
   *   - reply: 用于向服务器发送回复的函数
   *   - body: 服务器发送的消息体
   *   - fetchId: 请求的唯一标识符
   *   - header: 消息的头部信息
   */
  use(handler: EventHandler): void {
    this.middlewares.push(handler);
  }
}

// 方便 HTML 直接引用时挂载到全局
if (typeof globalThis !== 'undefined') {
  (globalThis as any).MasSocketClinet = MasSocketClinet;
}

export default MasSocketClinet;
