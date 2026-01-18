# MasSocket 架构设计文档

## 概述

MasSocket 是一个基于 WebSocket 的双向通信库，旨在提供类似 HTTP 请求-响应模式的编程体验，同时保留 WebSocket 的实时双向通信能力。该库支持客户端分组管理、中间件机制、自动重连等特性。

## 设计理念

### 核心思想

1. **请求-响应模式**：将 WebSocket 的消息传递抽象为类似 HTTP 的请求-响应模式，支持等待回复和超时控制
2. **事件驱动**：基于事件名称进行消息路由，支持灵活的事件处理机制
3. **分组管理**：支持客户端分组，便于批量操作和消息广播
4. **中间件支持**：提供中间件机制，支持认证、日志、数据转换等横切关注点
5. **类型安全**：完整的 TypeScript 类型定义，提供良好的开发体验

## 架构组件

### 1. 服务器端 (MasSocketServer)

#### 1.1 核心职责

- 管理所有客户端连接
- 处理客户端分组
- 提供请求-响应机制
- 事件路由和处理
- 中间件执行

#### 1.2 核心数据结构

```typescript
{
  clients: User[]              // 所有连接的客户端
  groups: Record<string, string[]>  // 分组映射：组名 -> 客户端ID数组
  fetchConfig: FetchConfig     // 默认请求配置
}
```

#### 1.3 主要功能模块

**连接管理**
- `onConnect`: 客户端连接回调
- `onDisconnect`: 客户端断开回调
- `close`: 关闭指定客户端
- `closeByGroups`: 按组关闭客户端
- `closeAll`: 关闭所有客户端

**分组管理**
- `addGroup`: 将客户端添加到组
- `groups`: 分组映射表

**消息通信**
- `fetch`: 向指定客户端发送请求并等待回复
- `fetchByGroup`: 向指定组的所有客户端发送请求并等待回复

**事件系统**
- `on`: 注册事件监听器
- `use`: 注册中间件

**集成**
- `bind`: 绑定到 Express 应用

### 2. 客户端 (MasSocketClinet)

#### 2.1 核心职责

- 管理与服务器的连接
- 自动重连机制
- 发送请求并等待回复
- 事件监听和处理
- 中间件支持

#### 2.2 核心数据结构

```typescript
{
  config: {
    maxReconnectCount: number      // 最大重连次数
    maxConnectTimeout: number      // 连接超时时间
    url: string                    // 服务器地址
    status: 'connecting' | 'connected' | 'disconnected'  // 连接状态
  }
  fetchConfig: FetchConfig         // 默认请求配置
}
```

#### 2.3 主要功能模块

**连接管理**
- `connect`: 连接到服务器
- `close`: 关闭连接
- `onDisconnect`: 断开连接回调
- 自动重连机制（基于 `maxReconnectCount`）

**消息通信**
- `fetch`: 向服务器发送请求并等待回复

**事件系统**
- `on`: 注册事件监听器
- `use`: 注册中间件

**配置管理**
- `getConfig`: 获取当前配置
- `setConfig`: 更新配置

## 消息协议

### 消息格式

```typescript
interface Message {
  code: string;    // 状态码或事件标识
  data: any;       // 消息数据
  msg: string;     // 消息描述
}
```

### 请求-响应流程

1. **发送请求**
   - 生成唯一的 `fetchId`
   - 构造消息体（包含 `event`、`data`、`fetchId` 等）
   - 发送到目标端

2. **等待回复**
   - 如果 `hasReply: true`，创建 Promise 并等待回复
   - 使用 `fetchId` 匹配请求和回复
   - 设置超时时间（`maxWait`）

3. **处理回复**
   - 收到回复后，通过 `fetchId` 找到对应的 Promise
   - resolve 或 reject Promise

### 事件处理流程

1. **接收消息**
   - 解析消息体
   - 提取 `event`、`data`、`fetchId`、`header` 等信息

2. **中间件执行**
   - 按注册顺序执行所有中间件
   - 中间件可以修改消息、调用 `reply` 等

3. **事件路由**
   - 根据 `event` 名称找到对应的处理器
   - 执行处理器函数

4. **发送回复**
   - 如果消息包含 `fetchId`，可以通过 `reply` 函数发送回复

## 分组机制

### 设计目的

- 批量操作：可以同时向一组客户端发送消息
- 权限管理：通过分组实现权限控制
- 业务逻辑：支持按业务场景分组（如房间、频道等）

### 实现方式

- 每个客户端可以属于多个组
- 通过 `groups` 映射表维护组和客户端的关系
- `fetchByGroup` 支持向多个组发送消息

## 中间件机制

### 设计目的

- 横切关注点：统一处理认证、日志、数据转换等
- 请求预处理：在事件处理前进行数据验证、转换
- 响应后处理：统一处理响应格式、错误处理等

### 执行顺序

```
请求消息 → 中间件1 → 中间件2 → ... → 事件处理器 → 回复
```

### 使用场景

- **认证中间件**：验证 token、权限检查
- **日志中间件**：记录请求日志、性能监控
- **数据转换中间件**：数据格式转换、加密解密
- **错误处理中间件**：统一错误处理和格式化

## 连接生命周期

### 服务器端

```
客户端连接请求
    ↓
onConnect 回调
    ↓
添加到 clients
    ↓
[正常通信]
    ↓
连接断开
    ↓
onDisconnect 回调
    ↓
从 clients 和 groups 中移除
```

### 客户端

```
调用 connect(url)
    ↓
状态: 'connecting'
    ↓
建立 WebSocket 连接
    ↓
状态: 'connected'
    ↓
[正常通信]
    ↓
连接断开
    ↓
状态: 'disconnected'
    ↓
onDisconnect 回调
    ↓
[如果未达到 maxReconnectCount]
    ↓
自动重连
```

## 错误处理

### 超时处理

- `fetch` 请求超过 `maxWait` 时间未收到回复，Promise reject
- 连接超时：超过 `maxConnectTimeout` 未建立连接，触发错误

### 重连策略

- 客户端自动重连，最多重试 `maxReconnectCount` 次
- 重连间隔可以配置（未来可扩展）

### 错误传播

- 中间件和事件处理器中的错误应该被捕获和处理
- 可以通过 `reply` 发送错误响应

## 类型系统

### 核心类型

```typescript
// 用户信息
interface User {
  id: string;
  groups: string[];
}

// 消息格式
interface Message {
  code: string;
  data: any;
  msg: string;
}

// 请求配置
interface FetchConfig {
  maxWait?: number;      // 最大等待时间（毫秒）
  hasReply?: boolean;     // 是否需要回复
}
```

### 事件处理器类型

```typescript
type EventHandler = (args: {
  reply: (data: any) => void;
  body: Message;
  user: User;              // 服务器端特有
  fetchId: string;
  header: Record<string, string>;
}) => Promise<void>;
```

## 集成方式

### Express 集成

通过 `bind(app)` 方法将 WebSocket 服务器绑定到 Express 应用：

```typescript
const app = express();
const server = new MasSocketServer();
server.bind(app);
```

### 独立使用

也可以独立使用，不依赖 Express（具体实现时决定）。

## 性能考虑

### 连接管理

- 使用 Map 或对象存储客户端，提高查找效率
- 分组映射使用对象，支持快速查找

### 消息路由

- 事件处理器使用 Map 存储，O(1) 查找复杂度
- 中间件数组按顺序执行

### 内存管理

- 及时清理断开的客户端
- 清理超时的请求 Promise

## 扩展性

### 可扩展点

1. **自定义协议**：可以扩展消息格式
2. **插件系统**：可以添加插件机制
3. **持久化**：可以添加消息持久化功能
4. **集群支持**：可以扩展支持多服务器集群

### 未来可能的功能

- 消息队列
- 消息持久化
- 集群模式
- 更丰富的重连策略
- 消息压缩
- 二进制消息支持

## 使用示例

### 服务器端

```typescript
const server = new MasSocketServer();

// 监听连接
server.onConnect = (client) => {
  console.log(`客户端连接: ${client.id}`);
};

// 注册事件
server.on('hello', async ({ reply, body, user }) => {
  reply({ code: '200', data: `Hello ${user.id}`, msg: 'success' });
});

// 绑定到 Express
server.bind(app);
```

### 客户端

```typescript
const client = new MasSocketClinet();

// 连接服务器
client.connect('ws://localhost:3000');

// 注册事件
client.on('message', async ({ reply, body }) => {
  console.log('收到消息:', body);
});

// 发送请求
const response = await client.fetch('hello', { name: 'World' });
console.log('收到回复:', response);
```

## 总结

MasSocket 通过将 WebSocket 抽象为请求-响应模式，提供了更直观的编程体验。同时保留了 WebSocket 的实时双向通信能力，支持事件驱动、分组管理、中间件等高级特性。整个架构设计注重类型安全、可扩展性和易用性。
