# 执行轨迹与请求读取

公开DTO和输入schema由[trace.ts](../../packages/protocol/src/sessions/trace.ts)拥有，宿主请求事实位于[model-requests.ts](../../packages/protocol/src/internal/model-requests.ts)。接口沿用应用登录、来源与会话归属检查，Renderer只接收显式公开投影。

## 轨迹列表

GET /api/sessions/:id/trace返回items、nextCursor与watermark。列表按首次出现的持久seq升序，cursor表示已读取的位置，缺省0；limit缺省50，范围1至200。第一次读取冻结已提交watermark，后续分页携带该值。新终态在旧watermark之外时，旧分页链仍读取当时的状态。

支持branchId、runId、taskId、includeDescendants、kind、purpose和status。kind为request、tool、approval或compaction，purpose为conversation、approval或compaction。HTTP数值采用十进制字符串，includeDescendants使用true或false字符串，经校验后显式转换；未知字段、非法页长及偏移拒绝。筛选先于分页，树范围由持久关系解析。

列表项只有稳定ID、seq、归属、时间、状态、摘要、工具/请求定位及有界错误，不携带完整参数、工具结果或模型输入。nextCursor是不透明排序位置，同一seq下的工具及审批条目各自可达，客户端不能自行加减seq生成cursor。旧记录缺少请求观测信息时保持未知，不把准备快照视为已经联网。

## 请求及工具详情

| 路径                                            | 内容                               |
| ----------------------------------------------- | ---------------------------------- |
| GET /api/sessions/:id/trace/requests/:requestId | summary及最终模型输入的所选section |
| GET /api/sessions/:id/trace/entries/:entryId    | 通用工具、审批或压缩记录的有界内容 |

详情query支持section、cursor、offset和limit。section为system、messages或tools，通用条目按其内容处理。cursor是条目索引，offset是该项的UTF-16字符偏移，limit范围1至50。响应items中的每项有index、offset、role、text、images与truncated；nextCursor和nextOffset共同标记下一段。单项被截断后继续读取同一index的剩余正文，不能丢弃后缀。图片仅返回数量及元信息，base64不会跟随列表或文本详情返回。

宿主从已有最终输入、工具正文和私有codec解引用内容，通过日志定位读取器有界加载。公开详情不会序列化认证header、凭据槽位或整个Pi对象。system、工具声明及历史采用内容反映当次提交，不用当前配置或记忆回填。

图片通过GET /api/sessions/:id/trace/requests/:requestId/images/:itemIndex/:imageIndex按需读取，itemIndex对应messages条目，imageIndex对应该条中的图片顺序。宿主核对请求归属、图片类型与大小，返回精确二进制和媒体类型，使用no-store及nosniff；图片URL不携带凭据。无对应图片返回404，不接受正文中的任意外部地址。

## 请求语义

modelRequestId表示一次实际stream调用，区别于输入幂等requestId。请求绑定当时已消费输入，子任务及辅助请求保留发起来源。派发前因为记忆或工作状态变化而重投影，不增加实际调用计数。

purpose区分对话、审批复核和压缩，主子任务由现有Run关系连接。开始、首个可观察响应及终态时间属于宿主观测；已交给stream不证明供应商已收到HTTP。成功、失败、取消和重启中断分别展示，缺首响应或Usage保持null。

流式片段仍由内存覆盖层持有，终态结果沿正常持久路径提交。读取轨迹不改变执行分支，不启动模型或工具。注销、关闭详情和切换目标清除对应客户端缓存与迟到响应。

## 用量与耗时

GET /api/sessions/:id/usage读取唯一模型请求集合的统计，支持branchId、runId、taskId、inputMessageId及includeDescendants。回答查询使用真实根输入ID，子请求的实际输入与根回答锚点分别记录；共享分支前缀不随当前选择分支重新归属。

响应包含requestCount、recordedRequests、unknownRequests及tokens，按purpose拆分。缓存Token保留供应商口径，不能重复加进total。modelDurationMs、排队、工具和人工等待为分别标明完整度的累计量；wallDurationMs按wallTimeBasis说明活动区间并集、回答区间、请求跨度或未知。未终止及不可确定区间保持未知，Session活动区间不会把轮次间的人类闲置计入总执行时间。

定价规则在请求时冻结于宿主私有事实，实际Usage结算后由Pi按当时规则计算USD估算。公开costEstimate包含目录来源、版本、币种及费用分项；custom占位零价及未上报Usage不生成估算。聚合保留已知部分与费用完整度，不能把未知费用计成免费。

externalServices记录可观察的外部工具执行次数，费用未提供时明确不可用。最多返回200个服务身份，超出数量和调用数另行汇总；一次工具执行不等于一次供应商计费HTTP请求。
