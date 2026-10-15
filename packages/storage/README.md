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
