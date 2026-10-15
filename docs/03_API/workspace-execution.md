# 工作区与工具协议

wire协议5；Session事件信封仍为1，存储迁移追加0004为旧工作区补默认图标，旧事件和已发布迁移不重写。所有接口复用本机授权、Host/Origin和写请求CSRF校验，公开DTO由protocol/workspaces.ts、tools.ts与sessions.ts拥有。

## 工作区与会话

| 路径                       | 输入与结果                                                                   |
| -------------------------- | ---------------------------------------------------------------------------- |
| GET /api/workspaces        | Workspace[]，仅未归档注册目录                                                |
| POST /api/workspaces       | {rootPath,name?,icon?} → Workspace；已有绝对目录真实路径注册，不创建磁盘目录 |
| PUT /api/workspaces/:id    | {name,icon?,expectedRevision} → Workspace；revision冲突拒绝                  |
| DELETE /api/workspaces/:id | 有未归档会话时409；否则隐藏记录，绝不删除文件                                |

Workspace包含id、name、icon、rootPath、revision、createdAt、updatedAt。icon只允许protocol的WORKSPACE_ICONS集合；创建省略时使用folder，更新省略时保留原值，未知值返回400。旧库迁移为包含归档记录的工作区补folder，不改ID、revision或会话关联。创建和执行重验目录，根目录、Home及应用profile重叠目录拒绝。SessionSummary包含workspaceId:string|null和approvalMode:ask/read-only；创建允许省略并解析为null/ask。工作区一经创建固定，patch不提供迁移目录字段；旧会话null只支持普通聊天，不自动取得cwd权限。模型与审批设置只影响后续Run，活动Run使用已接受值。

## 工具与审批

SessionSnapshot.tools给出所选分支的ToolCallView[]，每项包含afterMessageId，指向所属assistant消息；按消息锚点和原tool.requested事件seq排列，界面将其插在所属消息后，不按毫秒时间或哈希ID猜先后。工具请求使用tool.requested，后续状态为tool.updated，data={tool}；这些历史事件保留ToolCallRecord原字段：独立id、sessionId、runId、branchId、name、arguments、summary、status、result、diff和创建/更新时间。afterMessageId在快照读取时从既有投影列补充，不改写旧事件或工具JSON。状态为awaiting_approval、running、completed、failed、denied、cancelled或interrupted。二进制图片和私有codec不进公开投影。

`POST /api/sessions/:id/tools/:toolId/decision`输入{decision:allow|deny}，成功返回{ok:true}，工具状态由后续快照或SSE读取。决定只作用于该session所属、仍在等待的这次调用；重复、过期、跨session决定拒绝。批准与执行成功是两件事；参数、预像、目录和OS策略在实际执行时继续检查。禁止客户端提交任意工具以绕过Pi调用与审批。

ask模式允许工作区内非敏感读取、目录和搜索；写入、编辑、Shell及所有Web请求逐次审批。read-only拒绝写入/编辑/Shell和Web POST，但仍可审批GET。审批等待有界，停止Run/退出会取消等待与执行。文件编辑要求SHA-256预像，创建使用expectedHash:null；调用参数提供修改内容，执行后显示Diff，当前不提供执行前Diff预览。

## 上下文与恢复

Run接受时私有冻结模型、工作区、策略、system prompt与工具声明。assistant toolCall通过消息私有codec保存，toolResult以tool.context保存，公开data只有branchId/afterMessageId/toolCallId。公开工具ID包含assistant消息锚点，不要求网关的SDK调用ID在整个Run内唯一；私有SDK调用/结果仍用原ID配对，已有记录的ID不重算。结果按assistant锚点插入重放上下文，分支只继承其消息前缀；HTTP/SSE不返回这些私有列。

context codec新写version2、仍读version1；未完成工具周期不作为完整上下文重放，不伪造工具成功。重启将遗留工具标interrupted并终结遗留Run，不自动批准或重发副作用。文件工具路径竞态、Shell进程组以及PDF worker的实际隔离范围见[execution说明](../../packages/execution/README.md)，不能将Renderer sandbox当宿主执行沙箱。
