# M4标杆能力核对

日期：2026-10-16。只读检查本机pi-harness工作树的实际源码，不以AGENTS、类型字段或README承诺代替实现。本页记录功能范围与对齐方式，不复制业务代码、内部提示词、Skill正文、脚本或历史功能文档；源文件路径仅作分析定位，不成为本仓库运行依赖。

本项目基线为已提交的0.4.0：M3已具备Pi运行、审批、JSONL事实、上下文预算与工作状态；MCP和Skill仍是禁用入口，没有扩展实现。具体拆分和验收由[Spec](spec.md)拥有。

## MCP

下表的路径均相对于标杆pi-harness仓库。

| 能力                               | 标杆实际状态                                                                   | 本项目对齐位置                 | 源码定位                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 连接方式                           | stdio自定义受监管transport，HTTP和SSE使用官方SDK                               | M4.1、M4.3                     | apps/daemon/src/mcp/transports/factory.ts；transports/stdio.ts                                       |
| 服务配置                           | 全局配置、CRUD、版本冲突、启停、连接信任；不是每工作区配置一套Server           | M4.1                           | services/mcp-server-service.ts；storage/mcp-server-repository.ts                                     |
| 配置导入导出                       | JSON预览、批量导入、单Server导出API；表单/JSON编辑；没有独立Web导出按钮        | M4.2                           | routes/mcp-routes.ts；Web settings/utils/mcp-form.ts                                                 |
| 秘密与静态认证                     | stdio环境变量、HTTP认证头；宿主独立凭据文件，不随正常导出返回                  | M4.1、M4.3；本项目继续OS凭据库 | storage/mcp-credential-store.ts；mcp/utils/credential.ts                                             |
| 连接拥有者                         | 带租约、有限池、按执行目录/服务版本/身份隔离，失效时关闭连接                   | M4.1、M4.3                     | mcp/client-manager.ts `McpClientManager`                                                             |
| 能力目录                           | 工具、资源、资源模板、Prompts发现、分页/缓存、诊断/手动刷新及变更失效          | M4.1–M4.3                      | mcp/discovery.ts；services/mcp-diagnostics-service.ts；mcp/list-subscription.ts                      |
| 实际工具执行                       | 别名、schema、定义指纹与调用前校验；统一审批、持久授权与可信只读设置           | M4.1–M4.2                      | services/mcp-tool-service.ts；storage/mcp-server-repository.ts                                       |
| 按需加载                           | tool_search选择MCP工具，下一模型请求携带完整定义；并非call_tool代理            | M4.2                           | packages/tools/src/tools/tool-search.ts；packages/agent-runtime/src/run-coordinator.ts `searchTools` |
| OAuth                              | SDK发现、state/PKCE、回调、刷新去重、失效与重授权；仅远程Server                | M4.3                           | services/mcp-oauth-service.ts；Web settings/views/mcp-oauth-view.tsx                                 |
| 安全与取消                         | stdio沙箱及环境约束，远端受控fetch；调用失联报告结果未知，不自动重试副作用     | M4.1、M4.3                     | mcp/transports/http-fetch.ts；mcp/utils/process-launch.ts；services/mcp-tool-service.ts              |
| Resources/Prompts消费              | 只有目录发现/缓存/设置展示，未找到readResource/getPrompt/subscribeResource调用 | 仅对齐发现/展示                | mcp/discovery.ts；Web settings/components/mcp-server-detail.tsx                                      |
| roots/sampling/logging/elicitation | 部分compatibility布尔字段存在，但未找到对应处理器，不能计为实现                | 不额外承诺                     | mcp/client.ts的空capabilities；schemas/mcp.ts                                                        |

### 两种工具集合

标杆在Run开始准备候选外部工具集；模型初始可见集合不包含全部MCP工具。tool_search将选中项加入当前Run的可见集合，经Pi公开prepareNextTurnWithContext使下一次模型请求包含完整schema。

实际请求前记录run.tools_loaded及定义快照，不能仅在搜索成功时保存工具名，也不能把“候选版本固定”理解为“Run内不能显式加载更多工具”。本项目应复用自己的JSONL事实与请求准备机制实现该行为，不复制标杆Coordinator或事件格式。

标杆定位：packages/agent-runtime/src/run-coordinator.ts中的searchTools、prepareNextTurnWithContext和streamFunction包装；utils/run-tool-snapshot.ts。当前安装的Pi1.1.0类型声明也存在公开准备钩子。

## Skills

| 能力       | 标杆实际状态                                                                               | 本项目对齐位置             | 源码定位                                                                      |
| ---------- | ------------------------------------------------------------------------------------------ | -------------------------- | ----------------------------------------------------------------------------- |
| 定义与发现 | SKILL.md前言、正文、资源；系统/项目/全局作用域及兼容目录                                   | M4.4                       | packages/tools/src/skill-registry.ts `discoverRecords`、`resolveRoots`        |
| 渐进加载   | find_skill检索，get_skill元数据/资源，load_skill读取正文或指定资源；资源真实路径受限       | M4.4                       | packages/tools/src/skills/find-skill.ts、get-skill.ts、load-skill.ts          |
| 显式选择   | Composer插入Skill标记，发送时展开选中指令并记录激活项                                      | M4.4                       | Web chat-composer.tsx；packages/agent-runtime/src/utils/skill-context.ts      |
| 压缩连续性 | 记录显式或工具加载的激活Skill，压缩后保留最新一份指令                                      | M4.4                       | skill-context.ts `preserveSkillInstructions`                                  |
| 运行授权   | load_skill可显式请求allowed-tools授权；内容指纹改变需要重新确认，加载本身不自动授权        | M4.4                       | load-skill.ts `createLoadSkillPolicy`；skill-registry.ts                      |
| 创建       | 设置中的Skill Creator入口和真实skill_creator工具；项目/全局，只创建不覆盖                  | M4.5                       | Web skill-settings-panel.tsx；packages/tools/src/skills/skill-creator.ts      |
| GitHub安装 | 固定版本安装CLI在临时目录处理，再校验并拷入受管Skills目录；支持取消/失败清理，同名拒绝覆盖 | M4.5；具体安装适配独立实现 | services/workspace-service.ts；Web skills/components/skill-install-dialog.tsx |
| 管理       | 作用域列表/详情、启停、打开目录、卸载，系统与插件Skill由各自所有者管理                     | M4.5                       | Web settings/components/skill-settings-panel.tsx；workspace-service.ts        |
| 版本升级   | 未发现独立Skill版本升级系统，同名安装冲突不自动覆盖                                        | 不新增包管理器             | workspace-service.ts安装和删除用例                                            |

本项目不直接继承标杆扫描目录和写入位置。默认作用域、显式添加兼容目录、同名优先级、受管资源根及只读脚本映射在M4.4–M4.5中明确，避免读取整个用户目录或开放profile秘密。

## 插件与外部服务

标杆内置十个插件：Computer Use、Vercel、GitHub、Google、Notion、Supabase、Documents、PDF、Spreadsheets、Presentations。按照已确认的Computer Use排除范围，本轮对齐其余九个。

| 能力               | 标杆实际状态                                                                          | 本项目对齐位置              | 源码定位                                                              |
| ------------------ | ------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------- |
| 市场目录           | 静态bundled插件，manifest描述分类/Skills/OAuth/gateway，可选.app.json声明MCP apps     | M4.6                        | packages/tools/src/plugins/index.ts；load-plugin.ts                   |
| 安装与卸载         | 保存installed IDs、注册Skill/MCP app；卸载清理所属配置/凭据，资源本身仍随应用分发     | M4.6                        | services/skill-connection-service.ts `install`、`uninstall`           |
| UI管理             | 分类、详情、安装、整体及逐项启停、连接授权、卸载                                      | M4.6–M4.7                   | Web settings/components/plugin-marketplace-panel.tsx                  |
| 远程市场/升级/依赖 | 未发现任意插件包下载、独立版本升级/依赖求解或任意JS插件加载机制                       | 不作为本轮必需功能          | plugins/index.ts固定目录与安装用例                                    |
| MCP apps           | GitHub、Google多个服务、Vercel、Notion、Supabase有远端App；Computer Use为本地App      | M4.6–M4.7，排除Computer Use | plugins各目录的.app.json                                              |
| Plugin OAuth       | state、PKCE、账户信息、刷新去重、过期与断开；GitHub/Google可与所属MCP app共享凭据来源 | M4.7                        | services/skill-oauth-service.ts；skill-connection-service.ts          |
| REST gateway       | Skill通过本机网关访问明确允许的上游方法/路径/参数，宿主添加凭据、限制时间及响应       | M4.7                        | services/skill-gateway.ts；controllers/skill-connection-controller.ts |

五个服务族的计划验收清单为GitHub、Google、Vercel、Notion、Supabase。Google子App至少覆盖Drive、Docs、Sheets、Slides、Calendar；第三方OAuth应用配置及真实账户结果逐项记录，不能用通用MCP可连接替代各项验收。

Plugin OAuth和MCP OAuth是两种真实通路，与本项目现有模型Provider OAuth分开；它们可以共享受控凭据引用，不能混用账户或将Token交给Skill。网关包含将只读查询转换为POST JSON的用例，策略需要按应用确认的操作语义判断，不能仅以HTTP方法判断是否只读。

## 办公文档

| 能力       | 标杆实际实现与边界                                                                    | 本项目对齐位置                   | 源码定位                                                          |
| ---------- | ------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| 文档正文   | read_document提取PDF、Office/OpenDocument/RTF/EPUB文本，不是原生编辑器                | M4.8复用M3提取并提供模型工具入口 | packages/tools/src/tools/read-document.ts；utils/document-text.ts |
| PDF页面    | view_pdf_page将指定页渲染为有界图片，视觉模型读取                                     | M4.8                             | tools/view-pdf-page.ts                                            |
| DOCX       | Skill及脚本提供创建、受限编辑/修订/批注、审计、渲染/页面对比                          | M4.8，独立资源                   | plugins/documents/skills/documents/scripts                        |
| PDF        | Skill及脚本提供页操作、表单检查/填写、受限修改                                        | M4.8，独立资源                   | plugins/pdf/skills/pdf/scripts                                    |
| XLSX       | Skill指导生成/编辑，脚本检查内容、公式缓存等                                          | M4.8，独立资源                   | plugins/spreadsheets/skills/spreadsheets                          |
| PPTX       | Skill指导生成/编辑，脚本检查结构、表格、越界等                                        | M4.8，独立资源                   | plugins/presentations/skills/presentations                        |
| 执行与依赖 | 通过受监管命令执行Python/Node等资源，部分流程需要LibreOffice/Poppler等外部依赖        | M4.8显式检测与受控执行           | 相应manifest、requirements和渲染入口                              |
| 产物展示   | 普通工作区文件/本地链接、文本/图片预览及系统应用打开；未发现统一Office产物模型/编辑器 | M4.8交付文件及必要受保护预览     | Web workspace-files-view.tsx；assistant-markdown-link.tsx         |

M4.8实现时将DOCX/XLSX/PPTX/PDF拆成具体任务和产物检查矩阵，不能以“预置一个Skill文本”冒充工作流可运行。输入解析和产物生成分开，未安装的外部依赖明确显示不可用；不新增Office编辑器、通用RAG或远程产物平台。

## 与现有架构的衔接

- SessionRuntime在准备、审计以及ToolRuntime创建时分别拼接静态定义；先统一RunToolset，再接外部工具，保证模型、预算、执行和日志一致。
- 当前ToolCallRecord参数可容纳JSON对象，但结果主要为文本；需明确外部来源和混合结果投影，不能只改名称。既有JSONL、审批、Run取消和中断恢复继续复用。
- 标杆使用独立凭据文件，本项目继续使用OS凭据库；标杆的Tauri、HeroUI、SRT和存储目录布局不作为技术栈约束，本项目保留Electron、shadcn和已确认分层。
- SDK支持的能力、标杆实现的功能与本项目计划支持的范围分别判断，不因SDK存在readResource/roots等API就扩充本轮承诺。

公开格式和协议事实以[官方MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)、[连接传输](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect)、[Agent Skills规范](https://agentskills.io/specification)为辅助核对；版本和具体依赖在实施前再次检查，业务范围仍以本项目roadmap与用户确认的Spec为准。
