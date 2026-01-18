export interface User {
  id: string;
  groups: string[];
}
export interface Message {
  code: number;
  data: any;
  msg: string;
}
export interface FetchConfig {
  maxWait?: number;
  hasReply?: boolean;
  /** 消息状态码，默认为 200 */
  code?: number;
  /** 消息描述，默认为 'success' */
  msg?: string;
}

/**
 * 内部消息格式
 * 用于 WebSocket 通信的消息结构
 */
export interface InternalMessage {
  /** 消息类型：'event' 表示事件消息，'reply' 表示回复消息 */
  type: 'event' | 'reply';
  /** 事件名称（当 type 为 'event' 时必需） */
  event?: string;
  /** 请求 ID（用于匹配请求和回复） */
  fetchId?: string;
  /** 消息体 */
  body: Message;
  /** 消息头部信息（可选，用于传递认证、元数据等） */
  header?: Record<string, string>;
}

/**
 * 待处理的请求信息
 * 用于存储等待回复的请求 Promise
 */
export interface PendingFetch {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: ReturnType<typeof setTimeout>;
}
