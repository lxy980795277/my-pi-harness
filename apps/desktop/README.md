# Desktop

Electron main 负责窗口、有限 preload 桥，以及独立 Node daemon 的启动和退出。Renderer 与浏览器共用 Web；桌面不导入 daemon 业务代码。

从根运行 `pnpm dev:desktop`，会准备固定版本 Node，启动 Vite 和 Electron。关闭最后一个窗口后，Electron 通过 IPC 请求自己的 daemon 退出；IPC 意外断开时 daemon 也会关闭。

`application` 负责启动取消、窗口和 daemon 的所有权；`window` 创建隔离窗口，`security` 限制导航、重定向、权限和桌面桥，`renderer` 校验本机 Web 地址并等待开发服务。开发地址只接受无凭据的 `http://127.0.0.1` URL。默认拒绝浏览器权限与新窗口。getInfo只接受所属主frame的无参数请求；openAuth只接收daemon认证流程ID并由main核对URL；窗口关闭时移除桥 handler。

工作区区域点击通过`chooseWorkspaceDirectory()`打开系统目录选择器，取消返回null。拖入目录通过`getDroppedWorkspaceDirectory(file)`由preload的`webUtils.getPathForFile`提取磁盘路径，合成File或非File不进入IPC。两者只对所属主frame开放，main将绝对路径解析为存在目录的真实路径，拒绝普通文件；随后daemon注册仍检查敏感目录与工作区根策略。桌面桥不读取目录内容，不提供通用路径或文件操作。浏览器的目录选择能力见[工作区交互Spec](../../docs/04_FEATURES/202610151534_feature_workspace-creation/spec.md)。

退出请求会中止尚未完成的 daemon 或页面启动，并等待资源回收；重复退出请求不会提前结束应用。supervisor 的就绪解析、取消和回收使用真实 Node 子进程测试，窗口策略和应用生命周期由源码单测验证；实际 Electron 行为由桌面 smoke 检查。

`pnpm package:desktop` 构建所有应用，校验并缓存官方 Node 分发包，部署 daemon 生产依赖、Web 和 Node 到桌面资源，然后生成当前平台的未签名应用目录。`pnpm smoke:desktop` 在完成打包后启动该应用目录，检查真实服务、有限桥、Renderer 隔离、来源拒绝和退出后的服务关闭；截图保存在 `output/playwright/desktop.png`。

桌面启动使用私有随机secret建立HttpOnly页面Cookie，不向Renderer暴露该秘密。daemon数据在macOS位于userData/profiles/default，Windows位于LocalAppData/My Pi Harness/profiles/default，与独立daemon一致；安装资源保持只读。原生模块为独立Node24构建，不重建为Electron ABI。

当前没有签名、安装器、自动更新或Computer Use。M1范围见[模型与会话Spec](../../docs/04_FEATURES/202610131100_feature_model-session/spec.md)；工程底座记录见 [M0 Spec](../../docs/04_FEATURES/202610130900_feature_project-foundation/spec.md)，已执行结果与平台限制见 [验证记录](../../docs/04_FEATURES/202610130900_feature_project-foundation/verify.md)。
