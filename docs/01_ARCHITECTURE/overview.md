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

| 路径                     | 负责                                                                 | 不负责                                                        |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/web`               | 页面、交互、HTTP/SSE客户端、状态呈现                                 | Node API、凭据与Agent实例                                     |
| `apps/daemon`            | API装配、客户端初始化与应用登录、事件重放、profile与服务生命周期     | 页面组件与桌面窗口                                            |
| `apps/desktop`           | Electron窗口、有限preload桥、daemon启动和退出、桌面资源与发布装配    | Agent Loop、业务数据库与工具实现                              |
| `packages/agent-runtime` | Pi模型、认证与主/子Run编排、任务树及请求调度、审批、取消、队列和分支 | Electron、React、Fastify与SQL实现                             |
| `packages/tools`         | 35个原生工具、通用Skill目录/不可变资源、受管理命令                   | 插件生命周期、Pi Loop、审批决定、数据库、OAuth或MCP协议       |
| `packages/memory`        | 记忆事实规则、revision/幂等、候选确认及固定/相关选择                 | HTTP、SQL、Pi、模型Worker及第二份画像正文                     |
| `packages/plugins`       | 插件声明/资源、安装启停更新、贡献与授权生命周期                      | SQL、HTTP、模型运行或通用Skill引擎                            |
| `packages/sandbox`       | 宿主文件守卫、公网地址判定、平台隔离与受监管字节进程                 | 工具名称、插件状态、Pi、数据库与业务DTO                       |
| `packages/integrations`  | MCP传输/目录/租约、通用OAuth、受控网络与高级账户协议适配             | 插件业务、本地推理、数据库、启动授权决策、Pi Loop、HTTP与页面 |
| `packages/storage`       | JSONL批日志、SQLite配置/投影、附件和产物blob、profile锁与凭据        | 模型调用和页面状态                                            |
| `packages/protocol`      | 公开跨端DTO/schema、协议版本、桌面桥及宿主internal共享数据           | Node imports、业务服务、环境读取或运行时实例                  |
| `packages/tsconfig`      | 明确的TypeScript编译配置                                             | 运行时代码                                                    |

`agent-runtime`通过明确RuntimeStore/ProviderStore与SecretStore接口接入宿主，ToolRuntime按冻结策略逐次确认、调用独立ModelApprovalReviewer或使用用户明确选择的full-access，再调用tools注册项为当前Run绑定的领域端口；daemon提供工作区、命令、Skill和产物服务及复核资料，Renderer只消费公开工具事件。`storage`拥有JSONL会话事实、不可变附件及产物字节，以及SQLite配置/会话投影；完整批次校验后先写日志并fsync，再提交SQLite投影，Runtime随后发布公开SSE。文本/思考片段通过独立发布入口更新内存覆盖层，不写日志或SQLite；公开快照合并当前片段，持久seq与实时修订分别追踪。失败冻结持久写入，重启从日志重建并中断在途运行，不恢复未持久片段或重执行副作用。其他package在真实职责出现时创建，避免无边界共享工具包。跨包导入使用`@my-pi-harness/*`；相对导入仅留在同一app/package，源码检查拒绝跨workspace私有源码引用。

仓库级ESLint配置与项目自定义规则由`scripts/eslint`拥有，根`eslint.config.js`是唯一入口；开发依赖归根devDependencies，各workspace复用根配置，不为本仓专用规则建立独立package。

## 源码模块组织

源码目录表达实际拥有者，领域内直接引用具体实现。package根`index.ts`只提供公开导出，daemon根`bootstrap.ts`保留进程启动；生成的protocol版本文件和真正包级错误可留在根目录。没有旧路径兼容转发文件，也不以utils收纳未判断归属的代码。

| 源码目录                     | 内部职责                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/daemon/src`            | `application`负责配置、启动准备和服务装配；`http`负责Fastify、访问校验、错误映射、请求/SSE及Web资源；`memory`解析记忆用例、身份与主子范围；`search`拥有持久检索、后台索引及共享本地模型Worker；auth、models、sessions、mcp等领域直接位于src                                                                             |
| `packages/tools/src`         | `tools`按工具名平铺，一工具一文件，拥有参数、策略、回调类型与执行入口；`lib/tool-registry`拥有注册契约，`lib/tool-context`声明公共执行上下文；根`workspace-tool-registry`装配目录；`utils`提供检索及文档提取；`skills`拥有通用发现、冻结与资源租约，`commands`拥有命令状态                                              |
| `packages/plugins/src`       | `plugins/<id>`保存插件声明、Skill正文和脚本；`lifecycle`拥有安装/启停/更新/卸载，`auth`拥有插件授权生命周期；`apps`和`gateway`管理固定贡献与访问规则，`accounts`提供高级账户供应商策略                                                                                                                                  |
| `packages/sandbox/src`       | `filesystem`拥有真实路径与稳定读取；`network`拥有地址原语；`policy`拥有共享敏感名称规则；`platform`实现OS隔离；`process`拥有启动、字节流、预算、watchdog与物理回收                                                                                                                                                      |
| `packages/integrations/src`  | `mcp`负责传输、目录、schema与租约；`network`提供受限远端访问；`oauth`提供共用授权码、PKCE、交换/刷新与安全错误，`connections`提供高级账户凭据编码和协议适配                                                                                                                                                             |
| `packages/protocol/src`      | `application`、`sessions`、`tools`、`extensions`、`memory`、`search`和`host`提供公开schema/DTO；`internal`提供宿主冻结绑定、恢复/提交记录和插件私有数据；两个出口均无Node依赖                                                                                                                                           |
| `packages/storage/src`       | `profile`负责打开、锁与跨介质唯一提交；`sqlite`负责表和迁移；`sessions`负责JSONL、附件、查询、恢复与派生投影；`artifacts`负责元数据/引用、不可变blob、配额与下载租约；`memory`负责独立记忆事务与来源，`search`负责派生索引和只读来源窗口；`repositories`负责独立配置；`credentials`负责凭据；`shared`仅放包级错误与校验 |
| `packages/agent-runtime/src` | `models`负责Provider及模型认证；`sessions`负责主会话；`subagents`负责任务树、角色、请求调度、通信与收束；`runs`复用单次Pi执行；`tools`负责每Run领域绑定、执行与审批；`capabilities`负责发现、绑定和动态加载；`work`负责独立工作状态；`context`负责模型请求上下文                                                        |

ProfileStore保留JSONL、SQLite、锁和失败冻结的单一编排，模型配置仓储通过它的事务入口写入。SessionQueries拥有快照、队列来源、幂等结果和事件分页；SessionRecovery在所属启动事务内重建，SessionEventCommit校验和暂存会话创建及事件，ArtifactRepository管理产物元数据与引用。

protocol根入口只导出公开跨端数据，宿主使用显式internal出口。EventInput、RequestAcceptance和SessionCreateRecord由internal唯一定义；公开协议不依赖internal，Renderer不导入internal，runtime与storage不为复用类型相互依赖实现。ProviderConfig是公开配置和认证状态，带credentialRef的ProviderRecord仅在internal共享；工具文本/图像内容也通过internal的ToolContent统一。

队列接受元数据由protocol/internal的QueueCapabilityMetadataSchema唯一定义；storage校验持久写入、回放和查询数据，runtime消费已校验类型并重验当前能力授权。宿主启动独立调用存储恢复，恢复不属于RuntimeStore执行端口。SkillCatalog只提供有序来源和内容；daemon的SkillsService使用一次发现快照计算当前启用与遮蔽，详情和冻结共用该快照，冻结时仍重新读取所选来源校验hash。

默认子Agent角色、提示与限制归agent-runtime/subagents/default-settings，daemon将工厂显式注入ProfileStoreOptions。storage只管理配置的持久化与revision，不提供默认业务策略，也不因打开profile写入默认配置；没有已存配置且宿主未注入时明确失败。

模型Provider认证、应用登录与插件授权继续由各自领域拥有；插件与高级账户复用integrations/oauth的协议机制，保留各自账户和安装归属。plugins通过窄接口使用宿主存储、凭据、Skills与MCP；tools和integrations不反向依赖plugins。

Agent执行内部以拥有者拆分：主子Run共用`runs/prepare`准备输入接受事实，`runs/execution`管理生命周期，SDK装配、输入投递和消息事件记录各自独立。`runs/ports`声明RunHooks和注入输入接口，subagents适配器实现它们，runs不反向导入子任务领域；SubagentCoordinator唯一拥有任务树和资源收束，通信与委派策略各归所属模块。tools包的完整注册项统一模型定义、可用条件、效果策略和绑定入口，runtime的`tools/selection`按调用者约束选择初始集合和获准候选，`RunCapabilities`拥有请求前激活，`RunSkills`管理正文和资源租约；`tools/runtime`编排逐次校验、审批及结果，`tools/bindings`为主子Run分别绑定领域端口。具体文件职责由[agent-runtime](../../packages/agent-runtime/README.md#源码职责)维护，消息和持久格式由既有协议拥有。

集成错误由实际领域拥有：McpError位于integrations/mcp，NetworkError位于integrations/network，OAuth阶段错误位于integrations/oauth；插件领域错误由plugins拥有，Skill错误由tools/skills拥有。宿主在明确调用处完成安全诊断映射；共用HTTP授权启动ticket由http拥有，插件和独立MCP路由分别注册，避免用跨域错误继承或路由混放连接模块。

M3由agent-runtime内的WorkRuntime/context模块拥有规则、预算、摘要和会话工具；WorkStore扩展宿主存储端口，工作状态按分支持久化。daemon的AttachmentService接收显式上传或安全工作区引用，保存冻结内容并提供受保护预览；Renderer仅缓存元数据/ID，base64仅在上传与局部预览操作中存在。人工提问和Plan/Todos不要求工作区；文件/Shell仍执行M2策略。每次模型请求前统一处理预算、压缩与工作状态。自动上下文检查点选择摘要版本；手动会话快照通过新增分支恢复消息前缀和工作状态。二者都不撤销磁盘或外部副作用。

MCP由daemon的`McpService`管理配置、系统秘密与启动授权，`ExternalTools`端口把冻结定义和非秘密授权交给runtime。`integrations`使用官方Client管理协议与租约，stdio字节交给`sandbox`的受监管持久进程；runtime仍拥有审批、派发前持久屏障及终态。普通GET不创建进程，最后租约释放等待进程组和管道关闭。MCP连接/进程不进入Renderer或storage；接口与平台范围见[本地MCP协议](../03_API/local-mcp.md)。

## 工具、资源与产物

工具的定义、来源、默认/按需加载、可用条件、参数效果策略和执行绑定由`ToolRegistration`统一声明。原生领域直接贡献注册项，外部MCP保留自己的精确Server绑定；runtime按同一接受集合校验、审批和记录，主子Run分别绑定当前会话、任务、角色和工作区端口。tools与integrations分别依赖sandbox，彼此不导入实现；sandbox不依赖tools、integrations、Pi、storage或业务protocol。

sandbox/network拥有可取消的DNS查询、全部解析地址校验及socket固定查找；tools的Web请求和integrations的远端传输分别提供地址策略，并保留各自URL、凭据、网关、重定向及正文限制，不因共用网络机制合并访问权限。

原生工具在`packages/tools/src/tools/`按名称平铺，每个文件集中拥有自己的schema、描述、可用条件、策略和执行逻辑；`tools/index.ts`只聚合导出，根`workspace-tool-registry.ts`组合目录。注册契约、公共上下文与共用文件操作由`lib`拥有，检索与授权字节正文提取在`utils`；具体工具回调类型随工具定义，命令和通用Skill由tools内领域服务负责，插件贡献由plugins负责。这些服务不按模型工具数量拆分。具体源码职责见[tools包](../../packages/tools/README.md#公开入口与源码职责)。

Skill快照留在私有存储，命令读取的副本由租约物化到profile外。首次模型请求前完成初始Skill的物化，以`run.tools_loaded`持久化同一正文/授权及当前`resourceDirectory`；本Run已记录的目录不可替换，历史接受记录的目录可在新Run首次加载时重新绑定。后台命令独立retain资源引用，每秒复核授权与hash，撤销后停止，再释放资源。命令总时限与一次工具等待分别管理；成功根Run可留下受监管命令，子任务终态收束所属命令。

publish_artifact通过宿主稳定读取获准文件，将精确字节写入私有blob；artifact.published与成功工具终态及canonical结果同批提交。下载按artifact ID核对会话、分支和任务可见性，只读注册字节，不重新打开源文件。命令、产物和沙箱的机制及实际限制见[工具体系与沙箱](../09_TECHNICAL/工具体系与沙箱.md)，公开参数和字段见[运行时能力协议](../03_API/capability-runtime.md)。

## 进程和连接

浏览器开发通过 Vite 的同源 `/api` 代理访问 daemon。Electron 开发启动自己的 daemon，等待Web HTTP就绪后加载窗口；发布版由 Electron 启动随包独立 Node，daemon 托管构建后的 Web，窗口连接实际监听端口。

插件OAuth在Web同步打开`/skill-oauth/:id/launch`，由该独立页面请求授权地址并自行跳转；主窗口轮询账号状态，关闭授权窗后停止等待。Electron通过限时一次性启动ticket在系统浏览器打开相同启动页，不共享Renderer Cookie；独立MCP使用同类启动流程。高级手动账户保留独立界面和窗口所有权。

daemon 只监听 `127.0.0.1`。默认 Web 开发端口为 `5174`，独立 daemon 为 `4311`；发布时使用端口 `0` 申请空闲端口，并通过经过校验的启动记录返回实际地址。桌面开发自动启动的 daemon 由桌面进程拥有，退出与启动失败都要回收。

main/preload 只开放明确列举的桌面能力，校验调用来源与输入，不开放任意 IPC channel、文件路径、Shell 或动态代码执行。HTTP与SSE协议见 [API](../03_API/overview.md)，窗口、IPC和平台生命周期见 [桌面约束](../05_CONSTRAINTS/desktop.md)，授权与工具隔离见 [安全约束](../05_CONSTRAINTS/backend.md)。

## 源码与发布产物

后端私有包通过package exports直接导出`src`中的TypeScript；lint、typecheck、源码测试和生产部署使用同一出口，不需要后端dist或源码覆盖别名。源码和静态资源一同部署到独立目录，生产验证检查真实出口及依赖，不能回退源码仓库。

TypeScript使用ESNext与Bundler解析并执行noEmit检查。Web、宿主、浏览器测试各自声明编译面与ambient类型；E2E提供DOM类型以检查page.evaluate回调。根宿主程序不通过测试入口追入Renderer源码，ESLint和typecheck覆盖这些实际编译面。

前后端TS/TSX模块导入统一无后缀，由tsx或构建器解析对应源码；真实JS脚本和静态资源保留实际扩展。普通Node脚本仍采用原生文件解析；已明确由tsx加载的辅助入口对TS目标遵循同一无后缀规则，具体约定见[源码规范](../05_CONSTRAINTS/source-layout.md#模块导入)。开发与生产daemon均由独立Node通过生产依赖tsx运行`src/bootstrap.ts`，不依赖开发服务器、用户工具链或根工作区。Web与Electron main/preload继续构建；普通Electron进程只加载JS/CJS产物，协议源码及必要依赖在构建时打入main/preload。

桌面资源同时包含独立 Node、daemon及其生产依赖、Web构建产物。`scripts/node-runtime.mjs`按 `.node-version` 下载官方发行包，在独立目录校验SHA-256并解压完成后原子发布缓存manifest；开发聚合入口与桌面资源准备共用该运行时。产品版本的唯一来源和同步规则见 [发布规范](../06_RELEASES/overview.md)。

开发聚合脚本通过 `scripts/process-tree.mjs` 只管理自己spawn的命令，重复退出共享清理结果。该开发工具与后续Agent执行适配器职责不同，Windows孤儿进程树限制见 [桌面约束](../05_CONSTRAINTS/desktop.md)。

## 启动配置

| 环境变量                          | 含义                                                                |
| --------------------------------- | ------------------------------------------------------------------- |
| `MY_PI_HARNESS_PYTHON`            | 可选的绝对Python解释器路径，供固定文档读取/渲染入口使用             |
| `MY_PI_HARNESS_PORT`              | daemon端口，默认4311；0申请动态端口                                 |
| `MY_PI_HARNESS_WEB_DIST_PATH`     | 可选的已构建Web目录；配置后必须包含index.html                       |
| `MY_PI_HARNESS_PARENT_PID`        | 可选的所有者进程ID，用于桌面启动链的退出回收                        |
| `MY_PI_HARNESS_PROFILE_DIRECTORY` | 可选的绝对profile目录；Web与桌面由daemon统一解析                    |
| `MY_PI_HARNESS_SESSION_LOG_ROOT`  | JSONL根覆盖；独立安装包必填，须为绝对路径且末级名为`.my-pi-harness` |

配置在监听、迁移或读取应用资源前校验。daemon的`loadDaemonConfig()`是profile目录的唯一解析者，Web与桌面入口都使用它。`MY_PI_HARNESS_PROFILE_DIRECTORY`显式指定绝对目录；未设置时，macOS固定使用`~/Library/Application Support/@my-pi-harness/desktop/profiles/default`，Windows使用`%LOCALAPPDATA%/My Pi Harness/profiles/default`。macOS路径中的`@my-pi-harness/desktop`是固定数据命名空间，不随开发/发布应用名称或Electron的`userData`变化，不探测其他目录作为回退。独立owner.sqlite持有排他事务，data.sqlite使用WAL，进程死亡由OS释放所有权。

桌面main传递已有进程环境，由独立Node加载环境文件后交给daemon解析；开发使用仓库根`.env`，发布只使用随包`desktop-oauth.env`，进程环境优先于环境文件。main不从`app.getPath('userData')`生成或覆盖profile配置。Electron的`userData`只保存Cookie和缓存，`--user-data-dir`不改变业务profile；两个入口使用相同环境配置时访问同一套业务数据，仍各自维护登录Cookie。

JSONL根与上述数据库位置独立：开发入口、仓库中的daemon源码和正式构建产物统一使用仓库根目录的`.my-pi-harness`，通过模块位置定位，不随cwd或自定义profile改变。独立安装包已脱离源码仓库，启动时必须通过`MY_PI_HARNESS_SESSION_LOG_ROOT`指定该仓库中的隐藏目录；缺失时明确报错。测试显式指定临时日志根。日志实际目录为`<logRoot>/sessions/<SHA256(canonicalProfilePath)>/`，避免Electron和独立daemon的不同profile混写；storage不猜测cwd或NODE_ENV。开发期旧数据按用户授权清理，不做旧格式兼容。JSONL是会话权威，新日志根不能从SQLite反向生成日志；缺失既有日志明确失败。运行数据不进入Git、发布资源或源码扫描。

`MY_PI_HARNESS_DESKTOP_SECRET`仅由main私有启动链注入，不进入公开启动记录；`MY_PI_HARNESS_DEVELOPMENT_ORIGIN`只允许自有5174开发页面。浏览器自动初始化客户端后进入应用登录，无需通信码；初始化只关联客户端，不授予业务访问。GitHub登录配置来自仓库根`.env`，开发daemon启动时自动加载，进程环境优先。Web使用授权码+PKCE，桌面使用Device Flow；打包只提取Client ID至`desktop-oauth.env`，不分发根`.env`或Client Secret。字段、客户端、profile归属与恢复语义见[应用登录协议](../03_API/application-auth.md)。

Web开发的 `DAEMON_ORIGIN` 指定同源代理目标，缺省连接上述独立daemon地址。桌面开发入口注入 `MY_PI_HARNESS_NODE_PATH` 和 `MY_PI_HARNESS_RENDERER_URL`，分别选择独立Node与开发页面；发布版根据安装资源和实际daemon地址解析，不使用这些开发覆盖项。

## M5任务所有权

M5的SubagentCoordinator拥有同Session日志内的子任务树，RunExecution继续拥有每次实际Pi执行。主快照与子转录分开查询，WorkRuntime.forTask复用独立上下文与人工交互；daemon任务API和Web看板消费同一事实。角色、请求并发、通信来源、写入拥有者和树级停止机制见[子Agent设计](../09_TECHNICAL/子Agent与任务看板设计.md)，不由MCP或插件拥有。

## M4能力所有权

联网搜索与网页正文采用独立DeepSeek服务：tools定义web_search及web_fetch的page/raw模型参数，integrations/web校验官方响应并执行远程传输，daemon/web拥有系统凭据、请求代次取消和设置API，Web只管理秘密表单及公开状态。raw请求与精确插件网关继续由tools执行，不上传本地URL；聊天模型和本地记忆检索不负责联网服务，详见[联网工具协议](../03_API/web-tools.md)。

`McpService`与`RemoteMcpService`拥有MCP配置、启动与工具授权；`SkillsService`冻结Skill正文、资源及公开gatewayUrl；plugins包的`PluginService`按精确引用管理安装和Skill/App贡献，`PluginConnectionService`拥有每插件单一授权、账号、刷新及撤销；daemon注入存储、Skills、MCP和回调配置。专用`PluginCredentialStore`由storage保存0600原子文件，通用OAuth机制由integrations提供。插件manifest声明OAuth与只读路径，私有网关能力只由宿主web_fetch的raw GET模式附加；MCP按官方endpoint共享插件Token。接口与桌面适配见[插件连接协议](../03_API/plugin-connections.md)。

MCP目录由宿主按当前身份、配置、凭据epoch和信任指纹保存至SQLite；启动恢复有效快照并后台预热远程服务，输入接受等待有界单飞准备。各服务失败保留独立诊断，不阻塞其他目录；GET不进行发现，关闭和撤销取消所属工作并阻止迟到发布。

`RunCapabilities`管理真实session/workspace/MCP来源的候选与当前集合，搜索自动暂存命中，`run.tools_loaded`持久化后推进下一请求，结束释放且新Run重新选择。Skill候选元数据、显式正文及目录诊断进入可回放接受事实，模型按ID加载，由宿主解析预期内容与插件授权代次；正文继承独立于可执行工具集合。默认/按需策略及限额见[运行时能力协议](../03_API/capability-runtime.md)。daemon/search拥有懒加载的本地CPU向量Worker，Transformers.js为daemon生产依赖；缓存固定版本模型至profile的models目录，不继承供应商凭据环境；关闭时终止推理与下载，语义不可用时保留词法检索。插件只读API通过web_fetch的raw GET模式访问允许网关，写入通过明确开启的MCP App和原有审批；不另建Skill工具grant。高级手动`ConnectionService`保持独立用途，办公Skill通过通用命令、文档/视觉读取和产物注册完成任务。

生产部署同时包含`plugins/src`和`tools/src`：插件manifest、App声明、Skill及专属脚本位于`plugins/src/plugins/<id>`，共用办公支持位于`plugins/src/plugins/shared/office`；原生PDF页图支持位于`tools/src/utils/document-view`。daemon将三个共享办公脚本与原生pdf_safety.py合成显式resourceSources映射，通用Skill引擎只解析已注册来源，继续按清单路径、大小和hash冻结；运行资源物化到profile外受控目录。Python/LibreOffice等可选办公依赖按明确配置检测，准备依赖使用获准的普通命令。资源、Skills及账号授权见[插件体系设计](../09_TECHNICAL/插件体系设计.md)，协议传输、目录与调用见[MCP连接设计](../09_TECHNICAL/MCP连接设计.md)。

## M6记忆与历史所有权

`MemoryApplicationService`用profile owner和实际Session/Task解析范围，`packages/memory`拥有事实、直接写入与学习规则，storage在原profile事务中保存独立记忆及派生检索。`runs/request.ts`的`dispatchRequest`在名额等待后再次核验当前事实与来源，将usage和最终prepared同批提交，再立即交给Provider；引用正文在实际输入中只保存一份。具体流程见[长期记忆与搜索设计](../09_TECHNICAL/长期记忆与搜索设计.md)。

`LocalSearchModelResource`唯一拥有一个Worker，embedding与相关性复核是两个独立状态视图；资源显式准备，已缓存模型可直接本地懒加载，普通查询不下载。历史阅读使用精确来源窗口，模型默认窄搜索与人类所选引用分开授权。Web Query保存结果正文，Zustand只保存筛选、定位和待发引用；虚拟时间线继续按需挂载，阅读不切换执行分支。HTTP和持久字段见[记忆与搜索协议](../03_API/memory-search.md)。
