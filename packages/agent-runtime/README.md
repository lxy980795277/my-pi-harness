# Agent Runtime

Node端的模型接入与持久会话运行层，使用精确固定的Pi core/ai 1.4.0公开接口。HTTP、SQLite、OS凭据和页面由宿主提供；本包不导入Fastify、Electron、React或SQL驱动。源码检查、测试与生产均通过实际package exports读取工作区源码；Node进程显式加载tsx，不依赖后端dist或源码覆盖别名。

## 源码职责

| 目录            | 职责                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `models/`       | 模型清单、Provider实例、模型认证与凭据适配；不负责应用或插件OAuth    |
| `sessions/`     | 单会话命令串行、队列、分支、持久事实发布与宿主存储端口               |
| `runs/`         | 主子Run公共准备、单次Pi生命周期、通用执行接口、输入投递与SDK事件记录 |
| `subagents/`    | 子任务树、角色、模型请求并发调度、通信、写入拥有者与后代结算         |
| `tools/`        | 候选选择、冻结集合、每Run领域绑定、审批与canonical结果记录           |
| `capabilities/` | 冻结候选、发现与请求前激活；Skill候选绑定、正文、资源与租约          |
| `work/`         | Plan、Todos、用户提问、检查点和相应会话工具                          |
| `context/`      | 消息codec、附件输入、规则、预算、摘要及每次请求的上下文投影          |

根`index.ts`是跨包公开入口，`errors.ts`定义包级运行失败。包内直接导入所属模块，不通过根入口或内部转发层回引；`ProviderStore`由`models/ports.ts`声明，`RuntimeStore`由`sessions/ports.ts`声明，宿主会话提交记录及队列私有接受数据由protocol/internal唯一定义。RuntimeStore只暴露执行需要的读写操作，启动恢复由宿主负责；队列读取返回已校验的QueueCapabilityMetadata，运行时只处理缺失记录及绑定的当前有效性，不重复持久数据校验。

`runs/execution.ts`拥有单次执行的取消、失败、终态及扩展工作结算；`agent.ts`装配Pi Agent和每次请求的能力/上下文钩子，`request.ts`拥有请求名额、派发前复核及实际流结算，`inputs.ts`投递队列与`RunInjectedInput`，`messages.ts`拥有SDK事件记录和未执行工具的结算，`prepare.ts`共用主子Run的模型检查与输入接受准备。`runs/ports.ts`声明可选`RunHooks`、记忆/来源窄端口和注入输入接口，执行器不导入subagents、记忆领域服务或搜索实现。注入输入在实际消费时提供整批持久记录，仍由Run统一提交；持久化失败由执行器中止整个Run。输入准备继续使用共享协议中的AgentMessage表达续作来源。

`subagents/coordinator.ts`唯一拥有活动节点索引、任务树、计时器、写入拥有者及子树创建/停止/收束；`policy.ts`解析角色、限额、附件范围和工具访问约束，`messaging.ts`拥有通信幂等、路由与续作准入，读取协调器的节点索引并通过回调启动续作。tools包声明五个委派工具的模型schema，`tool-dispatch.ts`适配工具调用与等待，`run-adapter.ts`实现RunHooks，将请求并发、写入仲裁、通信消费及收束接入Run。`launch.ts`准备子模型、工具与上下文并启动共享RunExecution。生命周期继续由协调器拥有，不单独增加另一份任务状态或生命周期服务。

tools包的ToolRegistration拥有模型schema、来源、默认/按需加载、可用条件、参数效果策略与绑定入口；`tools/selection.ts`按实际领域端口、工作区、平台、模型能力和调用者访问约束选择初始集合与候选。`bindings.ts`为每个主子Run分别绑定Work、Task、能力、命令和产物端口；`runtime.ts`编排校验、审批与执行，`policy.ts`拥有逐次审批，`mcp-dispatch.ts`拥有外部派发屏障和未知结果，`ledger.ts`拥有工具记录及canonical结果。执行函数只留在内存，日志冻结模型可见定义及授权来源。SDK拒绝与未派发调用复用ledger的宿主终态入口。

## 模型与会话运行

`ModelGateway`装配账户实例、模型清单、连接探测与认证。OpenAI（Codex）、Anthropic、Google、DeepSeek、MiniMax、Kimi六个内置Provider按公开factory固定为单例入口，名称、端点和模型目录只读；自定义Provider允许空模型列表，模型Dialog草稿一次提交整个Provider，保留未提交的同ID模型headers/compat，切换协议同步已有模型API。自定义Provider使用Pi的Chat Completions、Responses或Anthropic lazy API。请求HTTP与模型SSE解析由Pi负责。OpenAI兼容Base URL通常含`/v1`；Anthropic SDK会追加`/v1/messages`，通常配置不含`/v1`的服务根地址。HTTPS及显式回环HTTP可用，地址不得含用户信息、query或fragment。

公开providerKind与配置实例ID分别表示协议/厂商和账户配置；credentialRef仅存在于宿主ProviderRecord，ModelGateway通过明确字段投影生成公开ProviderConfig，不将引用交给Renderer。不同实例使用独立Pi注册ID与凭据；生产默认AuthContext不读取供应商环境变量或其他应用认证文件。requiresApiKey=false跳过保存及环境凭据，通过Pi公开fetch注入剥除SDK认证头；恢复Key要求可继续使用原保存凭据。模型定义显式指定真实modelId、能力、上下文和compat，保存配置不证明远端可用。`testConnection`发起有超时的真实请求，可能产生供应商用量；它返回脱敏结果。

`resolve()`返回Model、绑定的streamFn及必须调用的`release()`。该lease从认证检查前开始，阻止运行期间修改Provider和凭据；调用者在失败或SDK真正结算后释放。本包的SessionRuntime与连接探测负责这些释放，外部调用者须遵守相同规则。

模型lease的streamFn统一设置应用身份，User-Agent包含根产品版本和实际Pi版本，关闭Pi默认厂商归属头。主/子Run、摘要、审批及连接探测经过同一入口，keyless继续剥除认证头，显式模型headers继续由Pi按其优先级处理。该策略不启用遥测，也不为产品编造归属URL。原生Provider的baseUrl覆写同时用于模型请求和目录刷新，自定义协议与地址仍按显式配置执行。

宿主须在独占daemon启动时清理OpenAI/Anthropic SDK的环境认证、租户、Base URL、custom headers和console日志覆盖项；本包不在每个Gateway或请求内修改进程全局环境。Pi的AuthContext隔离不能代替底层SDK的环境策略。keyless最终fetch另外移除认证与OpenAI租户头，显式非秘密模型headers继续传递。应用启动清理的确切变量由daemon的model-environment模块拥有。

认证通过真正的`Models.login/logout`执行。AuthFlow暴露URL、device code、secret/code/select prompt及终态，输入只交给当前prompt，不存入公开DTO。宿主提供稳定profile deviceId。凭据适配将版本化Pi认证对象保存在宿主SecretStore，整段异步refresh在串行modify内进行；已开始的OAuth刷新在调用者取消后仍保存旋转Token。Gateway关闭会中止连接探测与登录，并等待在途凭据操作，不提前宣布退出。

`resolveSessionInput`解析显式选择或持久化全局默认，创建前检查模型、思考等级、启用与认证；失效默认不会改用其他模型。已有会话仍保留自己的选择。

`SessionRuntime`序列化单会话命令；每个Session只有一个活跃根Run，不同Session可独立运行。子Run通过Task归属并由SubagentCoordinator管理，仍复用RunExecution和同Session日志。输入、Run配置与模型上下文先提交，再创建真实Agent请求。SDK事件映射为独立公开字段，完整事实先持久化后通知，流式片段通过独立内存入口发布；订阅者不等待SDK idle，真正结算由Run所有者等待。绑定工作区的会话通过ToolRuntime提供受策略与单次审批约束的工具循环；没有工作区不获得本机目录权限，deferred不会被误报为完整成功。

## 子Agent与任务树

`subagents/default-settings.ts`唯一拥有默认角色、指令及执行限制，根入口导出defaultAgentSettings。daemon将factory显式交给storage；首次读取返回revision0而不写配置，首次修改仍递增为revision1，已保存设置优先。protocol只定义字段与校验，不提供角色策略。

宿主通过agentStore提供SubagentStore以启用Task查询和配置，SubagentCoordinator协调任务树，SubagentMessaging处理同树通信，模型通过五个委派工具调用对应能力。AgentRequestScheduler只管理全局与祖先子树的并发名额，流真正结算后才释放，不以累计用量限制请求。Task保留sourceToolCallId，子Run保留taskId，祖先关系由原工具事实推导；根快照排除子转录，WorkRuntime.forTask复用独立上下文与人工交互。任务通信有agentMessageId来源，模型正文编码和持久来源匹配由context拥有。

子Run继承父审批策略，角色只读作为独立能力限制进入统一工具执行上下文；允许的读取不因角色只读变成人工批准，副作用仍在审批和派发前拒绝。冻结、嵌套及续作语义见[子Agent设计](../../docs/09_TECHNICAL/子Agent与任务看板设计.md#角色能力与写入)，不添加公开协议或重复持久字段。

父Run终态前结算后代，正常完成才join，失败和停止取消所属子树。仅在实际资源结算后释放lease和写入拥有者，关闭等待全部后代再传播失败；重启恢复不执行模型或工具。机制见[子Agent设计](../../docs/09_TECHNICAL/子Agent与任务看板设计.md)，接口由[任务协议](../../docs/03_API/agents.md)拥有。

主/子Run的正文与思考片段通过RuntimeStore.publishMessageDelta更新内存实时投影，订阅仅收到轻量变化通知；不提交JSONL或SQLite。完整消息在成功、取消或失败时一次持久化，失败SDK空final保留已观测partial；工具审批、派发屏障与终态仍经过持久commit。公开快照的持久seq与实时liveRevision见[会话协议](../../docs/03_API/model-session.md#事件快照与断线)。

Run失败沿用error字段记录安全原因，主/子执行共用同一入口；应用拥有的运行错误保留说明，模型异常只输出受控分类或通用提示。具体公开语义见[会话协议](../../docs/03_API/model-session.md#事件快照与断线)，取消不产生失败原因，不将SDK异常原文发送到Renderer。

`selectRunTools`在接受Run前从统一目录生成初始`RunToolset`和带真实session/workspace来源的`nativeCandidates`，MCP候选保留宿主冻结绑定。选择读取`ToolRuntime.supportsWorkTools`，不因仅装配了上下文服务就声明不可执行的工作状态工具。`RunToolset`深拷贝并冻结定义，同时保留TypeBox元数据；接受审计、Pi声明、预算及执行路由共用当前集合，来源和稳定指纹不混入模型schema。后续激活由`RunCapabilities`先持久化再推进，执行器只接受已发布集合中的绑定。配置、信任、凭据和SDK连接由daemon/integrations拥有，runtime不直接访问SDK或SQL。

统一工具适配器通过Pi公开`prepareArguments`在SDK参数转换前按冻结schema严格校验原始模型JSON，execute入口复用同一校验。当前assistant工具批次的完整调用提供Pi参数解析错误；畸形最终JSON先以有界原始错误反馈模型，不进入审批或执行。fractional整数参数、数字字符串或非nullable位置的null不能静默转换；拒绝结果保留原始调用参数，执行和审计继续与持久assistant intent精确一致。

`ToolRuntime`按接受Run时冻结的approvalMode执行：ask逐次询问，auto调用`ModelApprovalReviewer`，full-access自动批准并显式选择macOS无沙箱Shell；角色只读及内部read-only继续阻止工作区变更，命令采用OS禁止工作区写入的范围。文件工具仍以工作区为根。独立复核使用当前Run的Provider/model、用户请求与冻结规则，没有执行工具、共享主会话或多轮重试；只接受allow/deny/ask结构化结果，模型/认证失败、超预算、无效结果或30秒超时均转人工。停止中止复核并等待SDK结算后释放模型lease。审计请求和决定先持久化，存储失败直接传播，不当成模型失败转人工；公开事件只有工具/模型ID及决定/理由，完整复核请求仅保存在privateData。工具卡最终来源区分user/ai/full-access，先前AI转人工记录仍保留在事件历史。

运行中的follow-up/steer输入先进入持久队列，再交Pi对应队列消费；文本更新与删除重建其内存投影。每个Run只投递当次允许的输入集合，普通发送与编辑不会激活旧暂停队列。取消、失败与重启保留未消费输入，恢复收费请求需显式resume，且原始分支必须与所选分支相符；同一恢复Run只激活相同Provider/model、MCP工具选择和授权绑定的输入。排队时即冻结定义与原始授权，编辑保留接受请求ID；恢复先校验原始授权并重建TypeBox元数据，撤销后重新信任不会复活旧输入。编辑用户消息追加分支与新输入，保留旧分支并排除其后续回复。session.deleted归档会话，保留事件，不是彻底删除私人数据。

输入接受后若Agent初始化或首次队列读取失败，运行层清理订阅与临时所有权、释放模型lease并停用Session；不会遗留可继续工作的假Agent，也不补写假完成。下一次启动将已接受但未结算的事实恢复为interrupted。

RuntimeStore拥有会话日志与投影。公开MessageView与宿主模型codec分离，成功消息保留Provider签名、responseId、system工具声明及工具结果；普通模型消息使用version1 codec，sdkVersion记录实际Pi版本且只作来源信息，读取按同一消息schema校验、不按SDK版本转换；工具结果使用protocol拥有的中立StoredToolResult，runtime再组装Pi消息。不兼容旧开发格式。工具结果按assistant消息锚点进入分支前缀；工具终态和中立结果同批写入，SDK回调不产生第二份结果。已持久完整assistant中未进入执行的call结算为宿主interrupted。MCP调用首次写入前先持久化may_have_started屏障；无法确认结果记unknown、停止Run并保留队列，不自动重试或继续模型请求。恢复只配对日志，不重新连接或执行；未知结果在模型/本地摘要中保留可能已生效的阻塞，不能成为Todo成功证据。工具记录ID按Run、assistant消息ID与SDK调用ID派生，允许网关在不同assistant轮次复用调用ID。持久化失败中止并停用Session，不广播假完成或继续使用未提交状态。

主对话每个助手模型步骤在完成事实中保留供应商token用量与宿主完成时间，字段与缺失语义见[会话协议](../../docs/03_API/model-session.md#事件快照与断线)。工具轮与最终正文使用同一记录入口，独立审批复核和上下文压缩请求不并入这组主对话用量；不从正文估算或从私有codec补造历史统计。

JSONL批记录是会话执行事实来源，完整批次fsync后才更新SQLite投影和发布事件；SQLite继续保存产品配置及可重建查询投影。宿主私有模型输入与公开事件分开保存，HTTP/SSE不暴露privateData。附件内容由宿主独立冻结保存，日志引用不等于附件文件备份。记录格式、回放及索引修复由[storage](../storage/README.md)拥有。

`context`模块在每次Run开始时读取工作区根`AGENTS.md`及显式引用文件祖先目录中的规则，按目录深度及路径确定顺序，不扫描其他目录。已冻结的引用不依赖源文件继续存在；仍存在的祖先目录继续检查，缺失目录不提供规则。规则保存工作区相对来源、原始字节SHA-256与文本；下次Run重新读取，旧快照保持原样。最多16个文件、合计64 KiB，非UTF-8、符号/硬链接、敏感路径、越界及取消均拒绝；读取复用sandbox/filesystem的真实路径检查和`readStableFile`有界字节读取，context拥有文本解码、总预算及领域错误。父目录并发改名仍受底层文件策略与OS隔离限制。项目规则只影响所属目录，不能覆盖应用策略或扩大工具权限。Plan、Todos和历史摘要按明确标识的工作数据加入模型上下文。

`WorkContext`在每次模型请求前重建当前工作状态与冻结规则对应的system内容。估算覆盖system、规则、记忆、工具定义、消息、附件、摘要和工作状态；ASCII/Unicode UTF-8启发式及每张图片4096 token均是估算。前次实际请求与后续assistant的input/cacheRead/cacheWrite共同校准下一次总量；摘要或上下文起点改变时基线失效，类别拆分始终保持估算。模型输出空间完整预留，最终仍超限则拒绝请求。

投影仅缩短模型可见副本：长工具结果保留首尾，已保留原文时直接给出宿主记录ID和分页参数，并确保当前请求已提供reader；旧附件正文有界，早先图片转换为附件保留提示，原始资料不被改写。纯投影只返回依赖信息，请求准备先完成必要工具激活，再按最终声明计算预算。达到输入预算80%时，按完整assistant/tool组选择旧前缀，保留约16%的近期内容，支持同一Run内多次自动压缩。当前任务从有效消息中移除后会加入system以保证连续性，已批准计划和任务状态每次请求重新加入。工具调用和结果必须成组，不能把孤立结果交模型。

摘要模型无工具、输出有界、总等待90秒。结构摘要记录目标、约束、决策、观察与完成、待办、阻塞及下一步；模型错误、无效JSON或自身超时使用保守本地摘要，调用方取消和持久化失败继续传播。全部结构字段合计受JSON序列化24000字符和渲染30000字符的预算限制，连续降级不会因局部数组累计变长而中断持久化。每个摘要版本保存父版本、覆盖消息、触发原因、策略及同口径前后token估算。手动压缩由WorkRuntime按持久消息锚点保留最近两轮用户对话；自动压缩由WorkContext按完整工具组保留近期内容，可以在单个长任务中多次进行。两者共用结构化摘要生成与持久化入口。最终真正请求的system和消息先保存为context.prepared。

`WorkInteractions`让ask_user和update_plan工具等待所属Run的用户响应，最长24小时；停止Run会结束等待。ask_user支持多题、选项说明、单选/多选和显式自由输入，答案逐题验证；取消提问返回工具错误，模型可以继续。update_plan提交带唯一ID的结构化步骤并等待审核；新计划必须保留现有任务关联的步骤，否则在保存与等待审核前拒绝，模型可先更新或清理任务关联。feedback结果返回原Run修订，approve保存批准状态并继续原Run，工具审批仍独立生效。update_plan_steps只修改已批准计划的步骤进度，不修改正文或授予批准。

update_todos保存稳定ID、计划步骤关联和五种任务状态。完成任务需要本Run成功工具的已核验记录ID，或纯文本分析的明确completionNote；伪造、失败或为新增完成项引用其他Run证据被拒绝；既有完成项的未变证据在后续Run和继承分支中保留有效，校验以当前分支可见工具为准。最多一项任务处于进行中。用户手动完成同样需要依据或完成结论。用户命令reset-tasks只清Plan/Todos；reset-context保留Plan/Todos，清规则快照、用量、摘要、问题和未消费队列，并重置有效历史起点，旧历史仍可读。

自动摘要版本是“上下文检查点”：用户选择旧版本后保留当前Session及所有历史，但仅旧摘要和选择后新消息进入模型；模型不提供摘要选择或工作状态重置工具。search_session_history有界检索当前分支原始消息、工具结果及可见消息绑定的文本附件，包括被模型投影缩短的附件尾部；最多检查10000条消息、2000条工具和128个附件，总扫描100万字符，最多返回20个各2000字符的片段，不跨Session，也不搜索长期记忆。工具命中提供记录ID和offset，read_tool_result也可直接使用裁剪提示中的记录ID，按当前分支或子任务读取已终结工具的留存文本，每页最多6000字符并返回下一页调用；失败状态保留，不重执行原工具，不返回私有路由或凭据，也不能补回源输出上限丢弃的内容。手动checkpoints是“会话快照”：冻结消息前缀和工作状态，恢复时创建新分支，保留旧分支。两者都不回滚文件、命令或外部请求。

本包测试使用真实临时SQLite、真实Pi Agent与受控faux Provider、动态端口HTTP/SSE和显式内存凭据适配器。它们不调用真实供应商账号或用户keyring，不能替代真实API、系统凭据和macOS/Windows发布验收。

```sh
pnpm --filter @my-pi-harness/agent-runtime typecheck
pnpm --filter @my-pi-harness/agent-runtime lint
pnpm --filter @my-pi-harness/agent-runtime test
```

## 渐进能力

`InputCapabilityResolver`冻结显式MCP、目录诊断、Skill候选元数据和已选择正文/授权，排队保留原requestId与接受绑定。`RunCapabilities`拥有获准的原生/MCP候选、暂存和可见集合，`RunSkills`单独拥有正文、资源及活动租约；候选目录不占活动Skill租约。原生注册的默认集合、按需类别及数量限制由[运行时能力协议](../../docs/03_API/capability-runtime.md)维护。

`tool_search`同时检索可用原生和MCP候选，复用词法与可选本地向量；精确名字优先，语义失败或截止时保留词法结果。命中新增项自动暂存，已可用项明确标记且不重复加载；MCP关闭不影响内置发现。搜索、Skill加载和宿主已知依赖统一经过`run.tools_loaded`屏障，再更新下一请求声明、预算与执行。同批旧assistant不能调用新增工具，压缩不卸载当前集合；Run结束释放，下一Run重新选择，不从历史自动恢复全部动态工具。

每次Run把接受的Skill候选摘要和MCP服务发现状态加入已记录的system上下文；模型以`load_skill({id})`选择正文，宿主从`SkillCandidate`解析精确hash、来源和授权代次。目录本身不激活正文，候选内容变化或同内容插件重装不能静默换绑定。目录与激活正文贯穿每次请求及压缩后的重建；未装配WorkContext时也在实际system消息中提供激活正文。`read_skill_resource`只读取活动快照中的注册资源，具体绑定规则由能力协议拥有。

用户文字中的独立`$skill-name`明确调用会冻结并激活相应启用Skill，未安装、禁用及被遮蔽的名称不激活。文字调用与picker显式选择分别保存，合并后仍受16项和同一内容/授权版本限制；队列私有`mentionedSkillBindings`保存当次正文，恢复不会改读磁盘新版本，撤销则拒绝恢复并保留队列。活跃Run后续输入中的新调用先随队列接受事实持久化，消息实际消费后才暂存，随后通过每次模型请求前的`prepareRequest`屏障提交`run.tools_loaded`，包括直接续接的follow-up；它不创建工具授权或本地目录权限。

后续Run从当前分支有效消息所对应的已提交接受/加载事实继承最近16个Skill冻结正文，自动压缩不清除该来源；编辑分支、上下文重置和检查点选择只使用保留范围。正文不会因picker空选择、模型历史裁剪或磁盘更新而丢失或换成新版。继承前逐项重验当前启停、版本及插件授权；失效项排除，并在已记录system上下文的`unavailablePreviousSkills`中说明，普通聊天继续，显式新选择仍严格校验。队列私有`inheritedSkillBindings`保留原版本，恢复可排除已失效的继承；正文继承不自动继承MCP可执行集合。动态Skill依赖只从已获准工作区候选选择，附加资源索引非空时同时激活resource reader；没有工作区不提供本地文档、文件或命令工具，任意MCP名字不随Skill声明加载。

Skill没有额外的工具grant状态，真实执行继续使用统一策略与逐次审批。服务插件通过冻结Skill中的`gatewayUrl`提供只读HTTP入口，模型使用会话级`web_fetch`访问允许路径，不要求工作区或授予文件/Shell能力；公网与网关访问继续执行现有网络校验、只读限制和审批。网关地址随接受输入与`context.prepared`保存，私有访问能力只在宿主执行请求时添加，不进入模型或会话日志。MCP写操作继续使用实际加载工具、独立信任与当前审批策略，接口见[运行时能力协议](../../docs/03_API/capability-runtime.md)。

## 记忆与历史来源

`runs/memory.ts`把实际消费的人类输入、任务输入和精确用户记忆ID交给`RunMemoryPort`；`context/memory.ts`只负责固定记忆优先的输入预算及单个JSON资料块。记忆事实、相关召回与直接写入由宿主和memory包拥有，本包不维护第二份记忆库。`request.ts`先等待请求名额，再同步复核记忆指纹、工作状态及输入来源；草稿失效时释放名额、重新准备并再次申请，摘要不会占着待发请求的名额。最终用量与`context.prepared`同批提交后才派发，名额保留到实际流结算。

`runs/input-references.ts`解析并复核精确搜索引用，将有界、低信任的引文追加到实际可见用户输入；原始来源、hash和选区只在类型化私有数据中绑定，不从文字反推授权。幂等重试先返回原接受结果，队列编辑、恢复和实际消费保留同一绑定并复核当前来源；未消费或已删除的排队引用不授予精读资格。`runs/inputs.ts`分别持有真实任务查询与system中的当前任务指针，避免在引用用户输入之外再次镜像整段资料。

根Run默认提供记忆搜索及save、learn、update、delete四个写工具；`RunMemoryPort`只接收当前已消费人类来源、实际Run身份与持久工具调用ID，不从模型参数读取权限。Run与工具取消信号在绑定层合并，宿主端口只从请求上下文读取这一个signal。运行中的steer及follow-up在真实消费后更换来源，任务通信不产生人类来源；没有一次性学习动作、TTL或提案卸载机制。当前使用/学习开关来自同一次记忆快照，随真实请求写入system并记录context.prepared；即使没有采用条目也呈现状态，不将策略重复写进记忆JSON正文块。学习开关由宿主在每次learn执行时复核，不永久冻结掉工具目录。四个写操作都受角色只读限制；save、learn、update直接执行，delete仍经过会话审批策略。学习不产生额外模型请求。

`runs/search.ts`按Run持有实际搜索命中和已消费引用的精读资格。`search_sessions`只获得宿主限定的其他活动会话Root消息；命中可精读同来源，显式引用只允许原选区或其子区间，二者都在异步读取前后重新校验。下一Run不继承这些资格，子任务不自动获得历史搜索、引用或记忆写入能力；子任务记忆仅使用当前工作区及父级明确转交、宿主重新核验的用户记忆ID。引用资料本身不能触发自动学习；明确保存保留实际人类输入来源，由宿主按工具意图校验。

采用正文只保存在当次最终system资料块，`context.prepared`用范围及选择说明记录采用事实；历史采用与引用重放不从当前记忆或来源库回填。接口、限额和存储归属见[记忆与搜索协议](../../docs/03_API/memory-search.md)及[长期记忆与搜索设计](../../docs/09_TECHNICAL/长期记忆与搜索设计.md)。

## 命令资源与产物

初始激活Skill在首次模型请求前经宿主物化，以run.tools_loaded记录同一正文、资源与授权及当前resourceDirectory；load_skill也返回这个精确目录。接受事实可保留历史目录，但本Run首次加载后目录固定；后续能力追加不能替换已记录路径、正文或授权。共享依赖由tools资源清单按hash冻结，profile和插件安装根不成为命令的读取范围。

命令服务由daemon持有，Run绑定提供session/run/task归属、工作区和有效执行范围。run_command、wait_command和stop_command的短等待与进程总生存期分开，参数由[能力协议](../../docs/03_API/capability-runtime.md#受管理命令)拥有。成功根Run结束保留后台命令，子任务终态、显式取消和会话关闭收束所属命令。每个命令独立retain已激活Skill资源，每秒验证当前授权和hash，撤销后停止；释放Run引用不提前回收命令资源。当前进程正向支持macOS，物理关闭由sandbox拥有。

publish_artifact通过宿主端口注册稳定工作区字节，带producerCommandId时核对同任务命令成功终止。工具返回的artifacts随成功ToolCallRecord及artifact.published、canonical结果在同一批提交，MCP或普通stdout不能伪造注册事实。宿主下载按artifact ID读取不可变blob，字节、配额及下载租约由storage拥有。未成功提交的blob保留为不可公开的无引用文件，提交结果未知时不因异常重复生产命令。

## 执行循环与部分结果

主、子Run不设置累计请求轮数或工具调用次数上限；权限、任务数/深度、请求并发、已有时限和单次输入输出界限保持独立。ToolRuntime在同Run的工具和参数连续重复第3、5、8次时附加宿主提醒，随tool.context持久化后进入模型，不阻止执行。动态工具集合更新不重置提醒计数，新Run独立计数。

子任务状态查询和等待只回收目标Run的输出，成功优先最终回答，失败或取消保留最近已有正文并标记partial；模型length或返回文字截短也标记partial，无文字返回空。状态和错误独立返回，不将部分成果当成功或自动请求总结。职责与数据流见[Agent Runtime](../../docs/09_TECHNICAL/Agent-Runtime.md)及[子Agent设计](../../docs/09_TECHNICAL/子Agent与任务看板设计.md)。
