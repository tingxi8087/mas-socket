# MasSocket

一个功能强大的 WebSocket 通信库，支持请求-响应模式、事件监听、客户端分组管理等功能。

## 特性

- 🚀 **请求-响应模式**：类似 HTTP 的请求-响应模式，支持异步等待回复
- 📡 **事件驱动**：支持事件监听和处理
- 👥 **客户端分组**：支持将客户端分组管理，方便批量操作
- 🔌 **自动重连**：客户端支持自动重连机制
- 🛡️ **中间件支持**：支持中间件模式，方便扩展功能
- 📦 **TypeScript 支持**：完整的 TypeScript 类型定义
- 🌐 **多格式支持**：支持 ESM 和 IIFE 格式的客户端构建

## 安装

```bash
npm install mas-socket
# 或
bun add mas-socket
```

## 快速开始

### 服务器端

```typescript
import express from 'express';
import MasSocketServer from 'mas-socket';

const app = express();
const server = app.listen(3000, () => {
  console.log('Server running on port 3000');
});

const masSocket = new MasSocketServer();

// 绑定到 HTTP 服务器
masSocket.bind(server);

// 监听客户端连接
masSocket.onConnect = (client) => {
  console.log('客户端连接:', client.id);
};

// 监听客户端断开
masSocket.onDisconnect = (client, type) => {
  console.log('客户端断开:', client.id, type);
};

// 注册事件处理器
masSocket.on('hello', async ({ reply, body, user }) => {
  console.log('收到消息:', body.data, '来自:', user.id);
  reply({ message: 'Hello from server!' });
});

// 向客户端发送请求
const response = await masSocket.fetch('client-id', 'getUserInfo', { userId: '123' });
console.log('客户端回复:', response);
```

### 客户端（浏览器）

#### 使用 ESM 模块

```typescript
import MasSocketClinet from 'mas-socket/client';

const client = new MasSocketClinet();

// 连接到服务器
client.connect('ws://localhost:3000');

// 监听连接断开
client.onDisconnect = () => {
  console.log('连接已断开');
};

// 注册事件处理器
client.on('hello', async ({ reply, body }) => {
  console.log('收到服务器消息:', body.data);
  reply({ message: 'Hello from client!' });
});

// 向服务器发送请求
const response = await client.fetch('getUserInfo', { userId: '123' });
console.log('服务器回复:', response);
```

#### 使用 IIFE 格式（直接在 HTML 中使用）

```html
<script src="https://unpkg.com/mas-socket/dist/client/index.iife.js"></script>
<script>
  const client = new MasSocketClinet();
  client.connect('ws://localhost:3000');
  
  client.on('hello', async ({ reply, body }) => {
    console.log('收到消息:', body.data);
    reply({ message: 'Hello!' });
  });
</script>
```

## API 文档

### 服务器端 API

#### `MasSocketServer`

#### 方法

##### `bind(appOrServer: Express | HttpServer): void`

将 WebSocket 服务器绑定到 Express 应用或 HTTP 服务器。

```typescript
const masSocket = new MasSocketServer();
masSocket.bind(server);
```

##### `on(event: string, handler: EventHandler): void`

注册事件监听器。

```typescript
masSocket.on('userLogin', async ({ reply, body, user }) => {
  // 处理用户登录逻辑
  reply({ success: true });
});
```

##### `use(handler: EventHandler): void`

注册中间件。中间件会在所有事件处理之前执行。

```typescript
masSocket.use(async ({ reply, body, user, event }) => {
  // 认证中间件
  if (!user.id) {
    reply(null, 401, 'Unauthorized');
    return;
  }
});
```

##### `fetch(id: string | string[], event: string, data: any, config?: FetchConfig): Promise<any>`

向指定客户端发送请求并等待回复。

```typescript
// 向单个客户端发送请求
const response = await masSocket.fetch('client-id', 'getData', { id: '123' });

// 向多个客户端发送请求
const responses = await masSocket.fetch(
  ['client-1', 'client-2'],
  'getData',
  { id: '123' }
);

// 不需要回复的请求
await masSocket.fetch('client-id', 'notify', { message: 'Hello' }, {
  hasReply: false
});
```

##### `fetchByGroup(group: string | string[], event: string, data: any, config?: FetchConfig): Promise<any>`

向指定组内的所有客户端发送请求并等待回复。

```typescript
const responses = await masSocket.fetchByGroup('admins', 'getStatus', {});
```

##### `addGroup(group: string, id: string): void`

将客户端添加到指定组。

```typescript
masSocket.addGroup('admins', 'client-id');
```

##### `removeGroup(group: string, id: string): void`

将客户端从指定组中移除。

```typescript
masSocket.removeGroup('admins', 'client-id');
```

##### `close(ids: string[] | string): void`

关闭指定的客户端连接。

```typescript
masSocket.close('client-id');
masSocket.close(['client-1', 'client-2']);
```

##### `closeByGroups(groups: string[]): void`

关闭指定组内的所有客户端连接。

```typescript
masSocket.closeByGroups(['admins', 'users']);
```

##### `closeAll(): void`

关闭所有客户端连接。

```typescript
masSocket.closeAll();
```

#### 属性

##### `clientsList: User[]`

获取当前连接的客户端列表。

```typescript
const clients = masSocket.clientsList;
console.log('当前连接数:', clients.length);
```

##### `groups: Record<string, string[]>`

获取所有分组信息。

```typescript
const groups = masSocket.groups;
console.log('分组:', groups);
```

##### `fetchConfig: FetchConfig`

默认的请求配置。

```typescript
masSocket.fetchConfig = {
  maxWait: 5000,      // 最大等待时间（毫秒）
  hasReply: true,     // 是否需要回复
  code: 200,          // 默认状态码
  msg: 'success'      // 默认消息
};
```

##### `maxMessageSize: number`

最大消息大小（字节），默认 1MB。

```typescript
masSocket.maxMessageSize = 2 * 1024 * 1024; // 2MB
```

##### `onConnect: (client: User) => void`

客户端连接时的回调函数。

```typescript
masSocket.onConnect = (client) => {
  console.log('新客户端连接:', client.id);
};
```

##### `onDisconnect: (client: User, type: string) => void`

客户端断开连接时的回调函数。

```typescript
masSocket.onDisconnect = (client, type) => {
  console.log('客户端断开:', client.id, type);
};
```

### 客户端 API

#### `MasSocketClinet`

#### 方法

##### `connect(url: string): void`

连接到 WebSocket 服务器。

```typescript
client.connect('ws://localhost:3000');
```

##### `close(): void`

关闭与服务器的连接。

```typescript
client.close();
```

##### `fetch(event: string, data: any, config?: FetchConfig): Promise<any>`

向服务器发送请求并等待回复。

```typescript
const response = await client.fetch('getData', { id: '123' });
```

##### `on(event: string, handler: EventHandler): void`

注册事件监听器。

```typescript
client.on('message', async ({ reply, body }) => {
  console.log('收到消息:', body.data);
  reply({ received: true });
});
```

##### `use(handler: EventHandler): void`

注册中间件。

```typescript
client.use(async ({ reply, body, event }) => {
  // 处理逻辑
});
```

##### `getConfig(): MasSocketServerClinetConfig`

获取当前配置。

```typescript
const config = client.getConfig();
console.log('连接状态:', config.status);
```

##### `setConfig(config: Partial<ServerClinetConfig>): void`

设置客户端配置。

```typescript
client.setConfig({
  maxReconnectCount: 10,      // 最大重连次数
  maxConnectTimeout: 15000     // 最大连接超时时间（毫秒）
});
```

#### 属性

##### `fetchConfig: FetchConfig`

默认的请求配置。

```typescript
client.fetchConfig = {
  maxWait: 5000,
  hasReply: true,
  code: 200,
  msg: 'success'
};
```

##### `onDisconnect: () => void`

连接断开时的回调函数。

```typescript
client.onDisconnect = () => {
  console.log('连接已断开');
};
```

## 类型定义

### `User`

```typescript
interface User {
  id: string;
  groups: string[];
}
```

### `Message`

```typescript
interface Message {
  code: number;
  data: any;
  msg: string;
}
```

### `FetchConfig`

```typescript
interface FetchConfig {
  maxWait?: number;      // 最大等待时间（毫秒）
  hasReply?: boolean;    // 是否需要回复
  code?: number;         // 消息状态码
  msg?: string;          // 消息描述
}
```

### `EventHandler`

```typescript
type EventHandler = (args: {
  reply: (data: any, code?: number, msg?: string) => void;
  body: Message;
  user?: User;           // 服务器端可用
  fetchId: string;
  header: Record<string, string>;
  event: string;
}) => Promise<void>;
```

## 使用示例

### 完整的服务器示例

```typescript
import express from 'express';
import MasSocketServer from 'mas-socket';

const app = express();
const server = app.listen(3000);

const masSocket = new MasSocketServer();
masSocket.bind(server);

// 中间件：日志记录
masSocket.use(async ({ body, user, event }) => {
  console.log(`[${new Date().toISOString()}] ${user?.id} -> ${event}:`, body.data);
});

// 中间件：认证
masSocket.use(async ({ reply, body, user }) => {
  const token = body.data?.token;
  if (!token || token !== 'secret-token') {
    reply(null, 401, 'Unauthorized');
    return;
  }
});

// 事件：用户登录
masSocket.on('login', async ({ reply, body, user }) => {
  // 将用户添加到组
  masSocket.addGroup('users', user.id);
  masSocket.addGroup('online', user.id);
  
  reply({ success: true, userId: user.id });
});

// 事件：获取在线用户列表
masSocket.on('getOnlineUsers', async ({ reply }) => {
  const onlineUsers = masSocket.clientsList;
  reply({ users: onlineUsers });
});

// 事件：广播消息
masSocket.on('broadcast', async ({ reply, body }) => {
  await masSocket.fetchByGroup('users', 'message', body.data, {
    hasReply: false
  });
  reply({ success: true });
});

masSocket.onConnect = (client) => {
  console.log('新客户端连接:', client.id);
};

masSocket.onDisconnect = (client, type) => {
  console.log('客户端断开:', client.id, type);
};
```

### 完整的客户端示例

```typescript
import MasSocketClinet from 'mas-socket/client';

const client = new MasSocketClinet();

// 配置
client.setConfig({
  maxReconnectCount: 10,
  maxConnectTimeout: 15000
});

client.fetchConfig = {
  maxWait: 5000,
  hasReply: true
};

// 连接
client.connect('ws://localhost:3000');

// 监听系统事件：获取客户端 ID
client.on('_system_id', async ({ body }) => {
  console.log('我的客户端 ID:', body.data.id);
});

// 监听消息
client.on('message', async ({ reply, body }) => {
  console.log('收到广播消息:', body.data);
  reply({ received: true });
});

// 登录
client.on('login', async ({ reply, body }) => {
  console.log('登录成功:', body.data);
});

// 发送登录请求
client.fetch('login', { token: 'secret-token' })
  .then(response => {
    console.log('登录响应:', response);
  })
  .catch(error => {
    console.error('登录失败:', error);
  });

client.onDisconnect = () => {
  console.log('连接已断开，尝试重连...');
};
```

## 构建

```bash
# 构建所有文件
bun run build

# 仅构建客户端
bun run build:client

# 仅构建服务器
bun run build:server
```

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！
