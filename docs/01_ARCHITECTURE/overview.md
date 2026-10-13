# 架构

应用采用模块化本地服务。Electron 是桌面壳，Web Renderer 与普通浏览器共用；daemon 是独立 Node 进程，不把 Pi、文件系统、模型凭据或数据库放进 Renderer。

## 已确认技术栈

| 职责                | 选择                                                         | 落地阶段     |
| ------------------- | ------------------------------------------------------------ | ------------ |
| Workspace与任务编排 | pnpm workspace + Turborepo                                   | M0           |
| 类型与静态质量      | TypeScript strict、ESLint flat config、Oxlint a11y、Prettier | M0           |
| Web                 | React + Vite、shadcn/ui、Tailwind CSS                        | M0起         |
| 桌面                | Electron main / preload                                      | M0           |
| 本地服务            | 独立 Node 24、Fastify、TypeBox、结构化日志                   | M0           |
| 共享协议            | 浏览器安全 TypeBox schema / DTO                              | M0           |
| 验证                | Vitest + Playwright                                          | M0起         |
| Agent与模型         | Pi core + Pi ai                                              | M1           |
| 持久化              | better-sqlite3 + Drizzle、SQLite durable events              | 后续存储实现 |

后续依赖按实际模块添加，不在 M0 提前创建未实现能力的空壳。SQLite执行事件与JSONL导入导出的职责见 [存储约束](../05_CONSTRAINTS/storage.md)。能力范围与当前状态以 [里程碑](../00_OVERVIEW/roadmap.md) 为准。

## Monorepo职责

| 路径                     | 负责                                                                | 不负责                                 |
| ------------------------ | ------------------------------------------------------------------- | -------------------------------------- |
| `apps/web`               | 页面、交互、HTTP/SSE客户端、状态呈现                                | Node API、凭据与Agent实例              |
| `apps/daemon`            | API装配、配置、事件连接与本机服务生命周期；后续应用服务与持久化装配 | 页面组件与桌面窗口                     |
| `apps/desktop`           | Electron窗口、有限preload桥、daemon启动和退出、桌面资源与发布装配   | Agent Loop、业务数据库与工具实现       |
| `packages/protocol`      | 跨端DTO、schema、协议版本、公开桌面桥                               | Node imports、业务服务、环境配置或密钥 |
| `packages/eslint-config` | 共享静态检查配置                                                    | 业务实现                               |
| `packages/tsconfig`      | 明确的TypeScript编译配置                                            | 运行时代码                             |

`packages/agent-runtime` 从 M1 创建，承载 Pi 编排及项目运行生命周期。其他 package 在真实职责出现时创建，避免无边界共享工具包。跨包导入使用 `@my-pi-harness/*`；相对导入仅留在同一app/package，源码检查拒绝跨workspace私有源码引用。

## 进程和连接

浏览器开发通过 Vite 的同源 `/api` 代理访问 daemon。Electron 开发启动自己的 daemon，等待Web HTTP就绪后加载窗口；发布版由 Electron 启动随包独立 Node，daemon 托管构建后的 Web，窗口连接实际监听端口。

daemon 只监听 `127.0.0.1`。默认 Web 开发端口为 `5174`，独立 daemon 为 `4311`；发布时使用端口 `0` 申请空闲端口，并通过经过校验的启动记录返回实际地址。桌面开发自动启动的 daemon 由桌面进程拥有，退出与启动失败都要回收。

main/preload 只开放明确列举的桌面能力，校验调用来源与输入，不开放任意 IPC channel、文件路径、Shell 或动态代码执行。HTTP与SSE协议见 [API](../03_API/overview.md)，窗口、IPC和平台生命周期见 [桌面约束](../05_CONSTRAINTS/desktop.md)，授权与工具隔离见 [安全约束](../05_CONSTRAINTS/security.md)。

## 源码与发布产物

lint、typecheck 和源码测试通过 TypeScript paths 解析工作区 `src`，必须能在没有旧构建产物时执行。发布 Node 解析真实 package exports，`packages/protocol` 导出 `dist/*.js`；发布验证使用构建产物，不能以源码路径别名代替。

本地相对导入写 `.js`，让TypeScript编译后的ESM在Node中直接解析。生产 daemon 运行编译后的 JavaScript，不依赖 tsx、开发服务器或根工作区源码。

桌面资源同时包含独立 Node、daemon及其生产依赖、Web构建产物。`scripts/node-runtime.mjs`按 `.node-version` 下载官方发行包，在独立目录校验SHA-256并解压完成后原子发布缓存manifest；开发聚合入口与桌面资源准备共用该运行时。产品版本的唯一来源和同步规则见 [发布规范](../06_RELEASES/overview.md)。

开发聚合脚本通过 `scripts/process-tree.mjs` 只管理自己spawn的命令，重复退出共享清理结果。该开发工具与后续Agent执行适配器职责不同，Windows孤儿进程树限制见 [桌面约束](../05_CONSTRAINTS/desktop.md)。

## M0配置

| 环境变量                      | 含义                                          |
| ----------------------------- | --------------------------------------------- |
| `MY_PI_HARNESS_PORT`          | daemon端口，默认4311；0申请动态端口           |
| `MY_PI_HARNESS_WEB_DIST_PATH` | 可选的已构建Web目录；配置后必须包含index.html |
| `MY_PI_HARNESS_PARENT_PID`    | 可选的所有者进程ID，用于桌面启动链的退出回收  |

配置在监听或读取应用资源前校验。M0 不创建数据库、Provider凭据或Agent运行配置；对应模块落地时再增加实际需要的字段。

Web开发的 `DAEMON_ORIGIN` 指定同源代理目标，缺省连接上述独立daemon地址。桌面开发入口注入 `MY_PI_HARNESS_NODE_PATH` 和 `MY_PI_HARNESS_RENDERER_URL`，分别选择独立Node与开发页面；发布版根据安装资源和实际daemon地址解析，不使用这些开发覆盖项。
