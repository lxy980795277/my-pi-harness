# 模型、授权与会话协议

共享协议版本见[API入口](overview.md)，公开事件envelope保持version:1，宿主JSONL批次格式独立管理。M1的公开schema由 `packages/protocol/src/application/models.ts`、`auth.ts` 、`sessions.ts` 和 `session-stream.ts` 拥有。HTTP返回公开DTO，SDK对象、模型上下文codec、凭据和数据库Entity不跨入Renderer。列表接口直接返回数组，写会话接口返回已提交的SessionSnapshot；失败返回 `{code,message}`。

## 授权

所有业务读取、写入和私有SSE同时要求本机信任与应用登录，写请求另需CSRF。GitHub应用登录、Cookie、profile归属与恢复见[应用身份与登录协议](application-auth.md)；模型Provider OAuth由本页接口管理，不与应用登录混用。

## Provider

| 方法与路径                       | 输入与结果                                            |
| -------------------------------- | ----------------------------------------------------- |
| GET /api/providers/catalog       | NativeProviderInfo[]，六个原生Provider及其认证方式    |
| GET /api/providers               | ProviderConfig[]，含revision与凭据状态，不含Key/Token |
| POST /api/providers              | ProviderInput；仅创建custom，允许空models             |
| GET /api/providers/:id           | 包含旧会话引用的legacy配置，返回ProviderConfig        |
| PUT /api/providers/:id           | custom ProviderInput含expectedRevision；冲突409       |
| PUT /api/providers/:id/enabled   | `{enabled,expectedRevision}`；内置与custom均可用      |
| DELETE /api/providers/:id        | 仅custom；删除配置和所属凭据，使用中409               |
| GET /api/providers/:id/models    | ModelInfo[]，含supportedThinkingLevels派生能力        |
| GET /api/settings                | AppSettings：revision与可空defaultModel               |
| PUT /api/settings                | AppSettingsInput：expectedRevision与defaultModel      |
| POST /api/providers/:id/key      | `{key}`；专用秘密写入口                               |
| DELETE /api/providers/:id/key    | 删除保存凭据                                          |
| POST /api/providers/:id/test     | `{modelId}`；真实短模型请求，返回ConnectionResult     |
| POST /api/providers/:id/auth     | `{kind:"api_key"或"oauth"}`；返回AuthFlow             |
| POST /api/providers/:id/logout   | `{}`；退出模型认证                                    |
| GET /api/auth-flows              | 当前授权流程列表，支持刷新后的界面恢复                |
| GET /api/auth-flows/:id          | AuthFlow状态、地址、device code及当前prompt           |
| POST /api/auth-flows/:id/respond | `{promptId,value}`；只接受准确的待响应挑战            |
| DELETE /api/auth-flows/:id       | 取消认证流程                                          |

自定义协议包括openai-completions、openai-responses和anthropic-messages。URL须为HTTPS，显式回环目标可用HTTP；禁止URL凭据、查询串和fragment。OpenAI通常配置 `/v1` 前缀；Anthropic SDK自己追加 `/v1/messages`，通常配置服务根地址。非秘密headers与兼容参数使用明确schema；auth、cookie、key、token相关header名不能落入普通配置。

内置Provider由六个Pi factory拥有名称、端点和模型。正常列表每厂商仅有一个固定入口；只能启停与认证，不能新增、删除或改写目录。响应models包含完整Pi目录，不套用custom输入的100条上限。custom模型与Provider协议一致；已有模型切换Provider协议时，owner将旧API同步到新协议。模型Dialog维护ModelDefinition草稿，并通过PUT Provider一次提交整个models，使用同一expectedRevision保证原子更新。未提交的同ID模型headers/compat由owner保留，改ID草稿须携带原高级字段。ModelInfo的supportedThinkingLevels只读，不进入配置写入。

Provider ID标识配置实例，credentialRef标识系统凭据项；builtin_provider_slots保存每个原生厂商的正常入口绑定。Gateway初始化时复用该绑定；未绑定时从同厂商、无端点及模型覆盖的配置中按启用优先、ID字节升序选择，或新建官方配置和独立凭据引用。绑定不随启停变化，正常列表仅返回当前绑定的六个入口。legacy为未绑定或已不在当前目录内的内置配置的只读派生状态，不表示存在旧数据库升级支持；当前开发数据采用fresh schema，不保留旧格式兼容。

requiresApiKey=false仅适用于custom：请求跳过保存凭据和环境认证，使用Pi HTTP/SSE实现并在最终fetch剥除SDK生成的认证与OpenAI租户头。daemon启动时一次清理已核实的OpenAI/Anthropic SDK环境认证、Base URL、custom headers和日志覆盖项，阻止SDK自行带入宿主组织/项目、任意环境头或调试日志；其余环境保留。切换标志保留原凭据。hasCredential/credentialType描述保存状态，authSource描述实际认证模式，configured描述认证配置是否齐备；这些字段不证明远端连接成功。credentialPreview仅为掩码，OAuth不返回Token预览。运行期间持有Provider lease，配置和认证变更返回冲突；探测不会静默改用其他模型。

AuthFlow.prompt.type区分text、secret、select和manual_code；可含placeholder及选项description。只有text允许空字符串，其余输入不得为空且select必须命中现有选项。关闭所属认证Dialog通过DELETE取消流程；SDK结算与凭据写入完成前，账户仍拒绝并行认证修改。

## Session与输入

| 方法与路径                                       | 输入与结果                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| GET /api/sessions                                | SessionSummary[]                                                     |
| POST /api/sessions                               | SessionCreateInput；返回SessionSnapshot                              |
| GET /api/sessions/:id                            | 当前分支、消息、Run、队列与snapshotSeq                               |
| GET /api/sessions/:id/log                        | 当前会话已提交JSONL附件，包含全部分支的原始宿主批日志                |
| PUT /api/sessions/:id                            | SessionPatchInput；设置用于后续Run                                   |
| DELETE /api/sessions/:id                         | 归档会话，从列表隐藏；保留历史事实，不是隐私擦除                     |
| POST /api/sessions/:id/inputs                    | `{text,attachmentIds?,mcpTools?,mode,requestId}`；接受输入后返回快照 |
| POST /api/sessions/:id/stop                      | `{}`；提交取消意图、等待SDK结束，返回快照                            |
| PUT /api/sessions/:id/queue/:inputId             | `{text,revision,mcpTools?}`；旧版本409                               |
| DELETE /api/sessions/:id/queue/:inputId          | 删除尚未消费的输入                                                   |
| POST /api/sessions/:id/queue/resume              | `{}`；显式继续保存队列                                               |
| POST /api/sessions/:id/edit                      | `{messageId,text,mcpTools?,requestId}`；新分支重发                   |
| POST /api/sessions/:id/branches/:branchId/select | `{}`；切换历史分支，运行中409                                        |
| GET /api/sessions/:id/events                     | 已授权EventSource快照与有界增量                                      |

新建Session保存workspaceId和approvalMode（细节见[M2协议](workspace-execution.md)）。可以只提交title，此时owner读取持久化defaultModel并校验Provider启用、模型存在、thinkingLevel支持及认证可用后创建；未设置或失效时返回明确错误，不创建Session或发起模型请求。显式选择须同时提交providerId、modelId、thinkingLevel。修改全局默认只影响以后新建Session，不改写已有会话、队列或活动Run。默认引用失效时仍保留原值，由用户明确修改或置空，不自动选择替代模型。

输入附件、消息/队列保留的attachmentIds与分支工作状态见[M3协议](context-interaction.md)。mcpTools选择、冻结授权和队列失效见[本地MCP协议](local-mcp.md)。编辑用户消息重发继承原附件，队列文字修改保留原附件。

同Session只允许一个活跃Run；不同Session可以并行。requestId保持幂等，同一请求重发不启动第二个Run。运行中的send返回409；steer在当前assistant回复及该轮工具处理完成后的下一轮注入，优先于follow-up，不中断正在进行的模型流或工具。follow-up在Agent本轮循环原本准备结束时消费；两者均可继续同一个Run。接受、修改、删除和消费队列均有持久事务。用户停止、运行失败或重启后不会自动恢复收费请求，队列由用户明确继续；普通新消息或编辑重发不会自动消费旧暂停队列。恢复要求选择原分支，并按保存的Provider/model消费。

立即执行冻结模型、推理级别和system prompt；运行内队列使用所属Run的冻结模型，设置变更影响新Run。恢复旧队列时使用记录的provider/model，读取该配置当前已提交版本。编辑用户消息建立新分支并选择准确前缀，旧消息及旧分支回复保留；忙时禁止编辑与分支切换。

## 事件、快照与断线

终态助手MessageView可带`finishedAt`（宿主记录的完成时间，Unix毫秒）和`usage`（inputTokens、outputTokens、cacheReadTokens、cacheWriteTokens、totalTokens，非负安全整数）。每次模型步骤的`message.completed`记录这组字段，终态SSE以message.set同步；中断时保留已提交用量并补完成时间。totalTokens沿用Pi供应商归一化结果，不把缓存再次相加。没有供应商用量、Pi全零默认值或历史未记录时usage缺省，不按正文估算，不改写JSONL补造。统计字段只能出现在终态助手消息，用户消息与streaming消息携带它们时拒绝写入。

HarnessEvent是JSONL中的公开持久事实封套，包含固定格式version:1、eventId、sessionId、可空runId、seq、type、at和公开data。seq在单Session事务中连续递增，先持久化批事实，再提交消息/Run/队列投影，最后通知订阅者。message.delta通过独立publishMessageDelta入口更新内存，不进入JSONL或SQLite；完整message.completed在正常完成、取消或失败时持久化。HTTP的SessionSnapshot合并当前内存正文/思考，增加非持久liveRevision；同snapshotSeq内每次实时更新递增，成功持久提交后归零，但其他活动消息的partial保留。正文、思考和工具结果仍存原文，不保存Markdown HTML或解析树。

SSE仅发送 `session.update`，id为`${snapshotSeq}:${liveRevision}`，data通过SessionStreamUpdateSchema校验。每条新连接（包含EventSource自动重连）先发送 `{kind:"snapshot",snapshot}` 作为含当前实时内容的完整基线；不接受afterSeq查询，也不根据Last-Event-ID重放事实或流式片段。服务先订阅再同步读取基线，避免变化落入订阅空隙。连接存活期间将变化按32ms合并为patch，不再同时传输事实事件和整份会话。

patch包含sessionId、branchId、baseSeq、baseLiveRevision、snapshotSeq、liveRevision、当前SessionSummary和changes。基线水位必须同时匹配该连接上一个投影，目标水位按(snapshotSeq,liveRevision)字典序严格前进；持久seq允许跨过同批多个事实，相同seq上的实时增量也可推送。消息、分支、Run、队列和工具只发送变化条目；set带目标index，删除先于插入，既有条目相对顺序保持。消息正文/思考处于streaming且仅追加时，message.append只含id、textDelta和thinkingDelta；新消息、非追加修改及终态用message.set给出准确完整值。仅工作状态变化时仍发送空changes推进持久序号，纯liveRevision变化不触发Web工作状态重查。活动分支改变、既有条目重排、超过256项或序列化超过512KiB时改发完整基线。

Web独立追踪当前连接的基线，逐批检查标识、分支、双水位、目标存在性和修改唯一性。旧/重复水位忽略；缺口或重叠不能部分应用，连接关闭后以100ms到2s的有界退避重新请求完整基线。每次SSE打开后5秒仍未收到有效基线时，同样报告同步超时并重建连接；收到基线、原生断线或订阅清理均取消该计时器。每32ms将最新接受状态合批写入Query，并保留未变化条目/集合引用。HTTP迟到响应与SSE共用双水位缓存，较旧响应不能覆盖新状态；HTTP先到较高水位时，SSE仍按自己的连续基线追赶。切换会话或卸载取消连接、重试和待发布批次，不将旧会话增量应用到新目标。

连接使用15秒注释心跳和8MiB单记录上限。Node写缓冲需要drain时暂停后续写入，只保留需要刷新这一标记；恢复后直接读取最新合并投影，不积累每个中间批次，5秒未恢复则断开。关闭立即清理心跳、drain/合批计时器、授权观察和订阅；正常可写连接在注销或停服时结束HTTP响应，背压、超时与异常连接强制销毁，不等待慢客户端排空。daemon仍读取完整公开投影并合并内存partial后计算差异；超出单记录上限的完整会话需要后续分页，不宣称无限历史可在一个基线中恢复。

终态区分completed、cancelled、failed和interrupted，SDK Promise resolve不等于成功。正常取消/失败在退出前保存已观测正文和思考，SDK错误的空消息不能抹掉已显示内容；真正崩溃前仅在内存、尚未完成的片段不恢复。存储提交失败时取消模型并停用该会话，读取或再执行返回503/SESSION_UNAVAILABLE；不能广播未提交的完成。重启先取得profile所有权，再为全部遗留根/子运行追加中断事实，持久seq前进后再提供快照，旧实时水位不会阻断新状态；MCP有派发屏障却无可靠结果时保留unknown，不自动重发，已终态历史不改写。

失败原因保存在既有Run.error中，MessageView不重复保存。运行层保留应用拥有的安全失败说明，将供应商异常归类为超时、网络、认证、限流或服务不可用的固定文案；未知异常使用通用失败提示，不公开SDK异常原文、响应体、请求头或堆栈。取消时error保持null。界面按runId关联该次失败回答，空回答也显示原因，不将最近一次错误作为整个会话的顶部提示；历史已提交记录不回填或改写。

每个会话在<logRoot>/sessions/<profileHash>/<sessionId>.jsonl保存完整宿主批日志，作为会话执行事实源；路径由[架构](../01_ARCHITECTURE/overview.md#启动配置)定义。完整批次校验后先持久化JSONL，再提交SQLite投影和推送公开事件。宿主记录含恢复所需privateData，普通HTTP/SSE仅输出公开投影；附件内容保存在独立校验文件。写入或投影失败返回503/SESSION_LOG_UNAVAILABLE并冻结后续持久写入，重启校验日志并重建投影，不重复执行副作用。不能从SQLite回填或覆盖权威日志，完整坏行明确拒绝。存储规则见[storage](../../packages/storage/README.md)。

日志下载是用户明确触发的受保护原始文件出口，沿用本机信任、应用登录与profile归属检查。响应为`application/x-ndjson; charset=utf-8`，以`<sessionId>.jsonl`作为attachment文件名，设置`Content-Length`、`Cache-Control: no-store`与`X-Content-Type-Options: nosniff`。storage在打开日志时固定已提交字节前缀，流式发送完整批记录；请求后的追加不会混入文件，下载不等待活动Run结束。文件包含全部分支及宿主恢复数据，私有对象与请求/工具正文的磁盘引用由SessionJournal校验还原，不将原始行直接作为UI事件。附件字节、应用配置和认证凭据仍由各自存储拥有。未知/已归档会话、非法ID或查询、未登录及不可确定日志状态明确拒绝；前端下载失败保留重试入口。

## 桌面桥

`getInfo()`只返回公开版本与平台。`openAuth(flowId)`只接受流程ID；main核对所属主frame并向daemon读取活动流程URL，再验证无凭据HTTPS地址后用系统浏览器打开。Renderer不能提供任意URL、IPC channel或Node参数；未知流程、非活动流程、其他窗口和子frame均被拒绝。
