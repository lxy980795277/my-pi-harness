# 子 Agent 与任务看板协议

共享DTO及schema由packages/protocol/src/sessions/agents.ts拥有，协议版本见[入口](overview.md)。本页记录M5实现中的接口，整体验收状态以[功能Spec](../04_FEATURES/202610281702_feature_m5-subagents-board/spec.md)及其实际验证为准。接口与普通会话共用应用登录、Host/Origin及CSRF校验；未知字段拒绝。

## 查询与配置

| 方法与路径                                  | 输入与结果                                                      |
| ------------------------------------------- | --------------------------------------------------------------- |
| GET /api/agents                             | 可选workspaceId、filter、cursor、limit；返回tasks及nextCursor   |
| GET /api/agent-settings                     | 返回revision、enabled、roles和limits                            |
| PUT /api/agent-settings                     | 提交完整设置及编辑时revision；冲突拒绝，成功返回新revision      |
| GET /api/sessions/:sessionId/agents         | 返回当前分支可见的任务摘要及snapshotSeq                         |
| GET /api/sessions/:sessionId/agents/:taskId | 可选cursor、limit；返回任务、分页消息、Run、工具和独立WorkState |

HTTP分页参数是严格十进制数字字符串，cursor非负，limit为1–200；路由校验后显式转换为应用层整数，不依赖Fastify隐式转换。filter为all、active、pending或ended，服务端在分页前筛选；pending只包含真实待回答或待审批的任务。

Task创建只保存sourceToolCallId引用，父Run及分支消息锚点从既有工具记录推导；子Run通过taskId关联。公开摘要中的parentTaskId、rootRunId、latestRunId、等待原因、Usage与终态是可重建投影，不在日志中重复存成另一套事实。主会话快照不包含子消息及子工具，任务详情按需读取。

任务详情同时返回snapshotSeq和liveRevision，按[会话双水位](model-session.md#事件快照与断线)判断新旧；消息合并当前Task的内存partial，持久序号不随chunk增长。任务列表与看板只有持久摘要，不增加实时修订字段。

详情在SQL中按消息ordinal取limit加一条判断后页，仅加载本页正文；工具包含本页锚点及该Task仍待人工批准/AI复核的项目。用量仅聚合目标子树的消息计量，不读取兄弟任务正文。完整任务快照仍供运行层读取模型历史，详情接口不传重复的全部通信队列。

角色可选择已配置模型及推理强度，或继承父执行；允许的权限上限为read-only或write。配置变更作用于新接受任务，不热换已有上下文或授权；角色不能扩大父工作区、工具及MCP/Skill权限。limits仅限制任务数、深度、并发模型请求、轮数、时限及单请求输出，不含累计token预算字段。实际Usage继续统计；持久旧字段在读取时沿现有投影忽略，原记录不改写，新设置或spawn传入tokenBudget视为未知字段拒绝。

子Run的工具审批方式继承父Run冻结的approvalMode，与角色access独立：完全访问下只读角色的正常网页GET自动批准，人工批准和AI复核模式仍使用对应流程；只读角色的POST、文件写、Shell及未获只读授权的外部调用仍拒绝。嵌套和续作不得扩大能力，明确要求人工确认的独立授权继续等待用户。限制的执行及持久归属见[子Agent设计](../09_TECHNICAL/子Agent与任务看板设计.md#角色能力与写入)，不新增公共权限字段。

## 任务命令

以下路径均位于/api/sessions/:sessionId/agents/:taskId。

| 方法与后缀                         | 输入与结果                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------- |
| POST /stop                         | expectedRunId可为空；验证观察到的执行后停止此任务及后代，实际结算后返回详情 |
| POST /messages                     | requestId、text、continue和expectedRunId；返回持久接受后的详情              |
| GET /work                          | 返回任务自己的WorkSnapshot，不提供根检查点操作                              |
| POST /questions/:questionId/answer | answers；继续原Task/Run的问题等待                                           |
| POST /questions/:questionId/cancel | 空对象；取消原问题等待                                                      |
| POST /plans/:planId/review         | expectedBranchId、revision、decision、feedback；审核原任务计划              |

普通工具批准继续使用原会话工具决策接口，以准确toolCallId定位等待。任务问题和计划不复制成主Run的交互；来源、Run和当前等待不匹配时拒绝。关闭详情不停止执行，停止返回前不能只在客户端标记已结束。

通信先持久化再在目标安全输入边界消费。continue明确要求空闲任务续作，创建新的Run并使用原Task上下文；发送普通消息不隐式创建收费调用。续作要求直接父Run仍接受命令且根执行有效。收束、失败或中断的旧Run不复活，未消费通信保存未送达事实。

## 共享摘要事件

GET /api/agents/events建立唯一类型agents.changed的私有SSE，data为`{"kind":"ready"}`或`{"kind":"changed"}`。它只通知查询失效，不携带任务正文、凭据、模型快照或独立任务状态副本；客户端收到ready后重读当前查询，重连不依赖丢失的通知顺序。

daemon只通知任务结构与状态变化，忽略逐token的message.delta，按100ms合并通知；Web工作台建立一个摘要订阅并合并刷新活动查询。角色设置只在保存、重开或重连时读取。唯一选中的活跃任务详情以500ms Query刷新补充流式文字，关闭详情或切换任务即停止原查询；未打开任务不读取完整转录，也不为每个子任务分别轮询。心跳每15秒检查授权；授权撤销、关闭或慢消费者释放订阅与计时器，不积压无界变化。此通知流不代替单Session日志及其有序seq。

## 界面事实与恢复

看板按真实待开始、进行中、待处理和已结束状态组织；等待模型名额、等待后代、等待回答和等待批准分别显示，终态保留成功、失败、停止及中断。没有明确分母不显示推测进度百分比。

Query拥有任务及待处理事实，Zustand保存任务选择、筛选、通信草稿和未确认发送意图。任务摘要按snapshotSeq留新，详情按(snapshotSeq,liveRevision)留新，HTTP旧快照不能覆盖新partial；主聊天的轻量工具行、任务树与看板引用相同Task。人工确认表单位于详情转录折叠之外，关闭详情后会话入口仍显示待确认任务数。

重启由同Session JSONL恢复任务关系及已完成结果，将未结算执行和失去父拥有者的任务收敛为中断，不自动调用模型、消费通信或重放外部副作用。完整主子Trace、费用估算、文件撤销和完整导入导出仍属于M7。
