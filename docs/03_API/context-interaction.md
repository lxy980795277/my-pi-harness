# 上下文与工作状态协议

当前wire协议为7，DTO与schema由`packages/protocol/src/context.ts`和`sessions.ts`拥有。SQLite追加0005；Session事件信封仍为version:1，私有消息codec继续写2、读1/2。所有接口复用[本机授权](model-session.md#授权)、准确Host/Origin与写请求CSRF校验，未知字段拒绝；客户端与daemon同步升级。

## 附件与引用

| 方法与路径                                      | 输入与结果                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| POST /api/attachments                           | `{name,mediaType,data}`，data为标准base64；返回Attachment元数据                              |
| POST /api/attachments/reference                 | `{workspaceId,path,startLine?,endLine?}`；冻结工作区相对路径文件或文本行范围，返回Attachment |
| GET /api/attachments/:attachmentId              | Attachment元数据，不返回原始图片                                                             |
| GET /api/attachments/:attachmentId/content      | AttachmentContent：`{attachment,text,imageData}`，图片base64只由此显式读取                   |
| GET /api/workspaces/:workspaceId/files?path=... | `{paths:string[]}`，path默认`.`；单目录最多500项，目录以`/`结尾                              |
| GET /api/workspaces/:workspaceId/rules          | 当前根AGENTS.md的RuleSource数组预览，不改变最近Run的冻结规则                                 |

Attachment包含id、name、mediaType、kind、byteLength、preview、sourcePath、workspaceId和createdAt；workspaceId为兼容字段，当前上传写null，引用写来源工作区ID。kind为text、image、pdf或reference，preview最多4000字符。AttachmentContent的text与imageData可为null，普通元数据、Session快照和SSE不携带图片base64。只有获得本机授权的调用方可以访问内容接口。

单次上传HTTP body上限12MiB，文本上限256000字节且必须为UTF-8；PNG/JPEG/GIF/WebP按签名与MIME核对，上限2MiB；PDF按签名核对，上限8MiB，提取最多20页、约100000字符，无OCR。PDF原始字节不持久保存，历史预览为已提取文本。解析在有内存与10秒时限的worker内执行；请求断连或服务关闭取消处理并等待资源回收。附件名不接受路径分隔符和控制字符。

引用复用M2真实路径、敏感目录和链接检查，拒绝越界、`.env*`、`.git`、profile以及非普通/多硬链接文件。行号从1开始并包含结束行，仅文本支持行范围；冻结后源文件修改或删除不改变附件正文。文件列表隐藏敏感项与链接，有界遍历不开放任意主机目录。

`POST /api/sessions/:id/inputs`新增可选attachmentIds，最多8个且同条输入不得重复。MessageView与QueueInput保留ID，正文进入私有用户消息codec；发送、排队、恢复和分支使用冻结内容。队列文字编辑保留原附件，用户消息编辑重发也继承原附件。缺少附件或新上传图片与模型能力不符时明确失败，不能静默丢弃图片。未发送草稿移除只影响草稿，不删除历史内容。

已冻结附件可以由用户显式复用到另一工作区；它不授权重新读取来源目录。只有attachment.workspaceId与会话当前工作区一致的文件引用参与该Run的下级AGENTS发现，跨工作区引用只提供冻结正文。

## 分支工作状态与命令

| 方法与路径                                                           | 输入与结果                                                                        |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| GET /api/sessions/:sessionId/work?branchId=...                       | 预期当前分支WorkSnapshot：`{state,checkpoints}`                                   |
| PATCH /api/sessions/:sessionId/work                                  | `{expectedBranchId,revision,mode?,plan?,todos?}`；返回提交后的WorkSnapshot        |
| POST /api/sessions/:sessionId/work/compact                           | `{expectedBranchId,revision}`；手动调用当前模型摘要，返回WorkSnapshot             |
| POST /api/sessions/:sessionId/work/checkpoints                       | `{expectedBranchId,label}`；保存消息前缀和工作状态，返回WorkSnapshot              |
| POST /api/sessions/:sessionId/work/checkpoints/:checkpointId/restore | `{expectedBranchId,revision}`；新建恢复分支，返回WorkSnapshot                     |
| POST /api/sessions/:sessionId/work/reset                             | `{expectedBranchId,revision}`；重置当前工作状态并清除未消费队列，返回WorkSnapshot |
| POST /api/sessions/:sessionId/questions/:questionId/answer           | `{answer}`；一次回答当前会话的待答问题，返回WorkSnapshot                          |
| POST /api/sessions/:sessionId/questions/:questionId/cancel           | `{}`；取消当前会话的待答问题，返回WorkSnapshot                                    |

`POST /api/sessions`可用workMode选择首个Run前的execute或plan模式，省略时为execute。选择plan时，session.created与初始revision:1的work.updated同事务提交，返回的Session快照游标为2；默认execute仍从revision:0、Session游标1开始。

WorkState按sessionId与branchId隔离，初始revision为0。GET必须携带预期当前branchId；工作状态修改、压缩、恢复、重置必须携带读取到的expectedBranchId和revision，检查点创建必须携带expectedBranchId。服务在执行命令时核对当前分支，再核对版本；分支已切换或版本过期均返回409 WORK_CONFLICT，即使两个分支的revision相同也不能将旧命令应用到新分支。成功修改追加递增版本。mode为execute或plan；状态还保存rules、usage、compaction、contextStartAfterMessageId、plan、todos及questions。除回答/取消当前等待问题外，工作状态修改、压缩、检查点与重置要求当前Run已停止。WorkSnapshot的checkpoints为该会话的历史检查点列表，每会话上限100个；没有独立的检查点比较写接口，客户端比较已读取的状态。

Plan包含title、content、draft/approved/completed状态和updatedAt；Todos最多100项，ID在同列表内唯一，status为pending/in_progress/completed。Plan模式允许读取与会话规划工具，禁止文件写入、编辑、Shell与Web POST；Web GET仍走原有审批。用户批准计划并切换execute只更新后续Run工作状态，不自动开始运行或代替逐次执行审批。模型重写计划保存为draft。

ask_user、update_plan和update_todos是无需工作区的会话工具，不取得文件权限。Question包含稳定id、runId、branchId、toolCallId、prompt、options、status、answer及createdAt；最多8个选项，也接受自由回答。只有所属会话内仍为pending且正在等待的问题可回答一次；重复、错会话或过期回答返回冲突。等待最多10分钟，停止Run取消等待；重启将遗留pending追加为interrupted，不自动恢复问答。

## 规则、预算与压缩

运行加载工作区根AGENTS.md及同工作区显式引用路径的祖先规则，按浅到深顺序使用；下级规则只作用于对应目录，不能扩大应用权限。每次最多16份，总量64KiB，UTF-8文本。RuleSource保存path、SHA-256、content及byteLength，冻结到本次Run；修改文件在下一Run加载。规则预览接口只读取当前根规则，与最近Run已生效内容区分。

ContextUsage公开estimatedTokens、windowTokens、reservedOutput、inputBudget和trimmedMessages。估算覆盖规则、消息、附件、工具结果及工具声明，预留模型输出；它不等于供应商tokenizer或账单。裁剪移除最旧完整用户轮次，保留最新轮次与工具调用/结果配对，原历史仍保存；最新输入、规则或当前工具结果本身超预算时明确拒绝。

手动压缩至少需要三轮可用对话，保留最近两轮；自动压缩在下一Run预估达到输入预算85%时尝试。摘要使用当前配置模型，记录覆盖到的throughMessageId、summary、createdAt及manual/automatic原因，后续请求使用摘要与未覆盖历史。生成失败或取消保留旧摘要和原历史；停止命令与请求中断可以取消压缩。模型请求可能产生正常供应商费用，测试替身不证明真实供应商可用。

## 检查点、重置与持久事实

Checkpoint保存id、sessionId、branchId、label、createdAt、messageIds及完整WorkState。恢复只接受本会话的检查点，通过新分支继承保存的有序消息前缀，恢复上下文起点、摘要、规则、Plan/Todos并清空旧待答问题；原分支与后续历史保留。下一Run仍按当时磁盘加载规则。恢复不自动执行队列；已有队列继续受原分支来源检查。

重置保留全部会话历史，以当前最后消息作为新上下文起点，清除摘要、规则、用量、计划、任务、问题和未消费队列，mode回到execute。恢复与重置均不撤销磁盘文件、Shell或外部请求，不能用检查点作为文件回滚。

work.updated持久事件保存完整revision状态，checkpoint.created保存检查点，branch.restored保存新分支及继承消息ID；投影与事实同事务提交后发布。context.prepared公开分支、用量、实际参与请求的消息与附件ID，完整system prompt及消息codec仅存私有列；摘要模型请求也记录私有请求内容。GET不改写历史，内容接口不把base64广播到SSE。
