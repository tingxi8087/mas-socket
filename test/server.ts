import express from 'express';
import MasSocketServer from '../src/server';

const app = express();
const PORT = 3000;

// 创建 MasSocket 服务器实例
const masSocket = new MasSocketServer();

// 配置默认请求参数
masSocket.fetchConfig = {
  maxWait: 10000,
  hasReply: true,
  code: 200,
  msg: 'success',
};

// 连接事件处理
masSocket.onConnect = (client) => {
  console.log(`✅ 客户端连接: ${client.id}`);
  console.log(`   组: ${client.groups.join(', ') || '无'}`);
};

// 断开连接事件处理
masSocket.onDisconnect = (client, type) => {
  console.log(`❌ 客户端断开: ${client.id}, 类型: ${type}`);
};

// 注册中间件 - 日志记录
masSocket.use(async ({ body, user, fetchId, header }) => {
  console.log(`📨 [中间件] 收到消息来自 ${user.id}:`, {
    code: body.code,
    event: header.event || 'unknown',
    fetchId,
  });
  // 不调用 reply，继续传递到事件处理器
});

// 注册中间件 - 认证示例（可选）
masSocket.use(async ({ header, reply }) => {
  // 示例：检查 header 中的 token
  const token = header['authorization'];
  if (token && token !== 'valid-token') {
    reply({
      code: 401,
      data: null,
      msg: 'Unauthorized',
    });
    return;
  }
  // 继续传递
});

// 注册事件处理器 - Echo
masSocket.on('echo', async ({ reply, body, user }) => {
  console.log(`📢 [Echo] 来自 ${user.id}:`, body.data);
  reply({
    code: 200,
    data: {
      echo: body.data,
      timestamp: new Date().toISOString(),
      from: user.id,
    },
    msg: 'Echo success',
  });
});

// 注册事件处理器 - Ping
masSocket.on('ping', async ({ reply, body, user }) => {
  console.log(`🏓 [Ping] 来自 ${user.id}`);
  reply({
    code: 200,
    data: {
      pong: true,
      serverTime: new Date().toISOString(),
      clientData: body.data,
    },
    msg: 'Pong',
  });
});

// 注册事件处理器 - 时间
masSocket.on('time', async ({ reply, user }) => {
  console.log(`⏰ [Time] 来自 ${user.id}`);
  reply({
    code: 200,
    data: {
      time: new Date().toISOString(),
      timezone: 'Asia/Shanghai',
    },
    msg: 'Time success',
  });
});

// 注册事件处理器 - 消息
masSocket.on('message', async ({ reply, body, user }) => {
  console.log(`💬 [Message] 来自 ${user.id}:`, body.data);
  reply({
    code: 200,
    data: {
      received: true,
      message: body.data,
      from: user.id,
    },
    msg: 'Message received',
  });
});

// 注册事件处理器 - 中间件测试
masSocket.on('middleware-test', async ({ reply, body, user }) => {
  console.log(`🔧 [Middleware Test] 来自 ${user.id}`);
  reply({
    code: 200,
    data: {
      processed: true,
      originalData: body.data,
      processedBy: 'middleware-test handler',
    },
    msg: 'Processed by middleware',
  });
});

// 注册事件处理器 - 获取用户信息
masSocket.on('get-user-info', async ({ reply, user }) => {
  console.log(`👤 [Get User Info] 来自 ${user.id}`);
  reply({
    code: 200,
    data: {
      id: user.id,
      groups: user.groups,
      connectedAt: new Date().toISOString(),
    },
    msg: 'User info',
  });
});

// 注册事件处理器 - 加入组
masSocket.on('join-group', async ({ reply, body, user }) => {
  const groupName = body.data?.group;
  if (!groupName) {
    reply({
      code: 400,
      data: null,
      msg: 'Group name is required',
    });
    return;
  }

  masSocket.addGroup(groupName, user.id);
  console.log(`👥 [Join Group] ${user.id} 加入组: ${groupName}`);

  reply({
    code: 200,
    data: {
      group: groupName,
      groups: masSocket.groups[groupName] || [],
    },
    msg: 'Joined group',
  });
});

// 注册事件处理器 - 广播消息
masSocket.on('broadcast', async ({ reply, body, user }) => {
  const groupName = body.data?.group;
  const message = body.data?.message;

  if (!groupName || !message) {
    reply({
      code: 400,
      data: null,
      msg: 'Group name and message are required',
    });
    return;
  }

  console.log(`📣 [Broadcast] ${user.id} 向组 ${groupName} 广播: ${message}`);

  try {
    const responses = await masSocket.fetchByGroup(
      groupName,
      'broadcast-message',
      {
        from: user.id,
        message: message,
        timestamp: new Date().toISOString(),
      }
    );
    reply({
      code: 200,
      data: {
        sent: true,
        responses: responses.length,
      },
      msg: 'Broadcast sent',
    });
  } catch (error) {
    reply({
      code: 500,
      data: null,
      msg: `Broadcast failed: ${error}`,
    });
  }
});

// 注册事件处理器 - 接收广播消息
masSocket.on('broadcast-message', async ({ reply, body }) => {
  console.log(`📨 [Broadcast Message] 收到广播:`, body.data);
  reply({
    code: 200,
    data: {
      received: true,
    },
    msg: 'Broadcast received',
  });
});

// 定期向所有客户端发送心跳
setInterval(() => {
  const clients = masSocket.clientsList;
  if (clients.length > 0) {
    console.log(`💓 [Heartbeat] 向 ${clients.length} 个客户端发送心跳`);
    masSocket
      .fetch(
        clients.map((c) => c.id),
        'heartbeat',
        {
          serverTime: new Date().toISOString(),
          connectedClients: clients.length,
        },
        { hasReply: false }
      )
      .catch((error) => {
        console.error('心跳发送失败:', error);
      });
  }
}, 30000); // 每 30 秒

// 绑定到 Express 应用
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>MasSocket Server</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        .status { padding: 10px; background: #f0f0f0; border-radius: 4px; margin: 10px 0; }
        .info { margin: 10px 0; }
      </style>
    </head>
    <body>
      <h1>🔌 MasSocket Server</h1>
      <div class="status">
        <strong>状态:</strong> 运行中<br>
        <strong>端口:</strong> ${PORT}<br>
        <strong>连接数:</strong> ${masSocket.clientsList.length}<br>
        <strong>组数:</strong> ${Object.keys(masSocket.groups).length}
      </div>
      <div class="info">
        <h3>可用事件:</h3>
        <ul>
          <li><code>echo</code> - 回显消息</li>
          <li><code>ping</code> - 心跳测试</li>
          <li><code>time</code> - 获取服务器时间</li>
          <li><code>message</code> - 发送消息</li>
          <li><code>middleware-test</code> - 中间件测试</li>
          <li><code>get-user-info</code> - 获取用户信息</li>
          <li><code>join-group</code> - 加入组</li>
          <li><code>broadcast</code> - 广播消息</li>
        </ul>
      </div>
      <div class="info">
        <h3>调试页面:</h3>
        <p>打开 <a href="/test">test/index.html</a> 进行调试</p>
      </div>
    </body>
    </html>
  `);
});

// 启动服务器
const server = app.listen(PORT, () => {
  console.log(`🚀 MasSocket 服务器启动成功！`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`\n📝 可用事件:`);
  console.log(`   - echo: 回显消息`);
  console.log(`   - ping: 心跳测试`);
  console.log(`   - time: 获取服务器时间`);
  console.log(`   - message: 发送消息`);
  console.log(`   - middleware-test: 中间件测试`);
  console.log(`   - get-user-info: 获取用户信息`);
  console.log(`   - join-group: 加入组`);
  console.log(`   - broadcast: 广播消息`);
  console.log(`\n💡 提示: 打开 test/index.html 进行调试\n`);
});

// 绑定 WebSocket 服务器
masSocket.bind(app);

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n🛑 正在关闭服务器...');
  masSocket.closeAll();
  server.close(() => {
    console.log('✅ 服务器已关闭');
    process.exit(0);
  });
});
