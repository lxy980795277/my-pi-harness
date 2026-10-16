# storage

Node 24 宿主使用的同步存储。JSONL保存会话执行事实，独立不可变文件保存冻结附件，better-sqlite3/Drizzle保存应用配置和会话查询投影。Renderer不得导入本包。

## 数据所有权

| 数据                                                                  | 权威位置             | SQLite职责                   |
| --------------------------------------------------------------------- | -------------------- | ---------------------------- |
| 会话创建、标题、归档、消息、Run、工具、队列、分支、工作状态与会话快照 | 每会话JSONL          | 可重建查询投影及事件分页     |
| 模型消息codec、冻结请求与队列幂等元数据                               | JSONL中的privateData | 仅宿主读取的恢复投影         |
| 附件元数据、冻结文本和图片内容                                        | checksummed附件文件  | 可重建元数据索引，不保存正文 |
| Provider配置、厂商绑定、工作区、应用设置                              | SQLite               | 权威配置，不能从会话日志恢复 |
| API Key、OAuth Token                                                  | 系统凭据库           | 只保存引用，不保存秘密       |

JSONL是宿主私有数据，包含模型恢复所需的完整codec和工具结果，不能直接作为HTTP/SSE响应。`readEvents()`只选择公开envelope，`getSnapshot()`只返回公开投影；图片base64仅在受保护附件内容接口按需提供。上下文中用户主动提供的正文和工具结果可能包含敏感信息，宿主日志不等于脱敏导出。

## 打开、提交与恢复

`openProfileStore(profileDirectory, { sessionLogRoot })`先获取独立`owner.sqlite`的SQLite VFS排他事务，再校验fresh schema、初始化文件目录和重建会话投影。`data.sqlite`使用WAL和FULL同步。所有权随OS释放，不按PID或时间猜测陈旧锁；`close()`先释放业务资源再释放所有权，重复调用安全。仅支持本机文件系统。

一个命令的完整事件批先在SQLite短事务内验证关联、状态和revision；所有事件通过后，将公开envelope及其privateData编码为一行批记录，追加JSONL并fsync，最后提交SQLite投影。创建会话时的初始Plan模式更新属于同一行批。队列消费和对应用户消息也属于同一批；后续任一事件非法时不写日志、不提交任何投影。返回后调用者才发布SSE。

每行格式版本1，包含batchId、previousBatchId、sessionId、firstSeq、records及SHA-256 checksum。记录中的公开event保留单会话递增seq和唯一eventId。一次事务只属于一个会话；中断恢复分别提交每个会话。单行最多32 MiB、10000个事件，读取按64 KiB分块，拒绝未知版本、无效UTF-8、校验和不符、重复或断序。

文件写入或fsync失败时，SQLite事务回滚，但文件提交结果可能未知；本实例冻结后续持久写入并允许读取已有投影。JSONL成功而SQLite提交失败时，JSONL已经提交，同样冻结写入并明确报告；不能根据错误重执行工具或重复接受请求。修复文件或数据库问题并重启后，日志中完整的批会被回放。数据库与文件没有跨介质原子保证。

每次启动在一个SQLite事务内清空会话派生表和附件索引，从附件文件与JSONL重新投影；Provider、Workspace和Settings不受影响。仅最后一行未完成的JSON片段可以截掉；结构完整但缺换行的合法记录补换行后保留；完整坏记录拒绝，不静默覆盖。已有SQLite会话缺少对应日志或没有有效创建记录时明确失败，不从SQLite反向填充日志。更换根目录需要携带权威日志和附件，不能得到一个看似空白的会话列表。

恢复前校验消息及未消费队列引用的附件文件存在。旧Run、未结束工具、待答问题和待审核计划追加为interrupted；保留部分输出和队列，不自动调用模型、执行工具或沿用审批。

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

`getSnapshot()`原子读取投影和游标，消息遵守选中分支顺序。编辑消息创建继承前缀的新分支；原历史保留。工具按assistant消息顺序和最初请求seq排列，`getModelContext()`将对应toolResult codec插入其后，缺失可恢复codec明确报错。

`work.updated`保存revision递增的完整分支状态；规则、上下文锚点与问题所属Run必须一致。`listCompactions()`从工作事件提取不可变摘要版本，包含恢复快照所继承的父摘要链；只返回覆盖锚点仍属于当前分支的版本。手动会话快照保存消息前缀和工作状态，恢复通过新分支执行，不撤销文件、Shell或外部副作用。

请求接受结果独立投影，消费或删除队列不丢失requestId；重复接受返回原结果。队列来源从原始接受事件及Run解析。会话删除是归档，保留日志与历史；活跃Run拒绝归档。工作区归档只改变配置，不删除目录；仍有活动会话引用时拒绝归档。

## 开发期schema与凭据

当前使用一个fresh schema，版本1和checksum与产物一起发布；未知或不匹配的已有profile明确拒绝。按用户授权，本轮删除旧开发数据，不提供旧SQLite、公开JSONL镜像或旧codec迁移。版本与结构校验继续保留。

`createSystemCredentialStore(profileDirectory)`按profile独立namespace使用macOS Keychain或Windows Credential Store。每个ref的操作串行，Token刷新由`modify()`拥有完整异步过程；失败不退回明文或内存。`createMemoryCredentialStore()`仅供测试显式注入，不读取Pi或其他项目凭据。

`pnpm --filter @my-pi-harness/storage test`使用真实临时SQLite和文件，覆盖批回滚、日志提交/SQL提交失败、重建、坏行、附件完整性、跨进程锁及中断恢复。系统凭据权限、Windows ACL和桌面安装需要独立目标平台证据。完整M3范围见[功能Spec](../../docs/04_FEATURES/202610151655_feature_m3-context-interaction/spec.md)，硬约束见[后端规范](../../docs/05_CONSTRAINTS/backend.md)。
