# 里程碑与功能覆盖

本页管理功能范围与里程碑顺序，详细验收由各里程碑 Spec 承担。`规划` 不表示能力已经可用；只有实现与必要验证都完成后才能调整状态。

当前继续M4[插件全链路审计](../04_FEATURES/202610201932_feature_m4-capabilities/plugin-completion.md#插件能力全链路对齐审计2026-10-27)：已补齐MCP目录准备与恢复、搜索自动加载、资源启动对账、Skill跨Run/压缩继承及动态Office激活，完成macOS源码、浏览器、CPU向量和部署资源验证，见[实际记录](../04_FEATURES/202610201932_feature_m4-capabilities/plugin-completion-verify.md#插件能力全链路对齐审计2026-10-27)。已完成同目录[未提交改动冗余审查](../04_FEATURES/202610201932_feature_m4-capabilities/plugin-completion.md#未提交改动冗余审查2026-10-27)，清理被新链路替代的旧入口与重复实现。真实账号仓库访问和平台验收仍单列，M5尚未开始。

Spec目录采用北京时间 `YYYYMMDDHHmm_category_name/`；历史补齐分钟仅用于排序，不能用来推断开发工时。新建和后续小修的规则见[功能文档入口](../04_FEATURES/overview.md)。

已完成[后端模块组织与职责治理](../04_FEATURES/202610271743_refactor_backend-module-governance/spec.md)的实现与本机工程验证：整理daemon与五个能力包的源码归属，清理无效内容及职责混放，结果见[验证](../04_FEATURES/202610271743_refactor_backend-module-governance/verify.md)。属于M0工程范式及M1–M4维护，不扩张里程碑范围，M5仍未开发。

已完成[会话日志数据精简](../04_FEATURES/202610271953_refactor_session-journal-compaction/spec.md)的实现与本机工程验证：删除冗余批次字段、使用结构化私有数据并减少重复请求/工具正文，结果见[验证](../04_FEATURES/202610271953_refactor_session-journal-compaction/verify.md)。保持现有业务与事件链路，不迁移为参考项目架构，不启动M5。

| 里程碑                                                                                      | 交付范围                                                                                                                      | 当前状态                                                              |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [M0 工程底座](../04_FEATURES/202610130900_feature_project-foundation/spec.md)               | Monorepo、开发约束、真实 Web / daemon / Electron 启动、health / SSE、检查与打包链                                             | 实现与macOS本机验证完成；Windows验证待执行                            |
| [M1 模型与会话](../04_FEATURES/202610131100_feature_model-session/spec.md)                  | Pi core / Pi ai、Provider 与认证、模型设置、Session / Run / 事件、JSONL会话事实与SQLite投影恢复、流式对话、输入队列与编辑重发 | 实现与macOS本机验证完成；统一待用户验收，Windows/真实账号待验证       |
| [M1.6 模型设置与规范](../04_FEATURES/202610140900_feature_model-settings/spec.md)           | 设置Dialog、Provider粒度、模型管理、默认选择、四份规范与现有代码整改                                                          | 实现与macOS本机验证完成；待用户统一验收                               |
| [M2 工作区与执行](../04_FEATURES/202610150930_feature_workspace-execution/spec.md)          | Workspace 管理、文件与图片/PDF读取、编辑写入、Diff、文本搜索、Web读写工具、受监管 Shell、策略/审批/沙箱/回收                  | macOS本轮范围已收尾；真实供应商未验证，M2.3用户暂缓且未完成           |
| [M2.1 工作区与文件路径](../04_FEATURES/202610151515_feature_m2-completion/spec.md)          | 注册/执行根策略、敏感目录拒绝、长目录默认名、通用路径规范化与歧义名称拒绝                                                     | 实现与macOS本机验收完成；通用路径测试不等于Windows实机验证            |
| [M2.2 工具运行与验收](../04_FEATURES/202610151515_feature_m2-completion/spec.md)            | 工具轮次ID、Shell输出/回收、工具历史/分支/恢复、目录桥与定向验收入口                                                          | 实现与macOS本机验收完成；真实供应商未验证                             |
| [M2.3 Windows Shell](../04_FEATURES/202610151515_feature_m2-completion/spec.md)             | Windows文件/网络隔离、受控环境、完整进程所有权及实机验证                                                                      | 用户明确暂缓；尚未实现，不标完成                                      |
| [M3 上下文与交互](../04_FEATURES/202610151655_feature_m3-context-interaction/spec.md)       | AGENTS 上下文、附件与引用、预算/裁剪/压缩、checkpoint 对比恢复、工作状态重置、人工提问、Plan / Todos                          | 实现与macOS本机自动化验证完成；待用户统一体验验收                     |
| M3.1 上下文组装与AGENTS                                                                     | 有作用域和优先级的规则发现、运行内容冻结与来源展示                                                                            | 实现与macOS本机自动化验证完成；待用户统一体验验收                     |
| M3.2 附件与引用                                                                             | 文本/图片/PDF上传、文件片段宿主API/历史预览及消息/队列持久化                                                                  | 实现与macOS本机自动化验证完成；待用户统一体验验收                     |
| M3.3 上下文预算与裁剪                                                                       | 每请求预算、Usage辅助估算、输出预留与完整工具组                                                                               | 实现与macOS本机自动化验证完成；待用户统一体验验收                     |
| M3.4 上下文压缩                                                                             | Run内结构化压缩、版本链、fallback与任务连续性                                                                                 | 实现与macOS本机自动化验证完成；待用户统一体验验收                     |
| M3.5 人工提问                                                                               | 多题单/多选/自由回答、取消停止与原Run继续                                                                                     | 实现与macOS本机自动化验证完成；待用户统一体验验收                     |
| M3.6 Plan/Todos                                                                             | 同Run计划审核、结构化步骤/Todo证据与只读规划                                                                                  | 实现与macOS本机自动化验证完成；待用户统一体验验收                     |
| M3.7 检查点与重置                                                                           | 摘要版本恢复、本会话检索、任务/上下文重置与手动会话快照                                                                       | 实现与macOS本机自动化验证完成；待用户统一体验验收                     |
| M3.8 整体联调与验收                                                                         | JSONL恢复/质量用例、源码/HTTP/浏览器/桌面及M1/M2回归                                                                          | 实现与macOS本机自动化验证完成；待用户统一体验验收                     |
| [对话渲染与交互](../04_FEATURES/202610191647_feature_conversation-rendering/spec.md)        | Streamdown Markdown、消息增量、动态虚拟列表、轻量工具行、回答统计、阅读滚动与单会话日志下载                                   | 实现与macOS定向验证完成；主体UI及输入框高度获用户认可，测量边界保留   |
| [M4前置：用户身份与应用登录](../04_FEATURES/202610161500_feature_application-login/spec.md) | GitHub身份、单profile归属、持久应用会话、本机信任与统一API/SSE鉴权                                                            | 实现与macOS自动化交付完成；待真实GitHub及用户review                   |
| [M4 MCP 与插件](../04_FEATURES/202610201932_feature_m4-capabilities/spec.md)                | stdio / HTTP / SSE、信任与凭据、OAuth、工具发现加载、Skills创建安装管理、插件市场、外部服务连接与办公文档工作流               | 工程实现与macOS自动化联调通过；必要视觉、账号及Windows适配/验收待完成 |
| M4.1 本地MCP闭环                                                                            | 配置/信任、受监管stdio、统一Run工具集、发现/审批调用与基础设置                                                                | 本地SDK/Pi/JSONL/浏览器链路通过；平台与产物边界单列                   |
| M4.2 工具目录与按需加载                                                                     | 目录/名称/schema、tool_search、Run内显式加载、工具级策略及导入导出                                                            | 实现与macOS定向验证完成；外部环境证据见本轮验证                       |
| M4.3 远程MCP与OAuth                                                                         | Streamable HTTP/SSE、静态认证、OAuth、网络与未知结果                                                                          | 实现与macOS定向验证完成；外部环境证据见本轮验证                       |
| M4.4 Skills运行时                                                                           | 发现/解析、显式选择、渐进加载、权限和压缩连续性                                                                               | 实现与macOS定向验证完成；外部环境证据见本轮验证                       |
| M4.5 Skills创建与管理                                                                       | 作用域、创建/安装、启停、详情、卸载与失败清理                                                                                 | 实现与macOS定向验证完成；外部环境证据见本轮验证                       |
| M4.6 插件市场与装配                                                                         | 九个范围内内置插件、manifest、Skills/MCP apps与整体/逐项管理                                                                  | 实现与macOS定向验证完成；外部环境证据见本轮验证                       |
| M4.7 外部服务连接                                                                           | 五个服务族、Plugin OAuth、受限REST gateway及共享MCP凭据                                                                       | 实现与macOS定向验证完成；外部环境证据见本轮验证                       |
| M4.8 办公文档工作流                                                                         | 文档读取/PDF页图、四类办公任务、独立资源、依赖检测及文件交付                                                                  | 实现及结构/PDF页图验证完成；Office必要视觉检查待完成                  |
| M4.9 联调与交付                                                                             | Web/Electron、真实SDK/Pi、恢复/取消、M1–M3回归与平台/账号证据                                                                 | 本机源码/浏览器/桌面通过；平台、账号与正式发布待验收                  |
| M5 子 Agent 与看板                                                                          | 角色与预算、执行树、嵌套委派/等待/通信/停止、独立上下文、任务看板、进度/待处理/人工确认                                       | 本轮提交后进入设计，尚未实现                                          |
| M6 记忆与搜索                                                                               | user / workspace 长期记忆、学习与增改删、画像、FTS与本地embedding混合召回、Session搜索、工具目录检索                          | 规划                                                                  |
| M7 完整对齐验收                                                                             | 主/子Trace、请求快照、用量和费用估算、文件撤销重做、长会话恢复与JSONL导入导出、全功能回归、安装包与平台验收                   | 规划                                                                  |
| 后续 Computer Use 专项                                                                      | 原生观察、语义树、窗口截图、输入、应用授权、受限脚本与AI光标                                                                  | 当前版本排除，不纳入 M0–M7 完成标准                                   |
| 第二阶段                                                                                    | 根据独立产品需求新增或调整能力                                                                                                | 待规划                                                                |

## 第一阶段完成标准

2026-10-27已完成插件架构重构及macOS定向验证：插件专属OAuth/凭据、弹窗自行启动、只读HTTP网关和MCP共享Token取代默认账户桥接，目录发现由受管后台任务完成。范围见[完整重构Spec](../04_FEATURES/202610201932_feature_m4-capabilities/plugin-completion.md#插件完整流程重构2026-10-27)，实际结果及真实客户端/系统浏览器/平台缺口见[本轮验证](../04_FEATURES/202610201932_feature_m4-capabilities/plugin-completion-verify.md#插件完整流程重构2026-10-27)。M5尚未开始。

2026-10-26已完成M4插件授权开窗收尾：Web同步打开独立中转页，再由原页面请求并导航授权地址；桌面继续系统浏览器。实现及验证见[补齐Spec](../04_FEATURES/202610201932_feature_m4-capabilities/plugin-completion.md#授权开窗补充2026-10-26)，不进入M5或新增默认供应商客户端。

2026-10-26已完成[M4插件连接与任务工作流补齐](../04_FEATURES/202610201932_feature_m4-capabilities/plugin-completion.md)的实现及macOS定向验证：插件内账户绑定、精确App门控、服务Skills及办公排版/检查流程，见[本轮结果](../04_FEATURES/202610201932_feature_m4-capabilities/plugin-completion-verify.md)。M5尚未开发；真实账号、DOCX页面视觉及Windows验收缺口继续保留。

2026-10-22已实现并完成本机验证的[应用初始化与统一加载](../04_FEATURES/202610221610_feature_application-initialization/spec.md)，属于M0启动体验及M4界面收尾；统一登录/协议检查与首屏必要数据准备，保持后台刷新不遮挡工作台，不新增里程碑范围。

2026-10-19已完成[M3复核与M4前代码治理](../04_FEATURES/202610191506_refactor_m3-readiness-governance/verify.md)，M3.1–M3.8工程范围没有未实现子项；修复计划关联、附件预览缓存、CI配置与过期指南后完成本机回归，可进入M4.1设计和开发。用户体验、真实供应商/GitHub授权及其他平台证据继续单列，M2暂缓项不标完成。

M4沿用已确认的M4.1–M4.9边界，具体工作包、代码归属、依赖及完成门槛见[实施任务](../04_FEATURES/202610201932_feature_m4-capabilities/tasks.md)。对话渲染与交互已完成实现和本机定向验证，用户认可主体UI及输入框高度；真实供应商速度和细微像素摆动边界仍见其验证记录。2026-10-20已实现[M4.1本地MCP](../04_FEATURES/202610201932_feature_m4-capabilities/local-mcp.md)：配置、秘密、独立启动信任、受监管stdio/SDK/租约、冻结选择、逐次审批及unknown停止链路接通，接受审计、模型声明、预算、路由与JSONL结果同源。实际验证和未覆盖的平台/产物见[verify](../04_FEATURES/202610201932_feature_m4-capabilities/verify.md)。2026-10-22已完成M4.2–M4.9工程实现与macOS自动化组合验证，设计分别见runtime-extensions、mcp-expansion、skills-plugins、connections与office子Spec；[本轮整体验证](../04_FEATURES/202610201932_feature_m4-capabilities/m4-completion-verify.md)记录实际命令、结果和必要验收缺口。Office视觉、真实账号与Windows适配仍待完成，不能将整个M4标为已验收。

既有M2/M3的[审批与JSONL优化](../04_FEATURES/202610151800_feature_approval-session-jsonl/spec.md)新增请求批准、独立AI帮我批准、完全访问三种策略，以及每会话公开JSONL镜像；具体验证见同目录记录。本轮M3前置重构将JSONL升级为会话执行事实源，SQLite保留配置及可重建投影；旧公开镜像不再作为目标架构。开发期不保留旧格式兼容。会话体验专项提供单会话原始JSONL下载；包含附件、配置、导入和恢复的完整导入导出仍属M7。M7其余范围仍为后续迭代；远程MCP、动态加载、Skills与插件本轮已实现并完成本机联调，继续M4用户review和剩余验收。Windows Shell继续暂缓。

用户后续调整添加上下文菜单为“上传文件、MCP、Skill”：M4已解禁MCP与Skill选择，运行中输入沿用原接受绑定。M3.7明确包含压缩后的当前会话原文检索；跨会话搜索和长期记忆仍属M6。

M3.2文件引用保留宿主API及已有历史预览，添加引用的前端入口按用户决定移除。

M2工作区管理的交互见[目录选择与图标Spec](../04_FEATURES/202610151534_feature_workspace-creation/spec.md)：Electron支持点击/拖入目录与持久化图标；用户已明确将浏览器新增目录留待后续，已有工作区使用与编辑保留。最终审查、工具顺序修复、0.2.0本地提交与保留项见[收尾Spec](../04_FEATURES/202610151555_refactor_m2-finalization/spec.md)。Windows、浏览器新增目录及账号验证缺口继续保留所属M2范围，不迁移为M3内容。

侧栏的整行即时hover、右侧更多/加号与显式新对话入口见[导航Spec](../04_FEATURES/202610151400_refactor_workspace-navigation/spec.md)；目录标题仅展开/收起，新建入口不提前生成空Session，沿用M2归属。

M1–M7 覆盖完整对话、模型设置、本地工具、安全执行、MCP/Skills/插件、办公文档、上下文、人工交互、子 Agent、看板、记忆、搜索、Trace、用量、文件审核与恢复。每项必须有功能 Spec 与相应验证证据；界面入口存在不等于底层能力完成。

macOS 与 Windows 的桌面安装、服务启动、工具执行及清理分别验证。平台能力缺口不能通过默认切换完全访问模式或删除验收项掩盖。

交互式内嵌终端、对外 MCP Server、通用文档向量 RAG、多输出追踪后端等不属于当前已确认对齐范围，若需要单独提出需求。

本轮[代码治理](../04_FEATURES/202610161244_refactor_code-governance/spec.md)属于M0工程范式及M1–M3存量维护，统一类型命名、业务联合、弃用API和空值可读性，不改变里程碑范围或进入M4。

进入M4前的[M3复核与技术沉淀](../04_FEATURES/202610161259_refactor_m3-review-technical-docs/spec.md)确认M3实现及本机自动化证据齐备，体验/真实供应商与平台限制继续保留原状态；五篇[核心技术设计](../09_TECHNICAL/技术文档总览.md)覆盖M1–M3，不作为M4扩展能力完成证据。
