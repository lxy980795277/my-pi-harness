# 工作区与工具协议

共享协议版本见[API入口](overview.md)；Session公开事件信封为1，宿主JSONL批格式与fresh SQLite schema分别管理版本。当前开发阶段不保留旧格式兼容。所有接口复用[应用登录](application-auth.md)、Host/Origin和写请求CSRF校验，公开DTO由`protocol/application/workspaces.ts`、`tools/tools.ts`与`sessions/sessions.ts`拥有。

## 工作区与会话

| 路径                       | 输入与结果                                                                   |
| -------------------------- | ---------------------------------------------------------------------------- |
| GET /api/workspaces        | Workspace[]，仅未归档注册目录                                                |
| POST /api/workspaces       | {rootPath,name?,icon?} → Workspace；已有绝对目录真实路径注册，不创建磁盘目录 |
| PUT /api/workspaces/:id    | {name,icon?,expectedRevision} → Workspace；revision冲突拒绝                  |
| DELETE /api/workspaces/:id | 有未归档会话时409；否则隐藏记录，绝不删除文件                                |

Workspace包含id、name、icon、rootPath、revision、createdAt、updatedAt。icon只允许protocol的WORKSPACE_ICONS集合；创建省略时使用folder，更新省略时保留原值，未知值返回400。创建和执行重验目录，根目录、Home及应用profile重叠目录拒绝。SessionSummary包含workspaceId:string|null和approvalMode:ask/auto/full-access/read-only；创建允许省略并解析为null/ask。菜单只提供前三项，历史read-only仍按原限制执行，打开菜单不会提升权限。工作区一经创建固定，patch不提供迁移目录字段；工作区为null的会话不注册本地文件/Shell工具，不自动取得cwd权限；M3的会话提问和规划工具仍可用。模型与审批设置只影响后续Run，活动Run使用已接受值。

## 工具与审批

SessionSnapshot.tools给出所选分支的ToolCallView[]，每项包含afterMessageId，指向所属assistant消息；按消息锚点和原tool.requested事件seq排列，界面将其插在所属消息后，不按毫秒时间或哈希ID猜先后。工具请求使用tool.requested，后续状态为tool.updated，data={tool}；记录独立id、sessionId、runId、branchId、name、arguments、binding、dispatch、summary、status、result、diff和创建/更新时间；成功发布时另有artifacts:Artifact[]，新记录可包含approval:{source:user|ai|full-access,decision:allow|deny|ask,reason:string|null}。afterMessageId从assistant锚点投影读取；宿主为缺失调用恢复时可在tool.requested的data明确记录该锚点。状态为reviewing、awaiting_approval、running、completed、failed、denied、cancelled、interrupted或unknown。二进制图片和私有codec不进公开投影。

`POST /api/sessions/:id/tools/:toolId/decision`输入{decision:allow|deny}，成功返回{ok:true}，工具状态由后续快照或SSE读取。决定只作用于该session所属、仍在等待的这次调用；重复、过期、跨session决定拒绝。批准与执行成功是两件事；参数、预像、目录和OS策略在实际执行时继续检查。禁止客户端提交任意工具以绕过Pi调用与审批。

ask模式允许工作区内非敏感读取、目录和搜索；写入、编辑、Shell及所有Web请求逐次审批。auto将这些待批调用交给独立、无工具的模型请求，使用当前Run模型与用户请求、冻结规则等复核资料；明确allow执行、deny拒绝、ask/无效结果/模型失败或超时转人工。复核不修改主Agent对话；停止取消请求并等待其结算，模型lease在请求结束后释放。tool.review.requested公开记录toolId/providerId/modelId，tool.review.completed增加decision/reason；完整请求仅进入privateData，不进入公开HTTP/SSE，完整材料保存在JSONL的宿主privateData。reviewing尚不能由人工decision接口批准，只有转为awaiting_approval才接受决定。

full-access自动批准工具，普通角色在macOS直接执行无OS沙箱的命令；明确选择后仅影响后续Run，不是隔离失败的自动回退。Shell使用宿主用户权限而不提权，文件工具仍限制在工作区。角色只读及内部read-only拒绝工作区写入/编辑和Web POST，命令只能使用OS禁止工作区写入的执行范围；允许的外部GET仍按策略批准。本地MCP另需按相同隔离范围确认启动授权，接口与unknown处理见[本地MCP协议](local-mcp.md)。Skill提供冻结指令和资源，不能绕过审批；动态加载与有限授权见[运行时能力协议](capability-runtime.md)。

审批等待有界，停止Run/退出会取消等待与执行。ask/auto的macOS命令保持无网络OS沙箱，角色只读进一步禁止工作区写入；full-access保留进程组取消、超时、环境白名单和输出上限；脱离所属进程组的恶意后代不在现有回收保证内。当前受管理本地命令仅支持macOS，Windows/Linux明确拒绝。文件编辑要求SHA-256预像，创建使用expectedHash:null；调用参数提供修改内容，执行后显示Diff，当前不提供执行前Diff预览。

## 命令与文件交付

模型使用run_command启动命令，wait_command按commandId与游标等待输出，stop_command停止所属命令；没有任意命令HTTP执行接口。命令的等待时间与总生存期分别管理，run_command返回running表示仍在执行。成功根Run结束后命令可由同会话后续Run查询或停止；子任务结束、显式取消、会话归档或关闭、撤权和daemon退出收束所属命令。参数、状态及限额见[运行时能力协议](capability-runtime.md#受管理命令)。

模型通过read_document获取有界正文，view_image与view_pdf_page返回实际图像；视觉入口仅提供给支持图片的模型。文件生成由办公Skill及通用命令组织，publish_artifact显式注册稳定文件字节。`GET /api/sessions/:id/artifacts/:artifactId`沿用应用登录验证，核对当前分支可见的根工具或Task委派事实后下载不可变blob；源文件后续修改或删除不改变已注册字节。字段、同批提交及可选生产命令证明见[产物协议](capability-runtime.md#通用产物)。

## 上下文与恢复

Run接受时私有冻结模型、工作区、策略、system prompt与工具声明。assistant toolCall通过消息私有codec保存，工具终态及中立私有结果在同批提交，结果以tool.context保存，公开data只有branchId/afterMessageId/toolCallId。公开工具ID包含assistant消息锚点，不要求网关的SDK调用ID在整个Run内唯一；私有SDK调用/结果仍用原ID配对，已有记录的ID不重算。结果按assistant锚点插入重放上下文，分支只继承其消息前缀；HTTP/SSE不返回这些私有列。

模型codec与中立工具结果格式由各自schema校验，不提供旧开发格式兼容。恢复为未派发调用配对宿主interrupted结果，为有屏障但无可靠结果的MCP调用配对unknown说明；即使assistant一次声明多个调用、后续调用尚未进入执行器，也逐项补齐而不删除整个周期或伪造成功。已有终态不改写，不自动批准或重发副作用。文件工具路径竞态、Shell进程组以及PDF worker的实际隔离范围见[sandbox说明](../../packages/sandbox/README.md)和[tools说明](../../packages/tools/README.md)，不能将Renderer sandbox当宿主执行沙箱。

M3的计划与任务、会话工具、冻结规则、预算与检查点行为见[上下文与工作状态协议](context-interaction.md)，批准计划不替代本页的工具审批。
