# 完整会话归档与导入

完整归档是单Session的tar.gz文件，媒体类型application/gzip，首项manifest.json使用独立formatVersion:1。[公开schema](../../packages/protocol/src/sessions/archives.ts)定义清单、预检、导入回执与执行绑定；[传输任务](../../packages/protocol/src/sessions/archive-jobs.ts)定义有界进度和操作查询。打包解包采用[tar-stream](https://github.com/mafintosh/tar-stream)与Node gzip流，不根据tar路径直接创建正式文件。

## 归档范围

宿主冻结已提交cursor，遍历全部分支和子Run，只收集日志可达的附件、产物blob、原生文件前后像及历史Skill资源。正文按已有codec读取，字节按长度和SHA-256核对。已提交流式前缀可以导出，尚在内存的片段不包含；manifest标明导出时是否仍有活动Run。

归档不包含Provider Key、OAuth Token、Keychain、应用登录、本机工作区授权或独立长期记忆数据库。历史资料中原本填写的秘密仍可能位于正文，不能承诺自动脱敏。办公附件仅包含实际已经保留的冻结内容，不声称备份未保留的原始二进制。依赖只列非秘密模型、工作区及插件引用，导入不会安装插件或迁移授权。

原有GET /api/sessions/:id/log仍下载JSONL本体，不包含独立引用资源。导入入口只接受完整gzip归档，不能把单独JSONL冒充完整备份。

## 传输接口

| 接口                                                      | 行为                                 |
| --------------------------------------------------------- | ------------------------------------ |
| POST /api/session-archives/exports                        | 用operationId和sessionId生成完整归档 |
| GET /api/session-archives/exports/:operationId/download   | 下载仍由服务持有的临时文件           |
| POST /api/session-archives/imports/:operationId/upload    | 原始application/gzip字节流上传并预检 |
| POST /api/session-archives/imports/:operationId/commit    | 携带archiveSha256明确确认导入        |
| GET /api/session-archives/operations/:operationId         | 查询任务或持久导入回执               |
| GET /api/session-archives/operations                      | 按cursor、limit读取操作摘要          |
| POST /api/session-archives/operations/:operationId/cancel | 取消尚未进入发布的传输或验证         |

上传只做资源、格式、codec及关系预检，返回ready与preview，不创建普通会话。preview省略完整条目清单，只给数量、大小、历史依赖、冲突总数及最多100条冲突。会话及profile全局ID冲突在发布前拒绝，已有Session不会被覆盖。相同内容寻址资源可在校验后复用。

确认导入使用原operationId和归档摘要。相同请求查询或重提返回原回执，改变内容拒绝；客户端不得在未知结果时自动再次POST。进入持久发布后不再把取消表示为回滚，按原ID查询权威状态。导入回执跨服务重启保留；纯传输与导出临时任务随进程清理，已发布会话仍可从会话列表及操作历史找到。

操作列表按createdAt和operationId倒序，limit为1至50，cursor不透明。列表不返回完整preview或正文。导出有downloadAvailable字段，临时文件释放后不能继续下载，须重新导出。服务保留最近两份可回收导出，下载持有的旧文件在租约释放后再回收；同时最多四个下载租约。关闭响应或服务会释放所属流，不按进程名清理其他工作。

传输限额为压缩后256 MiB、展开流512 MiB、单日志384 MiB、单资源32 MiB、manifest 8 MiB及最多10000项。传输和预检限时五分钟，同时至多两个活动或待确认任务。条目必须是清单声明的普通文件，拒绝绝对路径、上级路径、链接、重复条目、缺资源、坏hash及不完整压缩流。正式发布前仍执行storage资源配额和关系复核。

## 发布与恢复

storage在私有临时区复用正式SessionJournal codec、ProjectionWriter和资源校验器预检，随后保存持久发布计划。资源、日志、投影和回执不宣称跨介质原子；启动根据拥有者发布计划收口存储，不启动模型、不重放工作区或外部副作用。正式日志及投影校验完成前不向普通会话列表公布半成品。

导入收口终结旧活动Run、任务、队列和待交互状态。历史文件操作被标为非本机，并隔离目标键，只能查看快照。旧导入标记或绑定事实不能为新profile授予权限，历史记忆采用也不会写入当前长期记忆。数据损坏或发布结果不确定时冻结写入，保留原操作ID用于恢复查询。

## 重新绑定执行

GET /api/sessions/:id/archive-access返回importedThroughSeq及bound。导入会话默认bound:false，可以阅读历史和浏览分支；发送、恢复旧队列、批准工具、子任务续作及工作交互不能绕过后端准入。

PUT /api/sessions/:id/archive-binding明确选择当前providerId、modelId、thinkingLevel及workspaceId。宿主在会话串行门内检查活动状态、当前模型的文本/推理能力、凭据及工作区可用性，然后同批保存本机绑定与配置。推理强度必须是当前模型支持的值，执行权限从请求批准开始；需要其他权限时由用户重新选择。旧MCP/Skill授权不会因ID、hash或epoch相同而继承，新的显式选择重新按当前本机配置冻结。
