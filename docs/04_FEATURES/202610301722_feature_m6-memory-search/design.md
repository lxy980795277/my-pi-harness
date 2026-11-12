# M6 模块、数据与请求设计

2026-11-11按产品0.19.1和基线`320b46b`实施。M6.1–M6.6已逐节完成开发与本机验证；实际证据与未验范围见[验证记录](verify.md)，完成门槛见[任务](tasks.md)。长期有效机制由[技术专题](../../09_TECHNICAL/长期记忆与搜索设计.md)拥有，公开字段与HTTP由[协议](../../03_API/memory-search.md)拥有，本文记录本轮范围、实现位置和已采纳的设计取舍。

## 基线缺口与处理

| 基线风险                                                   | 实际处理                                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 请求投影立即记录，随后才等模型名额，期间资料可能变化       | `runs/request.ts`区分草稿与最终提交，等待后复核，失效先释放再重备，已交出请求不重发      |
| 只有每Run工具目录临时向量，没有独立记忆事实与历史索引      | 新增memory领域包、storage独立事实及派生search，保持M4目录加载语义                        |
| 首次查询可能下载，Worker FIFO且活动取消缺少实际settled追踪 | 共享模型资源唯一拥有者、两个固定模型视图、显式prepare及本地专用普通加载、优先级/公平队列 |
| 当前查询可能沿用Run首问，任务/通信容易混同直接人类声明     | 按实际消费输入更新，独立保留任务/通信来源，含历史引用不作为自动学习来源                  |
| 普通分支选择是写操作，Task详情从首页加载且带操作按钮       | 新增只读精确来源窗口与around-message分页，历史阅读不用执行分支或TaskDialog               |
| 虚拟列表没有来源跳转入口                                   | 按稳定message/entry退出follow、展开过程、scrollToIndex及测高校准，定位前校验全文hash     |

## 实际模块

| 实现                                                                                                                                                      | 拥有职责                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [memory/service.ts](../../../packages/memory/src/service.ts)、[ports.ts](../../../packages/memory/src/ports.ts)                                           | 独立记忆规则、实际repository端口与revision/幂等用例                      |
| [memory/selection.ts](../../../packages/memory/src/selection.ts)、[mutations.ts](../../../packages/memory/src/mutations.ts)                               | 固定/相关选择与直接写入规范，不持有SQL/Worker                            |
| [memory/snapshot.ts](../../../packages/memory/src/snapshot.ts)                                                                                            | 纯JSON叶出口，复用最终prompt中的单一记忆块                               |
| [storage/memory](../../../packages/storage/src/memory/repository.ts)                                                                                      | 事实/设置/receipt/直接写入事务、来源验证与无正文遗忘账本                 |
| [storage/search](../../../packages/storage/src/search/repository.ts)、[source-window.ts](../../../packages/storage/src/search/source-window.ts)           | 派生来源、分块/FTS/向量、代际/水位、精确有界阅读                         |
| [daemon/memory](../../../apps/daemon/src/memory/service.ts)、[retrieval.ts](../../../apps/daemon/src/memory/retrieval.ts)                                 | 身份/范围解析、检索与本地相关性复核、路由装配                            |
| [daemon/search](../../../apps/daemon/src/search/service.ts)、[runtime.ts](../../../apps/daemon/src/search/runtime.ts)                                     | 人类用例与根Run窄权限、查询/索引生命周期                                 |
| [local-model-resource.ts](../../../apps/daemon/src/search/local-model-resource.ts)                                                                        | 单Worker、双模型独立状态、有限优先级队列及真实取消                       |
| [runs/request.ts](../../../packages/agent-runtime/src/runs/request.ts)                                                                                    | 模型名额、最后复核、最终提交和立即派发                                   |
| [runs/input-references.ts](../../../packages/agent-runtime/src/runs/input-references.ts)、[search.ts](../../../packages/agent-runtime/src/runs/search.ts) | 可见来源输入、队列复验及每Run精确读取资格                                |
| [34工具目录](../../../packages/tools/src/workspace-tool-registry.ts)                                                                                      | 七个M6操作各自单文件，注册策略和宿主窄handler，不在runtime定义工具schema |
| [Web memory](../../../apps/web/src/features/memory)、[Web search](../../../apps/web/src/features/search)                                                  | Query事实、已保存记忆管理/画像、搜索只读窗口、精确引用及展示状态         |

memory只依赖浏览器安全protocol与纯规则依赖。storage实现领域repository，daemon注入用例与本地模型；runtime通过窄端口取得当前资料，tools执行注册handler。没有integrations/search、第二消息体系、通用事件总线或空的记忆子package。文件拆分按现有职责，不以目录层数或文件数量为目标。

## 已确定的数据与权限

记忆及设置是同profile的独立SQLite事实，来源会话归档不删除已保存条目；JSONL继续拥有会话执行。直接写入由memory领域规则与storage事务执行，receipt绑定真实toolCallId，来源账本与遗忘抑制仅保留必要指纹；忘记清理各代际索引，旧来源不能复活事实，人类新手工保存不受旧指纹阻止。schema16清理原提案表，设置改为allowUse/allowLearning且默认均开启。

采用分为固定与相关。固定项不能因排名低被静默遗漏，相关项允许零命中；两者共用独立请求额度，不能恢复累计token或固定循环次数限制。实际采用正文只进入最终prompt的一块，采用说明及未采用原因不再保存第二份正文。最近每Run/Task的采用缓存由已提交prepared派生，完整Trace继续归M7。

根请求可用user及当前workspace；子任务默认只用获准workspace，父显式转交user记忆ID后再校验当前有效性，兄弟和父完整历史不共享。模型历史检索默认仅当前workspace的其他可见Root；人类引用是精确source/hash/target/选区，不扩大为整个其他workspace，也不自动授予子任务。

根Agent在当前正常工具循环使用save_memory/learn_memory/update_memory/delete_memory。明确保存/纠正不增加确认步骤，删除沿统一审批；自动学习需要使用和学习开关均开启，写入事务再次校验。宿主绑定当前实际消费的人类消息、hash与真实工具意图，模型不能自报owner或Run；子任务不提供写入入口。工具说明要求明确意图才保存/纠正，自动学习只提取稳定偏好、长期指令及事实，不把秘密、临时任务状态、引用、网页、thinking或通信视为用户声明。默认保存固定采用，自动学习的偏好/指令默认固定、事实默认相关，由领域层唯一确定。

不再保留pending提案、确认/拒绝API、单消息学习grant或TTL，也不在终态后单独调用模型抽取。设置页面管理已保存条目，聊天呈现普通折叠工具调用及实际结果。

## 检索与自动采用的区别

持久检索使用普通FTS5与独立的本地embedding候选，合法scope先于TopK与计数，RRF按来源去重，最后重验原文/hash/偏移。候选、扫描、tokenizer及覆盖限制显式标注，不随机截断语料。保持现有M4工具目录引擎，通过共享embedding资源整合本地推理，不把工具目录当历史数据库。

实测证明E5相似度与简单分差不足以同时满足正例覆盖和无关不采用，因此保留原small embedding，增加固定本地cross-encoder复核，不引入付费隐藏推理。删除旧余弦/强词法自动采用规则；人工搜索的相近候选不等于自动采用。模型、切块、阈值及正式70条分组质量基线见技术专题及verify，不另建评测平台。

普通查询与索引不下载权重；模型状态根据固定缓存可用性判断，已有缓存可本地懒加载。显式prepare才补齐文件。新代际追平后激活，source/hash/signature CAS阻止迟到向量恢复失效正文，重启复用有效向量。

## 只读定位与引用

`SearchSourceSelection`复用稳定来源、精确target及UTF-16半开范围，客户端不自报引用正文。人类来源窗口最多9条、锚点最多8000字符、邻居各最多2000，按messageId分页；长正文以textOffset由宿主按真实Unicode边界切片。模型精读不返回邻居，只接受本Run真实搜索命中或已消费引用所允许的范围。

当前时间线只在来源全文hash与最新活动分支匹配后按稳定entry定位，不能查询未挂载DOM或改全量渲染。其他会话/分支/归档/Task保持只读窗口，主对话/SSE/草稿不卸载。引用先加入输入草稿，显式发送后由宿主复验并保留可见原文；队列只保留精确引用元数据，不增加正文副本。

## 实施与收口

按M6.1固定闭环→M6.2持久检索与资源→M6.3相关回忆→M6.4直接保存/学习/画像→M6.5历史定位逐节完成并验证，M6.6汇总回归、真实本地检索质量、一万片段性能、隔离部署与macOS Electron。未实测的平台/外部账号继续明确记录，不能以代码存在或旧M5证据替代。

M7仍拥有完整请求Trace/费用、文件撤销、完整导入导出与正式发布；Computer Use、云同步、全盘文件RAG、知识图谱与统一评测平台不在本轮。用户要求提交时再走提交流程，本轮不自动清库、提交或推送。
