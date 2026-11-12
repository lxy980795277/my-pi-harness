# Tools

模型工具、通用Skill资源和受管理命令的实现包。工具定义及绑定由本包拥有，agent-runtime负责接受、审批和日志提交，daemon提供实际服务，sandbox落实文件、网络和进程机制。tools依赖protocol及sandbox，不导入agent-runtime、daemon、storage或integrations实现。

## 公开入口与源码职责

ToolResult使用protocol/internal的ToolContent文本/图像块，不重复定义内容联合；工具摘要、diff及产物仍由本包定义。

根index.ts组合公开API，skills和document-text提供对应叶入口，源码与发布exports保持同一职责。document-text直接导出utils/document-text.ts中的授权字节提取能力，不加载工具目录。TS相对模块导入无后缀，真实脚本与资源保留扩展；开发、测试与生产均通过exports读取src，Node进程显式加载tsx。

| 目录      | 负责的内容                                                         |
| --------- | ------------------------------------------------------------------ |
| tools/    | 34个工具分别平铺为独立文件；各自拥有参数、描述、策略及执行入口     |
| lib/      | 注册契约、执行上下文及多个工具实际复用的文件操作、输入与传输机制   |
| utils/    | 工具目录检索及工具、附件共用的文档正文提取                         |
| skills/   | YAML解析、发现优先级、安装文件、不可变快照、共享依赖及独立资源租约 |
| commands/ | 命令归属、短等待、输出游标、总生存期与命令资源引用                 |

## 工具注册和领域端口

lib/tool-registry.ts拥有ToolRegistration、注册工厂和ToolRegistry。ToolRegistration统一definition、source、loading、readOnly、available、policy和bind。完整注册项能够定位模型schema、何时可用、参数相关效果和执行入口；source用于审计及授权核对。ToolRegistry拒绝重复名，独立领域可以贡献自己的注册工厂，由宿主统一装配。

tools/按模型工具名使用kebab-case文件名，例如read-file.ts、edit-file.ts、spawn-agent.ts和load-skill.ts。每个文件集中声明自己的参数schema、注册元数据和执行逻辑；工具专属实现留在所属文件。tools/index.ts只聚合导出，根workspace-tool-registry.ts组合原生目录，目录顺序与默认/按需声明保持明确。utils/tool-search.ts拥有目录检索，不与注册装配混放。不存在按工具族拆出的schema清单、注册数组或按工具名称选择实现的第二套派发。

lib/提供注册与上下文契约和有实际共同消费者的操作，不承接每个模型工具的声明或统一执行所有工具。文件预像校验、稳定读取与原子写入可由多个工具共用；命令状态和Skill版本与租约分别由commands/、skills/拥有，插件贡献由独立plugins包拥有，正文提取由utils/document-text.ts提供。拆分工具入口不拆散这些服务，也不把它们放回工具注册文件。

bind接收当前Run的ToolContext，返回异步调用入口；注册工厂同时接纳同步和异步实现，同步异常也通过返回Promise拒绝。lib/tool-context.ts拥有公共执行上下文及各类工具回调组合，具体工具的回调接口和输入类型随对应工具文件定义；回调仅提供实际领域操作，不传Run、Coordinator或数据库。主子执行器各自重绑session/run/task、Work上下文与角色上限。执行闭包不进入日志，模型可见定义、来源指纹和授权版本由runtime冻结。新增工具同时设计参数校验、结果内容、效果策略和真实服务可用性。

默认及按需加载由注册项声明。tool_search和load_skill暂存能力，runtime持久化run.tools_loaded后才用于下一模型请求；工具注册、Skill加载和插件安装分别保持各自权限，实际执行仍经过角色及逐次审批。入口清单与参数由[运行时能力协议](../../docs/03_API/capability-runtime.md)拥有。

记忆与跨会话来源共七个工具。`search_memories`及`save_memory`、`learn_memory`、`update_memory`、`delete_memory`在宿主装配时默认提供；`search_sessions`与`read_search_source`沿用按需发现、激活和执行链。save直接处理明确记忆请求，learn在当前学习开关允许时记录稳定偏好、长期指令或事实，update按精确ID和revision纠正已有条目。四个写工具均声明mutating及非readOnly；save、learn、update不需要额外审批，delete经过普通审批且full-access可自动批准。结果仅返回写入回执，不重复正文。当前分支的`search_session_history`与留存工具结果的`read_tool_result`继续承担各自原有范围。

这七个工具通过lib/tool-context.ts的窄回调调用宿主，不导入记忆库、索引或会话实现。模型参数不能自报来源授权、hash、所属用户或任意工作区ID；宿主绑定实际消费的人类输入及持久工具调用，记忆领域再次检查来源、开关和revision。引用资料不能触发自动学习，明确保存仍由用户输入和宿主校验约束；没有一次性学习动作或待确认提案。子任务只有授权范围内的记忆读取，不继承记忆写入、历史搜索或引用能力。`spawn_agent.userMemoryIds`只转交父级当前可读的精确用户记忆引用，宿主在创建和子请求派发时复核。具体协议见[记忆与搜索](../../docs/03_API/memory-search.md)。

## Skill资源与插件声明

SkillCatalog发现注册根并按project、user、plugin、system排序，正文与资源索引共同生成contentHash。它返回全部有序来源，不判断启用或遮蔽；daemon的SkillsService使用同一发现快照和当前组件控制计算有效目录，详情与冻结不会再次扫描目录。freeze仍重新读取所选源树验证相同内容，再发布不可变快照；loadResource只读取已接受路径并检查hash和大小。安装拒绝链接、隐藏资源、路径遍历、重复及超限文件，不执行源安装脚本。GitHub下载固定提交及blob身份，网络请求由宿主注入受控传输。

resource-manifest.json的version为1，dependencies每项包含source、target和hash。source是宿主resourceSources中注册的精确标识，映射到固定目录与相对文件；未注册来源明确拒绝。target是Skill内唯一相对路径。通用引擎不自行查找插件或宿主源码，也不接受模型提供共享文件根。发现和冻结验证SHA-256，将共享依赖复制进快照，后续读取不依赖升级后的源码；专属格式模块直接随各Skill保存。

materializeBindings接收已接受FrozenSkill、取消信号及宿主assertAuthorized回调，复核授权和快照后在profile外生成只读副本。宿主用protectedDirectories传入profile根；文件0400、目录0500，sandbox接收精确readOnlyDirectories。返回租约包含bindings、readOnlyDirectories、verify、retain和release；每次新命令retain独立引用，最后引用释放才删除物化目录。revokeBindings及close拒绝新派发，宿主先收束仍在使用资源的进程再释放其引用。full-access保留宿主文件权限，资源校验不替代OS路径保护。

插件声明、资源、安装/开关与授权生命周期由[plugins](../plugins/README.md)拥有；daemon通过窄接口连接Skills与插件贡献。工具包不反向导入plugins，用户和项目Skills仍独立发现与管理。

## 命令、文档与交付

CommandManager由宿主持有，为当前Run绑定session/run/task归属和有效范围。run_command创建受监管进程，wait_command读取有界新增输出，stop_command等待完整关闭；等待超时保留running。根命令可以跨同会话后续Run访问，子任务命令随任务终态收束。取消、撤销、总时限或宿主关闭都会进入回收，重启不重放命令。命令独立持有Skill资源，每秒复核授权和hash。参数、默认等待及总生存期统一见[命令协议](../../docs/03_API/capability-runtime.md#受管理命令)。

read_document提取有界正文，view_image与view_pdf_page提供真实图像；视觉能力由模型可用性筛选。[utils/document-text.ts](src/utils/document-text.ts)接收已经授权的字节，附件归属和读取授权由宿主负责。正文提取使用有资源上限的Worker，取消和截止时间触发后等待Worker终止；这不构成OS沙箱，也不提供OCR。lib/document-input.ts共享工作区规范化和稳定读取。PDF页图通过固定只读Python helper处理稳定字节，限制资源目录、管道、总时限并等待物理回收；Python和PDFium是显式可选依赖。四个办公Skill使用通用命令与CLI完成创建、复杂编辑、格式检查及视觉复验，结构通过、实际转换/重算、视觉检查和产物交付分别提供证据。

publish_artifact调用宿主注入的PublishArtifactHandler注册工作区文件，工具只返回宿主Artifact。带producerCommandId时宿主检查同归属命令已经成功结束；没有该字段只证明注册时字节稳定。runtime将artifacts、artifact.published及canonical终态同批提交。不可变字节、配额、下载租约和回收由[storage](../storage/README.md)拥有；stdout或模型文本不构成注册。

## 运行与验证

插件manifest、App声明和Skill位于plugins包，专属脚本随Skill保存，共用办公支持由plugins包显式声明；原生PDF页图支持位于本包src/utils/document-view，由DOCUMENT_VIEW_RESOURCE_DIRECTORY公开固定目录。生产部署包含完整src，通过模块位置解析资源。Python、LibreOffice和字体等依赖按实际操作准备，缺失明确诊断；安装走显式授权的普通命令。当前受管理本地命令的正向OS后端限macOS，其他平台明确拒绝，不能从文件解析成功推导平台隔离可用。

test覆盖注册调用、文件/Web、Skill快照和租约、命令及正文读取；临时目录与受控fixture避免使用用户profile或凭据。办公结构、真实重算、视觉及独立桌面运行分别提供证据，范围见[工具体系与沙箱](../../docs/09_TECHNICAL/工具体系与沙箱.md)。

```sh
pnpm --filter @my-pi-harness/tools typecheck
pnpm --filter @my-pi-harness/tools test
```

命令服务最多同时持有16个尚未回收的命令，保留最近128个已结束命令；只淘汰结束后的内存查询数据，不限制会话累计调用次数，持久工具结果继续保留。进程期写入租约独立于本次工具等待，回收完进程、资源和写租约后才发布成功终态；其他Run的活跃写命令会阻止本Session新的写入，wait/stop及只读工作继续可用。
