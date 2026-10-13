# Protocol

跨 HTTP、SSE、所有者进程 IPC 与 preload 的 DTO 和 TypeBox schema。只依赖浏览器安全的 TypeBox；不加载 Node、Pi 或业务实现。

产品应用版本由根 `package.json` 通过 `pnpm version:sync` 生成，协议版本独立控制。源码检查使用 TS paths，发布消费者通过包 exports 加载 `dist`。

字段、失败语义和桌面桥见 [协议文档](../../docs/03_API/overview.md)。改变协议时同时更新所有消费者和相关行为验证。
