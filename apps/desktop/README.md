# Desktop

Electron main 负责窗口、有限 preload 桥，以及独立 Node daemon 的启动和退出。Renderer 与浏览器共用 Web；桌面不导入 daemon 业务代码。

从根运行 `pnpm dev:desktop`，会准备固定版本 Node，启动 Vite 和 Electron。关闭最后一个窗口后，Electron 通过 IPC 请求自己的 daemon 退出；IPC 意外断开时 daemon 也会关闭。

`application` 负责启动取消、窗口和 daemon 的所有权；`window` 创建隔离窗口，`security` 限制导航、重定向、权限和桌面桥，`renderer` 校验本机 Web 地址并等待开发服务。开发地址只接受无凭据的 `http://127.0.0.1` URL。M0 默认拒绝浏览器权限与新窗口，桌面桥只接受所属窗口主 frame 的无参数请求；窗口关闭时移除桥 handler。

退出请求会中止尚未完成的 daemon 或页面启动，并等待资源回收；重复退出请求不会提前结束应用。supervisor 的就绪解析、取消和回收使用真实 Node 子进程测试，窗口策略和应用生命周期由源码单测验证；实际 Electron 行为由桌面 smoke 检查。

`pnpm package:desktop` 构建所有应用，校验并缓存官方 Node 分发包，部署 daemon 生产依赖、Web 和 Node 到桌面资源，然后生成当前平台的未签名应用目录。`pnpm smoke:desktop` 在完成打包后启动该应用目录，检查真实服务、有限桥、Renderer 隔离、来源拒绝和退出后的服务关闭；截图保存在 `output/playwright/desktop.png`。

M0 没有签名、安装器、自动更新、Computer Use 或 Agent 编排。当前验收范围见 [M0 Spec](../../docs/04_FEATURES/20261013_feature_project-foundation/spec.md)，已执行结果与平台限制见 [验证记录](../../docs/04_FEATURES/20261013_feature_project-foundation/verify.md)。
