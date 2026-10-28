# 上下文与工作状态协议

共享协议版本见[API入口](overview.md)；DTO和schema由packages/protocol/src/sessions/context.ts及sessions.ts拥有。开发期不保留旧协议/日志/codec适配，全部消费者同步更新。接口复用[应用登录](application-auth.md)、Host/Origin与CSRF校验，未知字段拒绝。存储权威与恢复由[storage](../../packages/storage/README.md)说明。

## 附件与规则

| 方法与路径                                      | 输入与结果                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| POST /api/attachments                           | name、mediaType、标准base64 data；返回Attachment元数据           |
| POST /api/attachments/reference                 | workspaceId、相对path、可选startLine/endLine；冻结文件或文本片段 |
| GET /api/attachments/:attachmentId              | Attachment元数据                                                 |
| GET /api/attachments/:attachmentId/content      | AttachmentContent，显式读取提取文本或图片base64                  |
| GET /api/workspaces/:workspaceId/files?path=... | 单目录有界路径列表                                               |
| GET /api/workspaces/:workspaceId/rules          | 当前根AGENTS预览，不改旧Run冻结内容                              |

Attachment包含id、name、mediaType、kind、byteLength、preview、sourcePath、workspaceId和createdAt；kind为text/image/pdf/document/reference。普通快照和SSE不包含imageData。宿主不可变附件文件保存冻结内容与校验摘要，SQLite保存可重建索引，预览不重新读取原始工作区文件。

HTTP上传体上限12MiB；UTF-8文本最多256000字节，PNG/JPEG/GIF/WebP最多2MiB，PDF/文档最多8MiB。PDF提取最多20页、约100000字符；Office/开放文档提取最多约250000字符，均无OCR。支持DOCX/DOCM、XLSX/XLSM、PPTX/PPTM、ODT/ODS/ODP、RTF和EPUB；不执行宏。解析有独立worker、内存、解压与时间限制，请求断开及关闭取消并等待worker退出。限制在上传时验证，不常驻显示说明文案。

输入text可以为空，但必须有非空文字或1–8个不重复附件ID。发送、排队和编辑重发保持冻结附件，缺失内容或不支持图片的模型明确拒绝。图片可从剪贴板上传；前端不恢复已移除的工作区引用入口，MCP工具选择与授权见[本地MCP协议](local-mcp.md)，Skill选择、冻结与资源管理见[Skills与插件协议](skills-plugins.md)。

引用复用M2真实路径、敏感目录和链接检查；行号从1开始且含结束行。跨工作区显式复用冻结附件不授予原目录访问，仅同工作区引用参与祖先AGENTS发现。AGENTS最多16份、总量64KiB，按由浅到深冻结文本/hash，下一Run重载。

## 工作状态与命令

所有work命令前缀为/api/sessions/:sessionId。

| 方法与路径                                   | 行为                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| GET /work?branchId=...                       | 返回state、checkpoints手动会话快照、compactions摘要历史                          |
| PATCH /work                                  | expectedBranchId、revision、可选todos；不允许直接批准计划                        |
| POST /work/compact                           | expectedBranchId、revision；手动压缩                                             |
| POST /work/compactions/:compactionId/select  | expectedBranchId、revision；选择摘要版本，不创建分支                             |
| POST /work/checkpoints                       | expectedBranchId、label；保存手动会话快照                                        |
| POST /work/checkpoints/:checkpointId/restore | expectedBranchId、revision；恢复快照到新分支                                     |
| POST /work/reset-tasks                       | expectedBranchId、revision；仅清Plan/Todos                                       |
| POST /work/reset-context                     | expectedBranchId、revision；重新设置有效历史起点，清摘要/问题/队列，保留计划任务 |
| POST /work/plans/:planId/review              | expectedBranchId、revision、decision及feedback；原Run审核                        |
| POST /questions/:questionId/answer           | answers数组，一次提交该请求全部题目                                              |
| POST /questions/:questionId/cancel           | 空对象，取消所属请求等待                                                         |

WorkState按Session和Branch隔离，包含revision、rules、usage、当前compaction、contextStartAfterMessageId、plan、todos、questions。命令核对当前分支与revision，旧窗口不能写到新分支。普通编辑、压缩、快照及上下文重置要求空闲；回答和审核仅开放给所属活跃Run的待处理请求。

## 结构化提问

Question容器保存id、runId、branchId、toolCallId、questions、answers、status、createdAt。questions最多12题，每题有id/header/prompt、最多12个带id/label/description选项、multiSelect和allowCustomInput；题目与选项ID各自唯一，禁止没有选项且不允许输入的不可回答问题。

答案为questionId、optionIds和text；必须覆盖全部题目，不允许重复选项、未知ID、多选越权或未授权自由输入。有效答案提交后原Run继续；重复、错Session/分支或已结束请求拒绝。取消结束当前提问，停止/重启将未完成等待收敛，不自动继续模型调用。

## 计划与任务

Plan有稳定id、runId、title/content、结构化steps、status、review、feedback和updatedAt。步骤有id/title/status，最多一个in_progress。update_plan工具提交计划并等待审核；decision为approve、feedback或cancel。批准记录计划确认并继续原Run，反馈交回原模型修订，取消结束审核。不能通过PATCH plan.status绕过审核，也不能从批准计划推导具体工具已获授权。

Todo有id/title/status、planStepId、evidenceToolCallIds和completionNote。状态为pending/in_progress/completed/blocked/cancelled；引用步骤必须存在，新计划遗漏现有Todo引用的步骤时，在保存和创建审核等待前返回TODO_PLAN_STEP_INVALID，原工作状态与revision不变，需先更新或清理任务关联。工具证据必须是实际成功的相关工具记录。完成也可填写明确文本结论，人工确认通过completionNote记录，纯分析任务不要求虚构工具。

会话工具包括ask_user、update_plan、update_plan_steps、update_todos、search_session_history、restore_context_checkpoint和reset_working_state；均不授予工作区权限。历史搜索仅限当前会话、有限匹配和有界片段，不实现M6跨会话索引。

## 每请求上下文与摘要

每次模型请求前投影有效历史、处理附件和过长工具输出、估算预算、必要时压缩、检查完整工具调用/结果组及最终预算。ContextUsage记录estimatedTokens、windowTokens、reservedOutput、inputBudget、trimmedMessages、prunedMessages、source、providerInputTokens和categories。分类system/rules/tools/messages/attachments/summary/workingState为估算，真实Usage可用时仅辅助总量校准，不代表下一请求准确账单。

Compaction保存id、parentId、throughMessageId、summary、structured、strategy、beforeTokens、afterTokens、sourceMessages、runId、createdAt和reason。structured保存objective、constraints、decisions、completed、pending、blockers和nextAction。自动摘要支持同Run连续工具循环；失败可用本地fallback，取消不提交半成品。最终仍超预算明确拒绝，不发残缺工具组。

context.prepared公开模型请求关联、用量和附件ID，完整system/messages仅进入宿主日志私有记录。原历史不删除；压缩不是文件撤销。上下文检查点选择旧摘要并确定新的有效尾部，历史仍可检索；会话快照保存消息前缀及WorkState并恢复为新分支，两种恢复入口独立。

reset-tasks保留摘要与历史，仅清计划任务；reset-context保留可读历史和手动快照，保留Plan/Todos，但清规则、用量、摘要、问题及未消费队列。恢复不自动执行工具、Shell或外部请求。完整导入导出和文件撤销重做继续属于M7。
