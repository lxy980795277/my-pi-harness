# storage

Node24宿主使用的真实better-sqlite3/Drizzle存储。Renderer不导入本包；`openProfileStore(profileDirectory)`先获取独立 `owner.sqlite` 的SQLite VFS独占事务，再迁移 `data.sqlite` 并将未结束Run追加为interrupted。`close()`释放数据库后释放所有权，进程死亡由OS释放锁；不按PID或时间猜测stale，不删除锁数据库。仅支持本机文件系统，不使用网络共享数据库。

执行事件不可修改或删除，持久事件与公开envelope各自包含 `version: 1`，读取拒绝未知事件格式版本；单Session递增seq与消息、Run、分支和队列投影在同一短事务提交。`append`返回已提交的公开事件，调用者在返回后发布SSE；privateData保存版本化Provider codec与队列接受元数据，HTTP/SSE不返回该列。`getSnapshot`同事务读取投影与游标，消息按当前分支的关联顺序返回；分支修订继承被编辑用户消息之前的前缀，原历史保留。

0003新增Workspace元数据与工具投影，只为既有Session投影追加`workspaceId:null`和`approvalMode:"ask"`，不修改已提交事件。工作区保存daemon验证后的真实目录；存储层不访问或删除该目录。目录唯一性仅覆盖未归档工作区，重命名使用revision；仍有未归档Session时拒绝移除。移除只归档元数据，历史Session仍指向原ID，同目录重新添加会生成新ID。Session的工作区创建后固定，未分配工作区不会回退宿主cwd。

0004为已有工作区（包括归档记录）补默认icon:folder，只修改缺少该字段的元数据，保留ID、路径、revision、会话关联和历史事件。新建和编辑校验固定图标ID；省略编辑icon时保留原值，与名称一起使用revision控制并发。

`tool.requested`和`tool.updated`在追加事务内更新工具卡；工具与所属Run、分支及产生调用的assistant消息关联。持久事件和工具data列使用原有`ToolCallRecord`字段；公开快照的`ToolCallView.afterMessageId`从已保存的anchor_message_id投影，供页面把工具放在对应assistant之后，不向历史事件或工具JSON追加字段。`tool.context`公开数据仅记录关联ID，完整toolResult codec保存在私有列。快照按选中分支继承的消息筛选工具，先按assistant消息顺序、再按原始`tool.requested`事件seq排列，同毫秒调用、后续状态更新与重启恢复都不改变请求顺序；缺少原始请求事件时明确报错。`getModelContext`按消息顺序插入其后按事件seq排序的toolResult，可按消息ID前缀读取，避免编辑重发将工具结果计为额外聊天消息。重启把未结束工具与所属Run在同一事务标记interrupted，不自动执行工具或沿用待审批授权。

请求接受结果独立持久保存，队列消费/删除后仍可查原requestId。队列接受关联当时的活跃Run，`getQueueBranch`从不可变接受事件与所属Run查询原分支，后续编辑和分支切换不改该来源。队列消费必须同事务提交相应用户消息；活跃Run可消费steer/follow-up，消费不要求另建Run。终态重复提交保持第一个结果。重启保留部分输出和未消费队列，不自动发起模型请求。

Provider当前配置有乐观revision，历史版本保留；credentialRef是公开引用；认证状态、预览和legacy标记由模型/凭据所有者计算，不作为持久状态。0002只升级当前Provider JSON并建立内置厂商固定绑定及全局默认设置，冻结的0001、provider_versions和Session事件保持原样。正常入口只选无端点/模型覆盖的旧内置配置，按启用优先、ID的SQLite BINARY升序绑定；旧重复实例与覆盖项保留，缺少候选由Gateway创建新入口，不复制凭据。默认设置有独立revision，不改写既有Session选择。Session删除为归档：当前列表与快照不再显示，事件和队列保留，活跃Run拒绝归档；它不是隐私数据彻底擦除。

`createSystemCredentialStore(profileDirectory)`通过profile独立namespace使用macOS Keychain/Windows Credential Store。每个ref的read/write/delete/modify串行，modify涵盖完整异步Token刷新；返回undefined明确删除，返回current表示不变。系统失败不回退明文或内存。`createMemoryCredentialStore`仅由测试显式注入，不读取用户Pi或其他项目凭据。

迁移随编译产物嵌入，记录版本与SHA-256；拒绝未知更高版本或改写已应用迁移。M1初始迁移发布后冻结，后续只追加。规则见 [后端约束](../../docs/05_CONSTRAINTS/backend.md)；接口与整个M1验收由 [功能Spec](../../docs/04_FEATURES/202610131100_feature_model-session/spec.md) 管理。

`pnpm --filter @my-pi-harness/storage test`使用真实临时SQLite、实际跨进程锁/强杀恢复与显式Memory凭据替身；系统账号授权、签名与目标平台原生资源单独验收，不从单测推出已验证用户Keychain权限。源码检查不依赖dist，发布构建通过真实package exports解析protocol。

0005新增按Session/Branch保存的工作状态、冻结附件与Checkpoint。`work.updated`追加完整且revision递增的状态；规则、摘要与重置锚点必须属于该分支，问题关联真实Run。`checkpoint.created`要求停止Run，保存当前工作状态及有序消息前缀；`branch.restored`建立继承空或完整前缀的新分支，旧分支与事件保持原样，恢复不修改文件。新分支工作状态初始为空，调用方显式追加恢复后的状态。每会话最多100个Checkpoint。

`context.prepared`公开记录分支、估算用量、消息和附件ID，最终systemPrompt与消息codec仅保存在私有事件列；必须属于当前活跃Run，消息是分支的有序子集。附件内容独立保存在私有attachments表，通过授权的内容接口按需读取，SSE与会话快照不包含图片base64。重启对各分支仍为pending的问题追加interrupted状态，不修改先前事件或自动继续问答；原Run及工具恢复规则继续有效。

## 会话JSONL镜像

`openProfileStore(profileDirectory, { sessionLogRoot })`把公开日志放在`<sessionLogRoot>/sessions/<SHA256(canonicalProfilePath)>/<sessionId>.jsonl`；省略选项时根为`profile/.my-pi-harness`。显式根必须是绝对路径且末级名为`.my-pi-harness`，其父目录须已存在；SQLite profile不能等于该根或位于根内部。`sessionLogDirectory(canonicalProfileDirectory, sessionLogRoot)`是无文件副作用的路径解析函数，调用方传入真实绝对profile路径。两个profile可以共享同一根，同名Session按profile摘要隔离，profile独占锁规则不变。每个文件逐行保存已提交的公开HarnessEvent，seq、eventId及Session归属与SQLite一致，包含归档历史。SQLite仍是唯一事实源；JSONL不含privateData、Provider私有codec、凭据或附件字节，消息仅保留附件ID，因此不是可独立恢复全部会话的备份，也不提供本轮导入。ProfileStore创建会话和append同步更新镜像，重复请求不重复行；初始Plan与中断恢复的嵌套事务只在最外层SQLite真正提交后写文件，回滚不产生镜像记录。

更换日志根时从SQLite补齐新位置，包含归档历史；旧`profile/sessions`与先前根下的日志均保留，不读取它们作为恢复来源，也不迁移数据库或系统凭据。

每批先提交SQLite，再追加对应会话日志并fsync，没有数据库与文件的跨介质原子保证。写入或fsync失败返回SESSION_LOG_UNAVAILABLE，明确SQLite事实已经提交，暂停后续持久写入但允许读取事实；调用方不能据此重复执行工具或接受请求，应先修复文件问题并重启。启动按SQLite补齐缺失文件、缺失事件及崩溃末行，完整JSON只缺换行时补换行，不重复已匹配的事件。完整行内容不符或出现多余完整行返回SESSION_LOG_INVALID，不静默覆盖；保留问题镜像供检查，SQLite事实保持原样。

日志根、sessions与profile摘要目录0700，文件0600；保留已打开目录的身份并在关闭时释放，构造或恢复失败也释放目录fd与profile所有权。拒绝不安全Session文件名、目录身份替换、符号链接、多硬链接和非普通文件；每次打开与写入前核对真实父目录和目标inode。校验逐块读取，单公开行上限32MiB；运行内只对身份、大小及时间均未变化的文件复用已校验游标。关闭不遗留后台写入任务。目录fd与写前身份检查不能替代针对可任意操控同用户文件系统的恶意进程的OS隔离；Windows使用初始目录身份核对而不打开目录fd，日志文件仍fsync；其ACL权限和目录持久化语义需要目标平台验证。
