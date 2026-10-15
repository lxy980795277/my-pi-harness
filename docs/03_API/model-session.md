# 模型、授权与会话协议

本机wire协议版本为7，持久事件格式仍为version:1。M1的公开schema由 `packages/protocol/src/models.ts`、`auth.ts` 和 `sessions.ts` 拥有。HTTP返回公开DTO，SDK对象、模型上下文codec、凭据和数据库Entity不跨入Renderer。列表接口直接返回数组，写会话接口返回已提交的SessionSnapshot；失败返回 `{code,message}`。

## 授权

所有M1读取和写入均需要本机授权。`health` 与 `runtime/events` 仅公开进程身份；它们不包含会话事件。服务校验实际监听Host及准确Origin，开发只额外允许自有Vite的 `http://127.0.0.1:5174`。应用响应另以真实HTTP header设置frame-ancestors 'none'与X-Frame-Options DENY，禁止外部页面嵌入工作台。写请求还须携带当前内存CSRF Token到 `X-CSRF-Token`；Cookie为HttpOnly、SameSite=Strict、Path=/api，12小时过期。

| 方法与路径                    | 输入与结果                                        |
| ----------------------------- | ------------------------------------------------- |
| GET /api/auth/status          | AuthStatus，未授权时不公开身份或CSRF              |
| POST /api/auth/pair           | `{code}`；一次性配对，建立Cookie并返回AuthStatus  |
| POST /api/auth/desktop        | main私有启动secret；创建Cookie，秘密不进入preload |
| GET /api/auth/pairing-code    | 已授权所有者获取10分钟配对码                      |
| POST /api/auth/logout         | `{}`；撤销当前Cookie                              |
| GET /api/auth/github/start    | 可选GitHub应用PKCE授权地址                        |
| POST /api/auth/github/device  | `{}`；可选GitHub应用Device Flow                   |
| GET /api/auth/github/callback | 消费一次性state/code，完成身份查询并跳回页面      |

浏览器配对码只在直接启动daemon的交互终端显示，或由已授权页面读取；不写普通日志或stdout启动记录。5次失败后限流1分钟。Electron通过其持有的随机启动secret建立页面Cookie，页面无须输入配对码。退出或daemon重启后Cookie需要重新授权。

应用GitHub登录独立于模型Provider OAuth，不是本机使用前提。配置client ID后开放入口，Web授权码方式还需client secret，Device Flow只需client ID并在GitHub应用设置启用；授权码流程使用state、S256 PKCE与10分钟有效期，Device Flow按服务给出的间隔轮询，遵守slow_down并支持取消。身份查询完成即丢弃应用access token。[GitHub授权规则](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)

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

Provider ID标识配置实例，credentialRef标识系统凭据项。v2迁移保留原ID与凭据引用；无端点覆盖且无模型覆盖的旧内置实例按启用优先、ID的SQLite BINARY升序选择正常入口，一旦绑定不会随启停变化。其余旧内置配置标为legacy，通过具体ID继续供旧会话读取、认证与运行；不出现在正常列表。缺少安全候选时建立新的官方入口，不将旧代理配置的凭据转移到官方端点。历史provider_versions和Session事件不重写。

requiresApiKey=false仅适用于custom：请求跳过保存凭据和环境认证，使用Pi HTTP/SSE实现并在最终fetch剥除SDK生成的认证与OpenAI租户头。daemon启动时一次清理已核实的OpenAI/Anthropic SDK环境认证、Base URL、custom headers和日志覆盖项，阻止SDK自行带入宿主组织/项目、任意环境头或调试日志；其余环境保留。切换标志保留原凭据。hasCredential/credentialType描述保存状态，authSource描述实际认证模式，configured描述认证配置是否齐备；这些字段不证明远端连接成功。credentialPreview仅为掩码，OAuth不返回Token预览。运行期间持有Provider lease，配置和认证变更返回冲突；探测不会静默改用其他模型。

AuthFlow.prompt.type区分text、secret、select和manual_code；可含placeholder及选项description。只有text允许空字符串，其余输入不得为空且select必须命中现有选项。关闭所属认证Dialog通过DELETE取消流程；SDK结算与凭据写入完成前，账户仍拒绝并行认证修改。

## Session与输入

| 方法与路径                                       | 输入与结果                                                 |
| ------------------------------------------------ | ---------------------------------------------------------- |
| GET /api/sessions                                | SessionSummary[]                                           |
| POST /api/sessions                               | SessionCreateInput；返回SessionSnapshot                    |
| GET /api/sessions/:id                            | 当前分支、消息、Run、队列与snapshotSeq                     |
| PUT /api/sessions/:id                            | SessionPatchInput；设置用于后续Run                         |
| DELETE /api/sessions/:id                         | 归档会话，从列表隐藏；保留历史事实，不是隐私擦除           |
| POST /api/sessions/:id/inputs                    | `{text,attachmentIds?,mode,requestId}`；接受输入后返回快照 |
| POST /api/sessions/:id/stop                      | `{}`；提交取消意图、等待SDK结束，返回快照                  |
| PUT /api/sessions/:id/queue/:inputId             | `{text,revision}`；旧版本409                               |
| DELETE /api/sessions/:id/queue/:inputId          | 删除尚未消费的输入                                         |
| POST /api/sessions/:id/queue/resume              | `{}`；显式继续保存队列                                     |
| POST /api/sessions/:id/edit                      | `{messageId,text,requestId}`；新分支重发                   |
| POST /api/sessions/:id/branches/:branchId/select | `{}`；切换历史分支，运行中409                              |
| GET /api/sessions/:id/events?afterSeq=N          | 已授权EventSource订阅与重放                                |

新建Session保存workspaceId和approvalMode（细节见[M2协议](workspace-execution.md)）。可以只提交title，此时owner读取持久化defaultModel并校验Provider启用、模型存在、thinkingLevel支持及认证可用后创建；未设置或失效时返回明确错误，不创建Session或发起模型请求。显式选择须同时提交providerId、modelId、thinkingLevel。修改全局默认只影响以后新建Session，不改写已有会话、队列或活动Run。默认引用失效时仍保留原值，由用户明确修改或置空，不自动选择替代模型。

输入附件、消息/队列保留的attachmentIds与分支工作状态见[M3协议](context-interaction.md)。编辑用户消息重发继承原附件，队列文字修改保留原附件。

同Session只允许一个活跃Run；不同Session可以并行。requestId保持幂等，同一请求重发不启动第二个Run。运行中的send返回409；follow-up在当前回复结束后消费，steer中断当前模型请求并继续同一个Run。接受、修改、删除和消费队列均有持久事务。用户停止、运行失败或重启后不会自动恢复收费请求，队列由用户明确继续；普通新消息或编辑重发不会自动消费旧暂停队列。恢复要求选择原分支，并按保存的Provider/model消费。

立即执行冻结模型、推理级别和system prompt；运行内队列使用所属Run的冻结模型，设置变更影响新Run。恢复旧队列时使用记录的provider/model，读取该配置当前已提交版本。编辑用户消息建立新分支并选择准确前缀，旧消息及旧分支回复保留；忙时禁止编辑与分支切换。

## 事件、快照与断线

HarnessEvent包含固定格式version:1、eventId、sessionId、可空runId、seq、type、at和公开data。seq在单Session事务中单调递增，事件追加和消息/Run/队列投影同时提交。SSE发送 `session.event` 重放事实，再发送 `session.snapshot`，data直接为SessionSnapshot，id为已提交seq。快照从同一数据库事务读取，snapshotSeq与内容一致。

服务先订阅已提交事件，再同步读取和分页重放；随后将进度按32ms合并发送快照。客户端以Session和seq合并HTTP与SSE，较旧响应不能覆盖新快照。断线重连从已接受seq补读；超出当前高水位的游标返回409。15秒注释心跳、背压断开和8MiB单记录上限限制连接资源，慢客户端不阻塞模型或数据库。关闭连接清理定时器与订阅。

终态区分completed、cancelled、failed和interrupted，SDK Promise resolve不等于成功。存储提交失败时取消模型并停用该会话，读取或再执行返回503/SESSION_UNAVAILABLE；不能广播未提交的完成。重启先取得profile所有权，再将遗留Run标记interrupted并保留已提交部分。

每个会话另有`<logRoot>/sessions/<profileHash>/<sessionId>.jsonl`公开事件镜像，隐藏目录的开发/正式路径与配置由[架构](../01_ARCHITECTURE/overview.md#启动配置)定义。SQLite先提交，文件随后同步追加；JSONL不含privateData、私有模型codec或附件字节，不是独立恢复备份。文件失败返回503/SESSION_LOG_UNAVAILABLE，数据库事实可能已经提交，读取仍可用但后续写入暂停；先检查现有结果并修复文件问题、重启，不重复执行不确定操作。启动按SQLite补齐历史、缺失记录与崩溃末行；完整行冲突返回SESSION_LOG_INVALID，不静默覆盖。旧目录日志保留，不从其导入或覆盖数据库。详细持久化规则见[storage](../../packages/storage/README.md#会话jsonl镜像)。

## 桌面桥

`getInfo()`只返回公开版本与平台。`openAuth(flowId)`只接受流程ID；main核对所属主frame并向daemon读取活动流程URL，再验证无凭据HTTPS地址后用系统浏览器打开。Renderer不能提供任意URL、IPC channel或Node参数；未知流程、非活动流程、其他窗口和子frame均被拒绝。
