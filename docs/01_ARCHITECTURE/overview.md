# 架构

应用采用模块化本地服务。Electron 是桌面壳，Web Renderer 与普通浏览器共用；daemon 是独立 Node 进程，不把 Pi、文件系统、模型凭据或数据库放进 Renderer。

## 已确认技术栈

| 职责                | 选择                                                         | 落地阶段     |
| ------------------- | ------------------------------------------------------------ | ------------ |
| Workspace与任务编排 | pnpm workspace + Turborepo                                   | M0           |
| 类型与静态质量      | TypeScript strict、ESLint flat config、Oxlint a11y、Prettier | M0           |
| Web                 | React + Vite、shadcn/ui、Tailwind CSS                        | M0起         |
| 对话展示            | Streamdown Markdown、Shiki按需高亮与TanStack Virtual动态列表 | 会话体验专项 |
| 桌面                | Electron main / preload                                      | M0           |
| 本地服务            | 独立 Node 24、Fastify、TypeBox、结构化日志                   | M0           |
| 共享协议            | 浏览器安全 TypeBox schema / DTO                              | M0           |
| 验证                | Vitest + Playwright                                          | M0起         |
| Agent与模型         | Pi core + Pi ai                                              | M1           |
| 扩展能力            | 官方MCP SDK、HTTP/SSE、yaml Skills与oauth4webapi服务连接     | M4           |
| 持久化              | JSONL会话事实 + better-sqlite3 / Drizzle配置与投影           | M1           |

后续依赖按实际模块添加，不创建未实现能力的空壳。会话JSONL与SQLite配置/投影的职责见[存储约束](../05_CONSTRAINTS/backend.md)。能力范围与当前状态以[里程碑](../00_OVERVIEW/roadmap.md)为准。

## Monorepo职责

| 路径                     | 负责                                                                 | 不负责                                    |
| ------------------------ | -------------------------------------------------------------------- | ----------------------------------------- |
| `apps/web`               | 页面、交互、HTTP/SSE客户端、状态呈现                                 | Node API、凭据与Agent实例                 |
| `apps/daemon`            | API装配、本机信任与应用登录、事件重放、profile与服务生命周期         | 页面组件与桌面窗口                        |
| `apps/desktop`           | Electron窗口、有限preload桥、daemon启动和退出、桌面资源与发布装配    | Agent Loop、业务数据库与工具实现          |
| `packages/agent-runtime` | Pi模型、认证与主/子Run编排、任务树及预算、审批、取消、队列和分支     | Electron、React、Fastify与SQL实现         |
| `packages/execution`     | 有界文件/PDF、Web与按策略隔离的macOS Shell执行                       | Pi Loop、审批拥有者、数据库与页面         |
| `packages/integrations`  | MCP传输/目录/租约、Skills资源/安装、插件manifest与服务OAuth/网关声明 | 数据库、启动授权决策、Pi Loop、HTTP与页面 |
| `packages/storage`       | JSONL批日志、SQLite配置/投影、附件文件、profile锁、系统凭据          | 模型调用和页面状态                        |
| `packages/protocol`      | 跨端DTO、schema、协议版本、公开桌面桥                                | Node imports、业务服务、环境配置或密钥    |
| `packages/eslint-config` | 共享静态检查配置                                                     | 业务实现                                  |
| `packages/tsconfig`      | 明确的TypeScript编译配置                                             | 运行时代码                                |

`agent-runtime`通过明确RuntimeStore/ProviderStore与SecretStore接口接入宿主，ToolRuntime按冻结策略逐次确认、调用独立ModelApprovalReviewer或使用用户明确选择的full-access，再调用execution；daemon提供注册工作区解析和复核资料，Renderer只消费公开工具事件。`storage`拥有JSONL会话事实、不可变附件以及SQLite配置/会话投影；完整批次校验后先写日志并fsync，再提交SQLite投影，Runtime随后发布公开SSE。文本/思考片段通过独立发布入口更新内存覆盖层，不写日志或SQLite；公开快照合并当前片段，持久seq与实时修订分别追踪。失败冻结持久写入，重启从日志重建并中断在途运行，不恢复未持久片段或重执行副作用。其他package在真实职责出现时创建，避免无边界共享工具包。跨包导入使用`@my-pi-harness/*`；相对导入仅留在同一app/package，源码检查拒绝跨workspace私有源码引用。

## 源码模块组织

源码目录表达实际拥有者，领域内直接引用具体实现。package根`index.ts`只提供公开导出，daemon根`bootstrap.ts`保留进程启动；生成的protocol版本文件和真正包级错误可留在根目录。没有旧路径兼容转发文件，也不以utils收纳未判断归属的代码。

| 源码目录                     | 内部职责                                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/daemon/src`            | `application`负责配置、启动准备和服务装配；`http`负责Fastify、访问校验、错误映射、请求/SSE及Web资源；auth、models、sessions、mcp等领域直接位于src                                                                                          |
| `packages/execution/src`     | `core`负责执行入口与公共定义；`filesystem`负责文件和路径；`process`负责Shell、持久进程、沙箱和回收；`documents`负责内容提取；`web`负责抓取；`office`负责办公生成和编辑                                                                     |
| `packages/integrations/src`  | `mcp`负责传输、目录、schema与租约；`network`提供受限远端访问；`skills`、`plugins`、`connections`及`search`分别拥有资源、插件声明、手动账户和本地向量适配                                                                                   |
| `packages/protocol/src`      | `application`、`sessions`、`tools`、`extensions`和`host`按协议领域提供浏览器安全schema/DTO；host命名不授予Node能力                                                                                                                         |
| `packages/storage/src`       | `profile`负责打开与跨介质提交/恢复；`sqlite`负责表和迁移；`sessions`负责JSONL、附件、查询及派生投影；`repositories`负责独立配置；`credentials`负责凭据；`shared`仅放包级错误与校验                                                         |
| `packages/agent-runtime/src` | `models`负责Provider及模型认证；`sessions`负责主会话；`agents`负责任务树、角色、预算、通信与收束；`runs`复用单次Pi执行；`tools`负责执行与审批；`capabilities`负责发现、绑定和动态加载；`work`负责独立工作状态；`context`负责模型请求上下文 |

ProfileStore保留JSONL、SQLite、锁和失败冻结的单一编排，模型配置仓储通过它的事务入口写入。模型Provider认证、应用登录与插件OAuth继续由各自领域拥有；共享网络访问不归入某一个供应商或MCP传输。

集成错误由实际领域拥有：McpError位于mcp，NetworkError位于network，插件自身错误与OAuth阶段错误位于plugins，Skill资源错误位于skills。宿主在明确调用处完成安全诊断映射；共用HTTP授权启动ticket由http拥有，插件和独立MCP路由分别注册，避免用跨域错误继承或路由混放连接模块。

M3由agent-runtime内的WorkRuntime/context模块拥有规则、预算、摘要和会话工具；WorkStore扩展宿主存储端口，工作状态按分支持久化。daemon的AttachmentService接收显式上传或安全工作区引用，保存冻结内容并提供受保护预览；Renderer仅缓存元数据/ID，base64仅在上传与局部预览操作中存在。人工提问和Plan/Todos不要求工作区；文件/Shell仍执行M2策略。每次模型请求前统一处理预算、压缩与工作状态。自动上下文检查点选择摘要版本；手动会话快照通过新增分支恢复消息前缀和工作状态。二者都不撤销磁盘或外部副作用。

MCP由daemon的`McpService`管理配置、系统秘密与启动授权，`ExternalTools`端口把冻结定义和非秘密授权交给runtime。`integrations`使用官方Client管理协议与租约，stdio字节交给`execution`的受监管持久进程；runtime仍拥有审批、派发前持久屏障及终态。普通GET不创建进程，最后租约释放等待进程组和管道关闭。MCP连接/进程不进入Renderer或storage；接口与平台范围见[本地MCP协议](../03_API/local-mcp.md)。

## 进程和连接

浏览器开发通过 Vite 的同源 `/api` 代理访问 daemon。Electron 开发启动自己的 daemon，等待Web HTTP就绪后加载窗口；发布版由 Electron 启动随包独立 Node，daemon 托管构建后的 Web，窗口连接实际监听端口。

插件OAuth在Web同步打开`/skill-oauth/:id/launch`，由该独立页面请求授权地址并自行跳转；主窗口轮询账号状态，关闭授权窗后停止等待。Electron通过限时一次性启动ticket在系统浏览器打开相同启动页，不共享Renderer Cookie；独立MCP使用同类启动流程。高级手动账户保留独立界面和窗口所有权。

daemon 只监听 `127.0.0.1`。默认 Web 开发端口为 `5174`，独立 daemon 为 `4311`；发布时使用端口 `0` 申请空闲端口，并通过经过校验的启动记录返回实际地址。桌面开发自动启动的 daemon 由桌面进程拥有，退出与启动失败都要回收。

main/preload 只开放明确列举的桌面能力，校验调用来源与输入，不开放任意 IPC channel、文件路径、Shell 或动态代码执行。HTTP与SSE协议见 [API](../03_API/overview.md)，窗口、IPC和平台生命周期见 [桌面约束](../05_CONSTRAINTS/desktop.md)，授权与工具隔离见 [安全约束](../05_CONSTRAINTS/backend.md)。

## 源码与发布产物

lint、typecheck 和源码测试通过 TypeScript paths 解析工作区 `src`，必须能在没有旧构建产物时执行。发布 Node 解析真实 package exports，`packages/protocol`根入口导出`dist/index.js`，内部目录随源码编译至dist；发布验证使用构建产物，不能以源码路径别名代替。

Web源码及其单测使用Bundler编译面；浏览器E2E使用单独的NodeNext测试配置，同时提供DOM类型以检查page.evaluate回调。根Node工具程序不通过测试入口追入Renderer源码，ESLint和typecheck覆盖这几个实际编译面。

NodeNext宿主与共享包的本地相对导入写 `.js`，让编译后的ESM在Node中解析；Web源码及其测试使用Bundler编译面，模块导入无后缀，资源保留实际扩展。生产 daemon 运行编译后的 JavaScript，不依赖 tsx、开发服务器或根工作区源码。

桌面资源同时包含独立 Node、daemon及其生产依赖、Web构建产物。`scripts/node-runtime.mjs`按 `.node-version` 下载官方发行包，在独立目录校验SHA-256并解压完成后原子发布缓存manifest；开发聚合入口与桌面资源准备共用该运行时。产品版本的唯一来源和同步规则见 [发布规范](../06_RELEASES/overview.md)。

开发聚合脚本通过 `scripts/process-tree.mjs` 只管理自己spawn的命令，重复退出共享清理结果。该开发工具与后续Agent执行适配器职责不同，Windows孤儿进程树限制见 [桌面约束](../05_CONSTRAINTS/desktop.md)。

## 启动配置

| 环境变量                         | 含义                                                                |
| -------------------------------- | ------------------------------------------------------------------- |
| `MY_PI_HARNESS_PORT`             | daemon端口，默认4311；0申请动态端口                                 |
| `MY_PI_HARNESS_WEB_DIST_PATH`    | 可选的已构建Web目录；配置后必须包含index.html                       |
| `MY_PI_HARNESS_PARENT_PID`       | 可选的所有者进程ID，用于桌面启动链的退出回收                        |
| `MY_PI_HARNESS_SESSION_LOG_ROOT` | JSONL根覆盖；独立安装包必填，须为绝对路径且末级名为`.my-pi-harness` |

配置在监听、迁移或读取应用资源前校验。`MY_PI_HARNESS_PROFILE_DIRECTORY`指定绝对profile目录，默认位于macOS Application Support或Windows LocalAppData的My Pi Harness/profiles/default；Electron在macOS从app.userData派生同类目录，Windows采用同一LocalAppData规则，避免SQLite进入Roaming目录。独立owner.sqlite持有排他事务，data.sqlite使用WAL，进程死亡由OS释放所有权。

JSONL根与上述数据库位置独立：开发入口、仓库中的daemon源码和正式构建产物统一使用仓库根目录的`.my-pi-harness`，通过模块位置定位，不随cwd或自定义profile改变。独立安装包已脱离源码仓库，启动时必须通过`MY_PI_HARNESS_SESSION_LOG_ROOT`指定该仓库中的隐藏目录；缺失时明确报错。测试显式指定临时日志根。日志实际目录为`<logRoot>/sessions/<SHA256(canonicalProfilePath)>/`，避免Electron和独立daemon的不同profile混写；storage不猜测cwd或NODE_ENV。开发期旧数据按用户授权清理，不做旧格式兼容。JSONL是会话权威，新日志根不能从SQLite反向生成日志；缺失既有日志明确失败。运行数据不进入Git、发布资源或源码扫描。

`MY_PI_HARNESS_DESKTOP_SECRET`仅由main私有启动链注入，不进入公开启动记录；`MY_PI_HARNESS_DEVELOPMENT_ORIGIN`只允许自有5174开发页面。GitHub登录配置来自仓库根`.env`，开发daemon启动时自动加载，进程环境优先。Web使用授权码+PKCE，桌面使用Device Flow；打包只提取Client ID至`desktop-oauth.env`，不分发根`.env`或Client Secret。字段、本机信任、profile归属与恢复语义见[应用登录协议](../03_API/application-auth.md)。

Web开发的 `DAEMON_ORIGIN` 指定同源代理目标，缺省连接上述独立daemon地址。桌面开发入口注入 `MY_PI_HARNESS_NODE_PATH` 和 `MY_PI_HARNESS_RENDERER_URL`，分别选择独立Node与开发页面；发布版根据安装资源和实际daemon地址解析，不使用这些开发覆盖项。

## M5任务所有权

M5的AgentRuntime拥有同Session日志内的子任务树，RunExecution继续拥有每次实际Pi执行。主快照与子转录分开查询，WorkRuntime.forTask复用独立上下文与人工交互；daemon任务API和Web看板消费同一事实。角色、并发预算、通信来源、写入拥有者和树级停止机制见[子Agent设计](../09_TECHNICAL/子Agent与任务看板设计.md)，不由MCP或插件拥有。

## M4能力所有权

`McpService`与`RemoteMcpService`拥有MCP配置、启动与工具授权；`SkillsService`冻结Skill正文、资源及公开gatewayUrl；`PluginService`按精确引用装配Skill和App。`PluginConnectionService`以每插件单一凭据完成OAuth、账号及刷新，专用`PluginCredentialStore`保存0600原子文件。插件manifest声明OAuth与只读路径，私有网关能力只由宿主web_fetch附加；MCP按官方endpoint共享插件Token。接口与桌面适配见[插件连接协议](../03_API/plugin-connections.md)。

MCP目录由宿主按当前身份、配置、凭据epoch和信任指纹保存至SQLite；启动恢复有效快照并后台预热远程服务，输入接受等待有界单飞准备。各服务失败保留独立诊断，不阻塞其他目录；GET不进行发现，关闭和撤销取消所属工作并阻止迟到发布。

`RunCapabilities`冻结候选与当前定义，搜索自动暂存命中，`run.tools_loaded`持久化后推进模型请求。启用Skill摘要、显式提及及目录发现状态纳入模型可见且可回放的上下文，具体限额见[运行时能力协议](../03_API/capability-runtime.md)。daemon拥有懒加载的本地CPU向量Worker，缓存固定版本模型至profile的models目录；Worker不继承供应商凭据环境，关闭时终止推理与下载。语义不可用时保留BM25搜索。插件只读API通过web_fetch访问允许网关，写入通过明确开启的MCP App和原有工具审批；没有固定REST操作或逐Run服务grant工具。高级手动`ConnectionService`只管理独立账户与MCP凭据，不再参与插件默认授权。Office工具由激活Skill或动态加载提供。

生产package包含`integrations/resources/plugins`与`execution/resources/office`；Python/LibreOffice等可选办公依赖按明确配置检测，不在Agent任务中静默安装。资源、Skills及账号授权见[插件体系设计](../09_TECHNICAL/插件体系设计.md)，协议传输、目录与调用见[MCP连接设计](../09_TECHNICAL/MCP连接设计.md)。
