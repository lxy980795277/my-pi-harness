# Desktop

对话中的HTTP(S)外链由独立`openExternal(url)`桥交给系统浏览器；preload/main校验地址，main限制所属受信任主frame，拒绝带凭据、超长、控制字符、文件和脚本地址。窗口关闭回收handler，认证仍由`openAuth(flowId)`拥有。

Electron main 负责窗口、有限 preload 桥，以及独立 Node daemon 的启动和退出。Renderer 与浏览器共用 Web；桌面不导入 daemon 业务代码。

从根运行 `pnpm dev:desktop`，会准备固定版本 Node，启动 Vite 和 Electron。关闭最后一个窗口后，Electron 通过 IPC 请求自己的 daemon 退出；IPC 意外断开时 daemon 也会关闭。

`application` 负责启动取消、窗口和 daemon 的所有权；`window` 创建隔离窗口，`security` 限制导航、重定向、权限和桌面桥，`renderer` 校验本机 Web 地址并等待开发服务。开发地址只接受无凭据的 `http://127.0.0.1` URL。浏览器权限仅允许所属可信主frame的`clipboard-sanitized-write`，检查请求URL、当前主frameURL及权限检查的完整origin；其他窗口、子frame、无文档请求、剪贴板读取和其他权限均拒绝，新窗口也拒绝。复制使用Web Clipboard API并保留文档焦点要求。getInfo只接受所属主frame的无参数请求；openAuth只接收daemon认证流程ID并由main核对URL；窗口关闭时移除桥 handler。

工作区区域点击通过`chooseWorkspaceDirectory()`打开系统目录选择器，取消返回null。拖入目录通过`getDroppedWorkspaceDirectory(file)`由preload的`webUtils.getPathForFile`提取磁盘路径，合成File或非File不进入IPC。两者只对所属主frame开放，main将绝对路径解析为存在目录的真实路径，拒绝普通文件；随后daemon注册仍检查敏感目录与工作区根策略。桌面桥不读取目录内容，不提供通用路径或文件操作。浏览器的目录选择能力见[工作区交互Spec](../../docs/04_FEATURES/202610151534_feature_workspace-creation/spec.md)。

退出请求会中止尚未完成的 daemon 或页面启动，并等待资源回收；重复退出请求不会提前结束应用。supervisor 的就绪解析、取消和回收使用真实 Node 子进程测试，窗口策略和应用生命周期由源码单测验证；实际 Electron 行为由桌面 smoke 检查。

`pnpm package:desktop`构建Web和Electron main/preload，校验并缓存官方Node分发包，部署daemon源码、生产依赖tsx、Web和Node到桌面资源，生成当前平台的应用目录。`pnpm package:desktop:installer`使用相同准备流程生成macOS DMG或Windows NSIS安装器，文件名包含产品版本、平台、架构及`unsigned`或`signed`。打包仅支持实际宿主平台和架构，避免将宿主SQLite或Node伪装成跨平台产物；所有命令关闭自动上传。daemon使用随包Node和tsx运行src/bootstrap.ts；main/preload将协议源码打入JS/CJS产物。

`pnpm smoke:desktop`在打包后启动应用目录，检查真实服务、有限桥、Renderer隔离、来源拒绝和退出后的服务关闭；截图保存在`output/playwright/desktop.png`。`pnpm smoke:desktop:installer`验证DMG并挂载复制，或在Windows实际执行NSIS安装，再从带空格和中文的临时安装路径运行完整smoke。它还使用固定临时profile和显式旧日志根，替换同一候选应用后再次确认原对话可读；这证明候选重装的数据保留，不能代替跨版本迁移验收。Windows卸载不删除业务profile；macOS移除应用也不主动清理用户数据。测试不修改系统Applications目录，安装证据保存在`output/m7.5/`。

桌面smoke只配置临时`MY_PI_HARNESS_PROFILE_DIRECTORY`，有意不提供日志根，验证安装环境由daemon自动使用该profile下的`.my-pi-harness`。它另行隔离Electron的Cookie和缓存，不继承模型或OAuth凭据；仅设置`--user-data-dir`不能隔离业务profile。原生凭据查询仅使用由临时profile派生的新命名空间。它还检查记忆新建、启停、编辑和遗忘，双模型独立未准备状态，以及搜索原文只读展示、引用待发和草稿保留。此流程不下载模型、不发送付费请求，记忆和搜索截图分别保存为`desktop-memory.png`与`desktop-search.png`。部署测试另外验证生产依赖中的记忆snapshot出口与真实本地模型Worker；无缓存查询保持未准备并正常关闭。

桌面启动使用私有随机secret建立或复用HttpOnly客户端Cookie，不向Renderer暴露该秘密；客户端初始化不签发应用登录。普通浏览器自动初始化自己的客户端，无需通信码，两端的应用登录Cookie独立。客户端和应用会话规则见[应用登录协议](../../docs/03_API/application-auth.md)。业务profile统一由daemon解析，main不使用`app.getPath('userData')`或应用名称生成目录；显式环境配置可覆盖默认值，进程环境优先于开发根`.env`或发布随包`desktop-oauth.env`。数据位置与配置规则由[启动配置](../../docs/01_ARCHITECTURE/overview.md#启动配置)维护。Electron的`userData`仅保存Cookie和缓存；安装资源保持只读。原生模块为独立Node24构建，不重建为Electron ABI。

签名默认关闭：`MY_PI_HARNESS_DESKTOP_SIGNING=unsigned`或不设置时生成明确标记的测试候选，不代表可公开发布。构建设置为`signed`时，macOS要求`CSC_NAME`或`CSC_LINK`与`CSC_KEY_PASSWORD`，并要求完整Apple公证配置：`APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`，或`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`，或已配置的`APPLE_KEYCHAIN_PROFILE`。Windows使用`WIN_CSC_LINK`与`WIN_CSC_KEY_PASSWORD`，也支持对应`CSC_*`变量。配置缺失直接失败，签名产物再核对Developer ID、随包Node同一Team与stapled ticket，Windows核对实际Authenticode。凭据仅从构建环境读取，不写入资源或仓库。配置以本项目固定的[electron-builder v26](https://www.electron.build/v26/docs/mac/)为准。

安装验收主机只需显式选择同一签名模式并提供对应产物，不需要构建用的证书或公证凭据。signed模式在安装前校验安装器真实签名，安装后再校验应用及随包二进制；失败直接终止，不降级为unsigned验收。

当前尚未完成真实发布身份的签名/公证、Windows本机安装及跨版本升级验证；自动更新与Computer Use不在本次实现内。M1范围见[模型与会话Spec](../../docs/04_FEATURES/202610131100_feature_model-session/spec.md)；M7发布验证以所属[验证记录](../../docs/04_FEATURES/202611141341_feature_m7-product-completion/verify.md)为准。
