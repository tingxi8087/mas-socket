# mas-ts

这是一个最基础的 TypeScript，零帧起手 TypeScript 进行开发。

## 功能特性

- ✅ **TypeScript 支持**：完整的 TypeScript 配置，支持 ESNext 和最新特性
- ✅ **代码检查与格式化**：集成 ESLint + Prettier，保证代码质量
- ✅ **路径别名**：支持 `@/` 指向 `src/`，`@@/` 指向项目根目录
- ✅ **模块别名**：支持使用 `module-alias` 进行模块路径别名配置
- ✅ **测试支持**：集成 Bun 内置测试框架
- ✅ **时区处理**：默认配置为 `Asia/Shanghai` 时区
- ✅ **终端颜色输出**：支持使用 `ansi-colors` 进行彩色终端输出
- ✅ **JSX 支持**：配置支持 React JSX 语法

## 集成的库

### 生产依赖

- **[lodash](https://lodash.com/)** - JavaScript 工具函数库，提供常用的工具方法
- **[moment-timezone](https://momentjs.com/timezone/)** - 时区和日期时间处理库
- **[ansi-colors](https://github.com/doowb/ansi-colors)** - 终端颜色输出库
- **[module-alias](https://github.com/ilearnio/module-alias)** - 模块路径别名支持

### 开发依赖

- **[TypeScript](https://www.typescriptlang.org/)** - TypeScript 编译器（peer dependency）
- **[ESLint](https://eslint.org/)** - JavaScript/TypeScript 代码检查工具
- **[Prettier](https://prettier.io/)** - 代码格式化工具
- **[typescript-eslint](https://typescript-eslint.io/)** - TypeScript ESLint 插件和解析器
- **@types/bun** - Bun 运行时类型定义
- **@types/lodash** - lodash 类型定义
- **@types/moment-timezone** - moment-timezone 类型定义

## 安装依赖

```bash
bun install
```

## 运行

```bash
# 使用 start 脚本运行
bun start

# 或直接运行
bun run ./src/index.ts
```

## MasSocket 打包

```bash
# 构建客户端（ESM + IIFE）和服务端
bun run build

# 仅构建客户端（ESM）
bun run build:client

# 仅构建客户端（IIFE，可直接 <script> 引用）
bun run build:client:iife

# 仅构建服务端
bun run build:server
```

产物目录：
- `dist/client/index.js`（浏览器 ESM）
- `dist/client/index.iife.js`（浏览器 IIFE）
- `dist/server/index.js`（服务端 ESM）

## MasSocket 浏览器使用

### ESM

```html
<script type="module">
  import MasSocketClinet from './dist/client/index.js';
  const client = new MasSocketClinet();
  client.connect('ws://localhost:3000');
</script>
```

### HTML 直接引用（IIFE）

```html
<script src="./dist/client/index.iife.js"></script>
<script>
  const client = new MasSocketClinet();
  client.connect('ws://localhost:3000');
</script>
```

## 项目配置

### TypeScript 配置

- 目标：ESNext
- 模块系统：Preserve（Bun 原生模块系统）
- 严格模式：已启用
- 路径别名：
  - `@/*` → `./src/*`
  - `@@/*` → `./*`

### ESLint 配置

- 使用 TypeScript ESLint 推荐配置
- 集成 Prettier 进行代码格式化
- 未使用的变量会显示警告（以 `_` 开头的变量会被忽略）

## 使用示例

### 路径别名使用

```typescript
// 使用 @/ 引用 src 目录下的文件
import { something } from '@/utils/helper';

// 使用 @@/ 引用根目录下的文件
import config from '@@/config';
```

### 时区处理

```typescript
import moment from 'moment-timezone';
// 默认时区已设置为 Asia/Shanghai
console.log(moment().format()); // 输出当前上海时间
```

### 终端颜色输出

```typescript
import c from 'ansi-colors';
console.log(c.bgGreen('Hello World'));
```

## 关于

本项目使用 `bun init` 创建，基于 Bun 运行时。 [Bun](https://bun.com) 是一个快速的全能 JavaScript 运行时，集成了打包器、测试运行器和包管理器。
