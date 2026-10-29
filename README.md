# My Pi Harness

基于 Pi 的本地优先 PC Agent Runtime，独立实现，支持 Electron 与浏览器共用界面。第一阶段逐步对齐标杆功能，第二阶段迭代自己的产品能力；Computer Use 延后。

当前提供GitHub应用登录、模型设置、持久会话、队列/分支、工作区与受控工具、上下文管理，以及MCP、Skills、插件和办公能力。M5已加入独立上下文的子Agent、并行/嵌套任务、通信与停止、角色预算及任务看板，正在完成整体验证。权限提供请求批准、独立AI帮我批准与完全访问，macOS Shell按策略隔离；会话执行事实保存为宿主JSONL，SQLite保存配置与可重建投影。Windows/Linux Shell仍不可用，真实账号和平台验收独立记录；范围及状态见[路线图](docs/00_OVERVIEW/roadmap.md)。

## 开始开发

使用 `.node-version` 指定的 Node 24 和根 `packageManager` 指定的 pnpm 10。先安装依赖：

```sh
pnpm install
```

GitHub 登录配置放在仓库根 `.env`，开发入口自动加载。新克隆仓库先按 [.env.example](.env.example) 配置；Electron 使用 Device Flow，浏览器使用授权码 + PKCE，并需 Client Secret。注册与回调设置见[登录配置](docs/07_USER_GUIDE/application-login.md)。

浏览器入口：

```sh
pnpm dev
```

打开 `http://127.0.0.1:5174`，填写启动终端显示的一次性配对码，然后完成GitHub登录。Vite 将 `/api` 代理到 `127.0.0.1:4311` 的独立 daemon。

桌面入口：

```sh
pnpm dev:desktop
```

该命令启动 Vite 和 Electron；Electron 启动自己的 daemon，等待 Web 就绪后打开窗口，退出时关闭后台服务。两种入口共用默认开发端口，分别运行即可。桌面启动链自动建立本机信任，然后由GitHub验证应用身份；已登录页面可以生成另一个浏览器的配对码。

会话JSONL在开发和正式运行时统一写入仓库根目录的`.my-pi-harness/`，其下按profile路径摘要隔离。独立安装包通过`MY_PI_HARNESS_SESSION_LOG_ROOT`指定该仓库中的隐藏目录。配置数据库与系统凭据使用应用profile；会话从JSONL恢复，不以SQLite反向补日志。开发阶段不保留旧格式兼容。目录和配置细节见[架构](docs/01_ARCHITECTURE/overview.md)与[存储说明](packages/storage/README.md)。

首次 `dev` 或 `dev:desktop` 会下载官方 Node 分发包并校验 SHA-256，缓存于 `.cache/node`。打包也使用这份独立 Node，用户运行桌面产物时无需另外安装 Node。

## 目录与职责

```text
apps/
  web/             React + shadcn/ui + Tailwind，浏览器与 Electron 共用
  daemon/          Fastify 本地 API、SSE、服务生命周期
  desktop/         Electron main/preload、daemon 监督、打包
packages/
  agent-runtime/   Pi模型网关、Run/工具、上下文与会话工作状态
  execution/       工作区路径、文件/PDF、按策略隔离Shell和Web工具
  storage/         JSONL批日志、SQLite/Drizzle配置和投影、附件、凭据与profile锁
  protocol/        浏览器安全 DTO、TypeBox schema、协议版本
  eslint-config/   共享静态规则
  tsconfig/        Node / Browser 编译配置
scripts/           开发、版本、依赖边界、文档与产物检查
tests/             工程边界测试与浏览器 E2E
docs/              项目架构、开发范式、功能 Spec、约束与验证
```

`packages/agent-runtime` 使用锁定同线的 Pi core 和 Pi ai。Renderer 不访问 Node、数据库或模型凭据；桌面通过有限 preload 桥提供能力，服务只监听回环地址。

## 检查与打包

```sh
pnpm check                        # 格式、lint、源码 typecheck、Vitest
pnpm build                        # 生成真实发布产物
pnpm test:artifact                # 构建后的 daemon IPC/退出集成测试
pnpm exec playwright install chromium
pnpm test:e2e                     # 构建后的浏览器完整链路
pnpm test:m2                      # 先 build，再做M2源码与浏览器定向验收
pnpm test:m3                      # 先 build，再做M3上下文与交互定向验收
pnpm test:provider                # 显式真实API检查，无测试凭据时skip
pnpm package:desktop              # 当前平台未签名应用目录，输出 release/
pnpm smoke:desktop                # 启动应用目录，验证桥、隔离、服务和退出
```

源码检查不要求预先 build。产物集成检查和浏览器 E2E 需要先 build；桌面 smoke 需要先 package。桌面截图输出到 `output/playwright/`，不提交构建、测试或下载缓存。

当前打包产出 `.app` 或 Windows 应用目录，正式安装器、签名、公证与自动更新尚未实现。macOS 与 Windows CI 已配置，实际平台执行情况以功能验证记录为准。

## AI Coding 入口

开始任务前读 [AGENTS.md](AGENTS.md)，按 [七步工作流](docs/00_OVERVIEW/workflow.md) 建立或更新功能 Spec，再进行实现、检查和验证记录。已确认任务在授权范围内连续推进。只有用户要求提交时才执行 [提交流程](docs/08_COLLABORATION/commit.md)。

架构与规范入口：

- [架构与依赖方向](docs/01_ARCHITECTURE/overview.md)
- [协议与桌面桥](docs/03_API/overview.md)
- [前端、后端、安全和存储约束](docs/05_CONSTRAINTS/overview.md)
- [核心技术设计：系统、Agent、上下文、存储与工作区执行](docs/09_TECHNICAL/技术文档总览.md)
- [M1 Spec与统一验收范围](docs/04_FEATURES/202610131100_feature_model-session/spec.md)
- [M1统一验证与待验收项](docs/04_FEATURES/202610131100_feature_model-session/verify.md)
- [模型与会话协议](docs/03_API/model-session.md)
- [M3上下文与交互Spec](docs/04_FEATURES/202610151655_feature_m3-context-interaction/spec.md)
- [M3统一验证与平台限制](docs/04_FEATURES/202610151655_feature_m3-context-interaction/verify.md)
- [M2分步收尾与验收范围](docs/04_FEATURES/202610151515_feature_m2-completion/spec.md)
- [M0 Spec 与任务](docs/04_FEATURES/202610130900_feature_project-foundation/spec.md)
- [验证证据与平台限制](docs/04_FEATURES/202610130900_feature_project-foundation/verify.md)
- [M0规范与架构审计](docs/04_FEATURES/202610131000_refactor_m0-standards-audit/spec.md)
- [本轮审计验证与限制](docs/04_FEATURES/202610131000_refactor_m0-standards-audit/verify.md)
