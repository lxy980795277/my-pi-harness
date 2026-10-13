# Web Renderer

浏览器与 Electron 共用的 React 工作台。页面负责布局和状态呈现，通过共享协议访问本机 daemon；不访问 Node、模型凭据、数据库或 Pi 实例。基础 UI 在 `src/components/ui/` 中按 shadcn 的组合方式维护，主题使用 Tailwind CSS 语义 token。

手写组件使用 `FC<Props>`、具名导出和独立的 `index.tsx` 目录；Hook 与状态规则见 [React 约束](../../docs/05_CONSTRAINTS/react.md) 和 [Zustand 约束](../../docs/05_CONSTRAINTS/zustand.md)。HTTP/SSE 统一客户端位于 `src/services/`，领域 DTO 在 Feature Service 中校验；Query 拥有服务器快照，当前 M0 没有独立 Zustand Store。

当前 M0 只显示真实的健康检查、服务元数据和 `runtime.ready` 事件，提供浅深主题与手动重连。Agent 对话、模型配置和工具执行按后续里程碑实施；页面不生成模拟会话或工具结果。

## 开发

从仓库根目录启动 daemon 和 Web；具体入口见 [运行指南](../../docs/07_USER_GUIDE/overview.md)。单独启动界面：

```sh
pnpm --filter @my-pi-harness/web dev
```

Vite 固定监听 `127.0.0.1:5174`。页面始终请求同源 `/api`；开发代理默认转发到 `http://127.0.0.1:4311`，可通过 `DAEMON_ORIGIN` 调整代理目标。健康响应与 SSE 内容在进入组件前按 `@my-pi-harness/protocol` 校验。

## 构建与发布

```sh
pnpm --filter @my-pi-harness/web typecheck
pnpm --filter @my-pi-harness/web lint
pnpm --filter @my-pi-harness/web build
```

构建输出为 `dist/` 静态文件。发布版由 daemon 托管这些文件与 `/api`，Electron 加载 daemon 的实际监听地址；浏览器也访问同一服务。Vite 是开发工具，不是发布服务。桌面资源装配由 `apps/desktop` 负责。

浏览器源码和 Vite 配置分别使用 `tsconfig.json` 与 `tsconfig.node.json`；浏览器程序没有 Node ambient 类型。源码检查与 Vite 打包通过路径映射读取 protocol 源码，不依赖旧 `dist`。
