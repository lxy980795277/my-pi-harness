# 长期记忆与历史搜索协议

公开schema由`packages/protocol/src/memory`及`search/search.ts`拥有；宿主记忆快照、检索访问范围和输入队列授权由`protocol/internal`拥有，不向Renderer暴露。全部接口沿用应用身份、同源和CSRF校验，owner来自当前profile，客户端不能指定owner或扩大模型工具的作用域。

## 记忆事实

| 方法与路径                                       | 输入与结果                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `GET /api/memories`                              | 可选scope、mode、enabled、category、cursor、limit，返回items/nextCursor/total；limit默认20、最大100 |
| `POST /api/memories`                             | requestId、scope、category、body、mode、enabled和来源，返回entry/receipt                            |
| `PATCH /api/memories/:id`                        | requestId、expectedRevision及新正文/类别/启用方式，返回entry/receipt                                |
| `DELETE /api/memories/:id`                       | requestId、expectedRevision，返回entry:null和遗忘receipt                                            |
| `POST /api/memories/statuses`                    | 精确ids，返回当前revision/enabled/mode，已遗忘条目revision为null                                    |
| `GET /api/memory-settings`                       | allowUse、allowLearning、revision                                                                   |
| `PUT /api/memory-settings`                       | requestId、expectedRevision、两个开关，返回新设置                                                   |
| `GET /api/sessions/:id/runs/:runId/memory-usage` | 最近实际提交的请求所采用的条目、当时正文及选择诊断；子Run遵守任务可见性                             |

scope是`{kind:'user'}`或`{kind:'workspace',workspaceId}`。category是preference/fact/instruction，mode是fixed/relevant，正文最多16000字符。新建省略mode采用fixed，更新省略mode保留原值。allowUse和allowLearning默认均为true，自动学习要求两者同时开启；关闭学习不阻止用户明确要求的保存和纠正。列表筛选在SQL分页和计数前应用，不以已加载一页推断全部记忆或遗忘状态。

手工来源为manual；消息来源为精确sessionId/branchId/messageId/contentHash，hash是持久MessageView.text的UTF-8 SHA256。宿主验证来源，不接收客户端声称的用户认可。已保存的事实独立于来源会话，归档原会话不删除记忆，也不阻止人工编辑或遗忘。

revision冲突拒绝覆盖。requestId绑定一次实际写入结果；重试返回同一receipt，条目后来被遗忘时entry为null，不以旧receipt重新创建正文。receipt和遗忘抑制只保留必要标识、修订及指纹，不保存被遗忘正文。

## 对话写入与自动学习

记忆工具在具备宿主端口的根Run默认提供，参数不包含owner、Run、来源消息或工具调用ID。宿主绑定实际已消费的人类消息及真实toolCallId，直接执行原事实事务；子任务不取得写入工具。

| 工具            | 模型参数                                             | 写入策略                                                                  |
| --------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `save_memory`   | scope为user/workspace、category、body、可选mode      | 用户明确要求记住时直接保存，mode默认fixed                                 |
| `learn_memory`  | 同save_memory                                        | 稳定偏好/指令默认fixed，事实默认relevant；事务复核allowUse且allowLearning |
| `update_memory` | memoryId、expectedRevision、category、body、可选mode | 用户明确要求纠正时直接修改，省略mode保留现值                              |
| `delete_memory` | memoryId、expectedRevision                           | 使用普通工具审批，full-access可直接执行                                   |

save/learn/update声明为真实修改操作，但不额外请求工具审批；只读能力上限仍禁止修改。记忆查询search_memories也默认提供并服从allowUse，子任务仍受精确用户记忆转交限制。各工具返回entry/receipt，失败不得解释为已经记住。相同真实调用重试只返回原receipt；来源被遗忘后不能借另一个旧调用恢复正文。精确相同scope/category/body只有在原条目启用且mode一致时才复用；停用或mode不同返回冲突，不隐式更改人工设置。

明确要求的语义由模型和工具说明判断，不以关键词正则或一次性授权代替。宿主复核来源必须属于当前根Run实际消费的直接人类输入，并早于当前工具意图；低信任历史引文不能成为learn_memory来源。更新/删除只能作用于当前可管理范围，expectedRevision冲突拒绝覆盖，设置变化、取消和失效来源不能绕过执行时检查。

没有memory-proposals接口、待确认候选或InputRequest.memoryLearning字段。自动学习来自当前正常工具循环，不在回答结束后另开收费提取请求。设置页面管理已保存事实，聊天采用普通工具行显示实际执行结果。

## 搜索与本地资源

| 方法与路径                                     | 行为                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `POST /api/search`                             | query、可选scope及limit，返回hits、mode、truncated、generation、watermark |
| `POST /api/search/source`                      | 精确selection、可选before/after/cursor/textOffset，返回只读来源窗口       |
| `GET /api/search/model`                        | embedding模型状态，不下载                                                 |
| `POST /api/search/model/prepare`、`/cancel`    | 空对象；显式准备或取消                                                    |
| `GET /api/search/reranker`                     | 相关性复核模型状态，不下载                                                |
| `POST /api/search/reranker/prepare`、`/cancel` | 空对象；独立准备或取消                                                    |
| `GET /api/search/index`                        | 索引就绪、代际、来源/分块/向量及积压数量                                  |
| `POST /api/search/index/rebuild`               | 空对象；请求重建派生索引，不改变记忆和会话事实                            |

query最多500字符，limit默认20、最大50。scope可指定workspaceId、sessionId、branchId、taskId、kind、memoryMode、createdFrom/createdTo，以及显式allWorkspaces/includeArchived/includeHistoricalBranches/includeTasks/includeUserMemories。时间为闭区间毫秒时间戳，开始不能晚于结束。allWorkspaces与workspaceId不能同时指定。省略workspaceId的人工请求限定未分配工作区，不暗中全局搜索；Web应传当前导航的workspaceId。

默认只检索可见活动分支的根正文。具体workspace默认不混入user通用记忆；需要时显式includeUserMemories。历史分支、归档和任务必须显式展开。scope过滤先于两个候选引擎的TopK、计数和排序；同文不同source不会因文本相同而混淆。

hit包含稳定source.id/kind/contentHash、精确session/branch/task/message或memory目标，以及原文UTF-16半开start/end和纯文本text。共享sameSearchSource只比较来源修订与精确成员，不比较选区，也不授予权限；运行时和宿主继续分别复核范围与事实。没有FTS生成HTML，客户端不能用相似文本代替原定位。mode为lexical或hybrid；truncated表示索引积压、候选/扫描限额、缺失语义覆盖等不完整状态，不能显示为完整全库结果。

模型状态为unprepared/preparing/ready/unavailable，资源准备是显式命令，普通GET、查询及索引不会下载。embedding和相关性复核分别准备，共用一个宿主拥有的Worker和有限优先级队列。活动取消不代表原计算已settled，服务退出等待实际工作结束；observer断开不等于用户取消准备。

## 精确阅读与引用

`SearchSourceSelection={source,target,start,end}`复用来源hash；target为message(sessionId/branchId/messageId/taskId?)或memory(memoryId)。只读窗口的items最多9项，锚点围绕所选范围最多8000字符，邻居各最多2000；前后页使用精确messageId游标，不扫描从0开始的转录。同一长正文翻页以textOffset交给宿主按实际Unicode边界切片，不由客户端猜测未读取字符的边界；textOffset与消息cursor互斥。窗口标注title/workspaceId/archived/historicalBranch，读取不写branch.selected，也不停止活动Run。无权限、hash/成员变化或非法实际选区统一返回来源不可用。

人类引用通过`InputRequest.searchQuotes`传最多4个selection。宿主在输入接受、队列消费和请求交接前复核实际正文及成员；每项最多8000字符，总选区最多32000，合并后仍遵守输入64000字符限制，超限拒绝而不截断。所选原文作为可见低信任资料进入实际user消息及原日志，客户端不能自报quote正文。

根Run按需工具`search_sessions`默认仅能搜索当前workspace的其他可见根会话；模型参数不含workspace、归档、历史分支或任务扩展。`read_search_source`只接收sourceId/start/end，由宿主匹配本Run真实搜索命中或实际消费引用。搜索命中精读仍复核默认范围；跨范围人类引用只授权所选范围的子区间，不授权邻居或整个工作区。子任务不自动继承这些跨会话读取权限。

实现分工与持久事实见[长期记忆与搜索设计](../09_TECHNICAL/长期记忆与搜索设计.md)，实际验证范围见[M6验证记录](../04_FEATURES/202610301722_feature_m6-memory-search/verify.md)。
