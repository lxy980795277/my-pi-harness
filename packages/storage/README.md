# storage

Node 24 宿主使用的同步存储。JSONL保存会话执行事实，独立不可变文件保存冻结附件，better-sqlite3/Drizzle保存应用配置和会话查询投影。Renderer不得导入本包。

## 源码职责

`src/index.ts`是唯一公开入口。`profile/`拥有打开、锁、关闭、恢复及跨JSONL与SQLite的提交编排；`sqlite/`保存Drizzle表和按版本校验的迁移；`sessions/`保存日志、附件、上下文查询和事件校验，`sessions/projections/`维护可重建的会话、工具、能力及工作状态投影。`repositories/`保存身份、模型配置、工作区、MCP、扩展及高级账户的SQLite仓储；`credentials/`拥有系统凭据和插件私有凭据；`shared/`仅放存储错误和通用持久数据校验。

模型配置、厂商绑定和默认模型由`ModelSettingsRepository`查询与更新，`ProfileStore`保持对外方法和事务所有权。配置更新通过宿主提供的事务函数执行，继续服从profile关闭状态和日志写入失败后的写入冻结，不另建提交或恢复路径。

## 数据所有权

| 数据                                                                      | 权威位置             | SQLite职责                           |
| ------------------------------------------------------------------------- | -------------------- | ------------------------------------ |
| 会话创建、标题、归档、消息、Run、工具、队列、分支、工作状态、子任务与通信 | 每会话JSONL          | 可重建查询投影及事件分页             |
| 模型消息codec、冻结请求与队列幂等元数据                                   | JSONL中的privateData | 仅宿主读取的恢复投影                 |
| 附件元数据、冻结文本和图片内容                                            | checksummed附件文件  | 可重建元数据索引，不保存正文         |
| Provider配置、厂商绑定、工作区、应用设置                                  | SQLite               | 权威配置，不能从会话日志恢复         |
| 子Agent角色、启停、模型选择与执行限制                                     | SQLite               | 独立配置，投影重建不删除             |
| 用户、外部身份、profile归属、本机客户端和应用登录会话                     | SQLite               | 权威认证事实，投影重建不删除         |
| MCP Server配置、秘密引用、作用域启动授权及profile身份epoch                | SQLite               | 权威配置，独立于浏览器登录与会话投影 |
| 模型 Key、高级账户和独立 MCP OAuth Token                                  | 系统凭据库           | 只保存引用，不保存秘密               |
| 插件共享 OAuth Token 与账号                                               | profile 私有 JSON    | 不保存 Token 或账户桥接记录          |

JSONL是宿主私有数据，包含模型恢复所需的完整codec和工具结果。普通HTTP/SSE通过`readEvents()`选择公开envelope或`getSnapshot()`返回公开投影；用户明确下载日志时，由受保护的[会话日志接口](../../docs/03_API/model-session.md#事件快照与断线)读取原始已提交JSONL前缀，保留全部分支和恢复数据。图片base64仅在受保护附件内容接口按需提供。上下文中用户主动提供的正文和工具结果可能包含敏感信息，宿主日志不等于脱敏导出。

## 打开、提交与恢复

`openProfileStore(profileDirectory, { sessionLogRoot })`先获取独立`owner.sqlite`的SQLite VFS排他事务，再校验fresh schema、初始化文件目录和重建会话投影。`data.sqlite`使用WAL和FULL同步。所有权随OS释放，不按PID或时间猜测陈旧锁；`close()`先释放业务资源再释放所有权，重复调用安全。仅支持本机文件系统。

一个命令的完整事件批先在SQLite短事务内验证关联、状态和revision；所有事件通过后，将公开envelope及其privateData编码为一行批记录，追加JSONL并fsync，最后提交SQLite投影。创建会话仅保存会话与初始分支，空工作状态由分支派生。队列消费和对应用户消息也属于同一批；后续任一事件非法时不写日志、不提交任何投影。返回后调用者才发布SSE。

文本与思考片段通过publishMessageDelta更新独立内存覆盖层，不调用持久事务或写入JSONL/SQLite；append拒绝message.delta。getSnapshot、getTaskSnapshot和任务详情合并当前partial，模型历史只读取持久完整消息。snapshotSeq仍为连续持久水位，liveRevision仅在当前seq内递增，成功持久提交后归零但保留其他活动partial；完整消息或Run终态清理对应覆盖层。正常取消/失败由运行时保存已观测完整正文，真正崩溃前未完成的内存片段不恢复；启动持久中断全部在途根/子执行，保证客户端水位继续前进。

AgentTaskQuery将详情分页限制落实到SQL ordinal范围及本页消息ID，工具仅取本页锚点和待审批项，子树用量仅提取计量字段；完整任务快照保留给运行时，不作为详情分页的中间结果。getVisibleTool按会话和工具ID检查当前分支保留的根消息或Task外层委派锚点，支持继承前缀里的子工具，拒绝不可见、跨会话及失步写入状态；不扫描整份转录或合并子消息到主快照。

新写入的每行仅包含records及SHA-256 checksum，不保存批次版本。读取先对原始对象除checksum外的全部字段验证校验和，再选择records回放；既有行的额外元数据参与校验但不决定读取分支，原始历史不会因此重写。session归属与连续seq由每条event校验，eventId仍唯一。一次事务只属于一个会话；中断恢复分别提交每个会话。单行最多32 MiB、10000个事件，读取按64 KiB分块；无效UTF-8、校验和不符、非法记录、重复或断序明确拒绝。

privateData使用原生JSON对象，模型codec、队列绑定和请求messages不再嵌套JSON字符串。磁盘工具展示result与同批canonical文本完全相同时，以`{from:'tool.context'}`引用正文；不同或更丰富的展示值仍完整保存。context.prepared.messages使用完整codec对象或同Run、同branch上一请求的消息索引，systemPrompt为字符串或指向首system消息内容的0。首次请求必须自包含，结束Run只释放自身基线，其他活动Run不重写未变历史。SessionJournal.read先验证原始行checksum再还原完整记录，返回逐事务records数组；原始文件下载保留引用编码。

`event-validation.ts`是公开持久payload的单一schema所有者，codec在完成解引用和原请求基线保存后，经`stored-event.ts`按相同定义选择当前公开字段；废弃附加字段不进入新投影，privateData和原文件不改写。必要数据与关系继续由所属投影校验，未知progress/audit数据保持原语义；HTTP和新写业务不使用此宽松读取路径。完整职责见[持久字段投影](../../docs/09_TECHNICAL/会话存储与恢复设计.md#412-持久字段投影)。

SQLite的private_data列使用JSON对象映射，字段与表版本不变。完整请求审计仅保存在JSONL，事件查询投影不再额外保存context.prepared的完整私有历史；模型续聊继续从消息codec及canonical工具结果重建。

文件写入或fsync失败时，SQLite事务回滚，但文件提交结果可能未知；本实例冻结后续持久写入并允许读取已有投影。JSONL成功而SQLite提交失败时，JSONL已经提交，同样冻结写入并明确报告；不能根据错误重执行工具或重复接受请求。修复文件或数据库问题并重启后，日志中完整的批会被回放。数据库与文件没有跨介质原子保证。

每次启动在一个SQLite事务内清空会话派生表和附件索引，从附件文件与JSONL重新投影；Provider、Workspace、Settings和应用登录事实不受影响。仅最后一行未完成的JSON片段可以截掉；结构完整但缺换行的合法记录补换行后保留；完整坏记录拒绝，不静默覆盖。已有SQLite会话缺少对应日志或没有有效创建记录时明确失败，不从SQLite反向填充日志。更换根目录需要携带权威日志和附件，不能得到一个看似空白的会话列表。

恢复前校验消息及未消费队列引用的附件文件存在。旧Run、未派发工具、待答问题和待审核计划追加为interrupted；工具已有派发屏障但没有明确结果时追加unknown。保留已持久输出和队列，不恢复未完成的内存片段，不自动调用模型、执行工具或沿用审批。

## 路径、附件与安全

启动入口为开发及正式运行显式指定仓库根目录的`.my-pi-harness`，库本身不推断cwd或NODE_ENV；测试显式使用临时目录。未传选项时库默认使用profile内隐藏根。显式根必须为绝对路径，末级名固定，父目录已经存在；profile不能位于该根内部。

```text
<sessionLogRoot>/sessions/<SHA256(canonicalProfilePath)>/
  <sessionId>.jsonl
  attachments/<attachmentId>.json
```

不同profile共享根时按canonical路径摘要隔离。根、sessions、profile摘要和附件目录0700，文件0600。保存并检查打开目录的身份；拒绝符号链接、多硬链接、非普通文件、越界ID、目录替换和非当前用户拥有的数据。每次写入检查文件身份，运行中的日志发生外部变化则拒绝追加。构造或恢复失败释放全部fd和profile所有权。

附件文件保存格式版本、内容和SHA-256校验和；临时文件写入并fsync后用排他链接发布，再同步目录。已有ID拒绝覆盖；临时文件不参与恢复。每次读取校验文件、大小、schema、ID和hash。附件文件保存当前AttachmentContent规定的冻结文本、图片和元数据；文档原始二进制的额外保留不由该DTO承诺。

目录fd和身份检查不能替代针对同用户恶意进程的OS隔离。Windows不持有目录fd，其ACL权限与目录持久化语义仍需真实目标平台验证。

## 查询与工作状态

`getSnapshot()`原子读取投影和游标，消息遵守选中分支顺序。编辑消息创建继承前缀的新分支；原历史保留。工具按assistant消息顺序和最初请求seq排列，`getModelContext()`将对应中立私有结果插入其后，由runtime转换模型codec。工具终态与结果必须在同一JSONL批次提交，结果关联原始调用、assistant锚点及来源；冻结来源、参数与派发事实不能回退或改写，晚结果不能覆盖终态。

启动恢复只提取已持久assistant的调用意图，为未进入执行器的后续call补宿主interrupted结果，为有屏障但无明确结果的call补unknown及“可能已生效”说明。已完成结果保持不变，每个call只配对一次；已终态Run中的遗漏调用也可补齐，不重写Run终态或连接Server。

`work.updated`保存revision递增的完整分支状态；规则、上下文锚点与问题所属Run必须一致。`listCompactions()`从工作事件提取不可变摘要版本，包含恢复快照所继承的父摘要链；只返回覆盖锚点仍属于当前分支的版本。手动会话快照保存消息前缀和工作状态，恢复通过新分支执行，不撤销文件、Shell或外部副作用。

请求接受结果独立投影，消费或删除队列不丢失requestId；重复接受返回原结果。队列来源从原始接受事件及Run解析。冻结的MCP定义与非秘密授权保存在队列私有元数据，编辑同步更新并保留接受身份；投影重建后仍可由宿主读取，公开快照不返回该字段。会话删除是归档，保留日志与历史；活跃Run拒绝归档。工作区归档只改变配置，不删除目录；仍有活动会话引用时拒绝归档。

## 应用身份与登录

`ProfileStore.auth`拥有应用User、稳定外部身份、单profile账号归属、本机信任和登录会话。首次`completeLogin()`在同一短事务内验证未过期客户端、绑定用户和身份、签发会话；任一步失败全部回滚。GitHub昵称/头像更新不改变内部userId，不同provider/issuer/subject拒绝接管已有profile，不自动关联相同邮箱。

本机信任和应用登录分别按哈希查找，两个有效期都必须通过且登录属于原clientId。这里仅保存小写SHA-256摘要，不接收GitHub token，也不把认证事实写到会话JSONL；CSRF token随本机客户端持久化。凭据创建、GitHub验证、Cookie和会话有效期政策由daemon拥有。持久化读取校验字段、用户JSON和关联，损坏时明确失败。

`revokeClientSessions(clientId)`撤销当前客户端所有登录而保留本机信任、profile归属与业务数据，另一客户端不受影响。有效会话可跨daemon重启及离线恢复，但不声明已检测GitHub侧撤销。每次写入最多清理100个过期登录及100个无会话引用的过期客户端，读取只校验有效期，不产生写入；退出按指定客户端撤销全部会话。

## 开发期schema与凭据

SQLite schema按版本和checksum校验：0001保存配置与会话投影，0002添加应用登录事实，0003添加MCP配置/启动授权/身份epoch及队列私有元数据。未知SQLite版本、已应用migration内容不匹配明确拒绝；该迁移版本独立于无批次版本的会话JSONL。

`createSystemCredentialStore(profileDirectory)`按profile独立namespace使用macOS Keychain或Windows Credential Store。每个ref的操作串行，Token刷新由`modify()`拥有完整异步过程；失败不退回明文或内存。`createMemoryCredentialStore()`仅供测试显式注入，不读取Pi或其他项目凭据。

`PluginCredentialStore.open(<profile>/skill-credentials.json)`专门保存插件共享 OAuth：每个插件一份 Token、账号与私有用户/身份 epoch/安装 generation。JSON 文件必须为当前用户拥有的普通单链接文件，POSIX 权限为 `0600`，拒绝目录或末级文件链接、损坏 schema 和超过 4 MiB 的记录。写入串行，临时文件写入并同步后经拥有者校验再原子替换；缓存与已发布文件同时更新。撤销校验失败保留此前文件；断开和卸载删除对应插件，不改高级账户或其他插件。此文件是插件凭据的明确权威位置，系统凭据不可用时不会将其他秘密降级写入这里。

`pnpm --filter @my-pi-harness/storage test`使用真实临时SQLite和文件，覆盖批回滚、日志提交/SQL提交失败、重建、坏行、附件完整性、跨进程锁及中断恢复。系统凭据权限、Windows ACL和桌面安装需要独立目标平台证据。完整M3范围见[功能Spec](../../docs/04_FEATURES/202610151655_feature_m3-context-interaction/spec.md)，硬约束见[后端规范](../../docs/05_CONSTRAINTS/backend.md)。

## M4能力配置与会话事实

当前SQLite schema为9；第7代迁移移除已退役插件默认账户的归属标记，保留原账户及系统凭据引用，第8代添加`mcp_catalog_snapshots`派生目录，第9代加入下述子任务投影与独立角色配置。目录按Server及作用域保存非秘密授权指纹、有界协议定义JSON和发现时间，不保存凭据字节或可执行TypeBox对象；宿主恢复时重验官方协议与当前授权。目录可重建，损坏或失效不能授予信任，也不能替代配置/秘密。MCP目录开关/精确只读授权、远程配置、Skill启停、插件安装及高级外部服务连接是SQLite配置事实；插件共享 OAuth 按上述私有 JSON 独立保存，其他秘密保留系统凭据库。Skill冻结文件保存于profile的不可变版本目录，资源使用hash校验和Run lease，不能仅备份会话日志替代这些资源。

`run.accepted`私有数据保存初始工具、不可变候选目录与Skill正文/授权；`run.tools_loaded`保存递增可见版本、完整定义/来源及冻结Skill。投影校验版本连续、公开名称对应私有定义、加载项来自原候选、初始工具/Skill不能悄悄丢失。`context.prepared.capabilityRevision`必须等于当前可见版本。服务插件的只读网关地址保存在冻结Skill中，私有网关访问能力不进入日志。重建不连接上游或重做请求。

`getSkillContext(sessionId, branchId, messageIds?)`从当前分支可回放消息的接受与加载事实读取冻结指令，按事件顺序核对消息锚点，保留每个Skill最近版本，最多16项。分支后缀、被排除消息和其他会话不参与继承；重启不读取新磁盘正文。调用方决定压缩/重置的历史范围并重验当前启用、安装代和授权；该查询不提供工具权限或公开HTTP接口。

## M5子任务数据

子任务与根执行共用Session的JSONL和seq。`task.created`只记录稳定任务ID、源委派工具ID、标题、冻结角色和限制；父Run、根Run、分支及消息锚点由原工具记录推导，仅存可重建索引。子Run通过可选`taskId`归属任务，省略表示根Run，`session.activeRunId`始终只指向根执行。

子消息写入`task_messages`顺序表，不进入主分支消息列表；`getTaskSnapshot()`、`getTaskModelContext()`、`getTaskWorkState()`及`listTaskCompactions()`只读取所选任务。`work.updated`和`context.prepared`用可选`taskId`明确作用域，根和子请求、摘要锚点及人工问题所属Run必须匹配。`getSnapshot()`不加载子转录；任务树沿最外层委派的助手消息锚点判断分支可见性，避免编辑同Run中后续输入时错误保留被截断的子任务。

通信先保存`task.message_queued`，消费事件与对应目标模型输入必须同批，`MessageView.agentMessageId`唯一关联原通信，正文与目标Run同时核对；不能只凭相同文本匹配用户消息，也不允许一个消费关联多个输入。原通信是单独来源，不能作为真正的用户提问展示或编辑；未消费内容不会触发模型请求。父Run终态要求所属任务已经关闭，任务关闭要求本身与后代没有在途执行。启动按叶到根结束子Run和任务，将未消费通信结算为未送达，保留已完成消息及结果，不重做模型或工具副作用。

`listAgentBoard()`在分页前按当前分支、工作区及执行/人工等待/终态筛选，详情按任务消息ordinal分页。角色配置通过独立`agent_settings`保存并检查revision；默认值由protocol的`defaultAgentSettings()`产生，日志重建不删除用户配置。
