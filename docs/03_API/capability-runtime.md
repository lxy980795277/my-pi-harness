# 运行时能力协议

共享协议版本见[API入口](overview.md)。用户输入的skills仍为`{id,contentHash}[]`，最多16项，贯通picker、发送、历史编辑和队列更新；空选择明确为空数组。模型工具load_skill由宿主解析内容绑定，不改变用户显式选择协议。MCP显式选择最多16项、按需候选最多512项，不向Renderer暴露宿主授权或凭据。

## 目录、默认声明与接受事实

工具包的ToolRegistration统一模型schema、来源、默认/按需加载、可用条件、参数效果策略及执行绑定。runtime的tools/selection根据实际领域端口、工作区、平台、模型视觉能力和角色生成初始集合与候选。注册函数留在内存，日志只保存实际模型可见定义、来源、稳定指纹及授权版本；主子Run分别绑定自己的会话、任务和执行范围。

| 领域        | 模型入口                                                                                                      | 初始加载                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 工作区文件  | read_file、list_files、search_files、write_file、edit_file                                                    | 默认                                                       |
| 命令        | run_command、wait_command、stop_command                                                                       | macOS且有工作区时默认                                      |
| Web         | web_search、web_fetch                                                                                         | 默认，服务网关访问不要求工作区                             |
| 工作状态    | ask_user；update_plan、update_plan_steps、update_todos、search_session_history、read_tool_result              | ask_user默认，其余按需或由已有状态提供                     |
| 记忆与历史  | search_memories、save_memory、learn_memory、update_memory、delete_memory、search_sessions、read_search_source | 五个记忆工具默认；历史搜索/精读按需，按Run范围收窄         |
| 子任务      | spawn_agent、wait_agents；get_agent_status、send_agent_message、stop_agent                                    | 可委派时spawn_agent默认，wait_agents默认，其余按需         |
| 目录与Skill | tool_search、load_skill、read_skill_resource                                                                  | tool_search默认，有Skill目录时load_skill默认，资源读取按需 |
| 正文与视觉  | read_document、view_image、view_pdf_page                                                                      | 按需，视觉入口要求模型支持图片                             |
| 交付        | publish_artifact                                                                                              | 按需                                                       |

以上当前原生入口共35项。实际声明随可用端口和角色收窄，动态能力只从本Run获准候选选择，不构成跨平台固定数量。办公流程由四个插件Skill及其资源CLI提供，通用读取、命令和交付入口分别拥有自己的模型schema。

run.accepted私有记录保存初始tools/toolSources、MCP绑定/候选和诊断、nativeCandidates、skillCandidates及显式或继承的Skill正文。原生候选记录definition/source/fingerprint，准确区分session与workspace；SkillCandidate只保存selection、authorization、name、description、scope和source，不含正文、资源或活动租约。供应商schema、预算与执行使用同一可见集合，来源和加载策略不混入供应商schema。

队列保存显式MCP/Skill绑定、Skill候选目录、发现诊断及原requestId；原生候选在Run接受时记录。原授权不能因重新信任或同内容插件重装而复活，不从systemPrompt文本反查结构化绑定。

## 搜索与请求前激活

`tool_search({query,limit?})`搜索本Run获准的原生和MCP候选，以服务/原名、描述及参数执行词法检索，并可融合本地多语言向量；完整名字优先，MCP关闭或失败不阻断内置发现。默认最多返回8项，单次最多10项；每项标记already-available或next-model-request。新增命中自动暂存，重复命中不重复加载，全部可调用工具含原生入口最多64项。语义失败或18秒截止保留词法，Run取消继续传播；零命中不能解释成OAuth状态。

宿主已确认的依赖走同一激活路径：当前Plan/Todos提供相应更新入口，已激活Skill附加资源索引非空时提供reader，裁剪提示给出可恢复宿主记录ID时当前请求已提供read_tool_result。纯投影只返回依赖信息，不修改运行状态。

run.tools_loaded先持久化递增revision、完整可调用定义/来源及激活正文，再更新下一模型请求的工具入口、声明和预算。公开数据为`{revision,names,skills}`，完整定义和正文留privateData。同一assistant工具批次保持原快照，不能立即调用刚发现的工具；context.prepared记录最终capabilityRevision及实际模型输入。提交失败停止Run，不使用未提交集合继续调用。

普通动态加载在当前Run追加，压缩不卸载；记忆学习设置和来源由写入事务再次校验，不通过临时卸载工具表达。Run结束释放自身能力引用；仍在执行的根命令保留独立资源租约，新Run按当前环境和有效选择重建能力。子Run继承父可继承项并筛选当前集合与候选，初始提供父通信；其新增不传播到父或兄弟。spawn的深度限制不连带关闭收集已有后代的wait。

search_session_history仍只查询当前会话的合法历史；search_sessions面向当前工作区其他可见Root会话，排除整个当前Session。read_search_source只精读本Run真实命中或已消费人类引用授予的范围，不接收模型自报授权；search_memories服从allowUse和精确子任务授权。save/learn/update直接执行宿主记忆事务，delete沿统一审批；五个记忆工具默认提供，根/子范围由宿主约束。完整参数、只读来源和引用协议由[记忆与搜索](memory-search.md)维护。

## Skill正文与资源

`load_skill({id})`从本Run的SkillCandidate解析预期hash、来源及skillEpoch/pluginEpoch/pluginGeneration，加载前后核对绑定；文件改变、被遮蔽/停用或同内容插件重装均不能静默换版本。摘要不激活正文，实际选择才创建正文与资源快照并持有租约；后续源文件编辑不替换已冻结内容，授权撤销继续生效。

FrozenSkill包含完整指令、资源索引、来源、授权代次及可选gatewayUrl、resourceDirectory。首次模型请求前，宿主将初始已激活Skill的快照物化到profile外受控目录，再以run.tools_loaded提交同一正文、资源和授权及当前resourceDirectory。历史接受记录中的目录可在本Run首次加载时重绑定；一旦本Run的run.tools_loaded记录目录，后续加载必须保持该目录及其余所有Skill字段。目录是本Run的宿主资源位置，不进入contentHash。

load_skill返回文本JSON：`{id,resourceDirectory,availableFrom:"next-model-request"}`。新激活的正文及目录仍须经过请求前持久屏障，才能进入下一模型请求。命令仅取得已激活快照的精确只读根，不能通过加载Skill开放profile或安装根。共享依赖由resource-manifest.json声明随包共享源、目标和hash，冻结后使用复制进快照的字节；具体资源归属见[工具体系与沙箱](../09_TECHNICAL/工具体系与沙箱.md#skill资源如何供命令读取)。

`$skill-name`显式提及按可用目录冻结正文，与picker合并激活，最多16项；公开输入skills表示picker选择，提及绑定留私有接受/队列事实。同Run新增选择不能替换已激活ID的内容或授权。当前分支的有效正文跨Run和压缩保留；继承失效项被省略并记录固定诊断，新的显式选择仍严格校验。reset或摘要选择继续限定可继承历史范围。

`read_skill_resource({skillId,path})`只读取当前激活快照登记的相对资源，校验路径、hash、大小和绑定，返回有界文本或图片。工作区外资源不扩大read_file范围。allowed-tools只是需求提示，仅从已有工作区候选预选工具，不按任意名称取得MCP或写入权限；真实执行继续经过统一工具策略。

命令retain独立资源引用，Run释放不能提前删除仍在使用的资源；最后引用释放后回收物化目录。每个运行命令每秒复核原Skill授权、快照与物化hash，撤销或损坏触发停止和资源回收；新派发在启动前再次复核。受限及角色只读命令由OS禁止资源写入和profile访问。full-access保留宿主权限，代次校验不能限制任意宿主Shell自行访问路径。

插件服务Skill的gatewayUrl随接受与实际模型上下文记录，会话级web_fetch不附带文件或命令权限。宿主仅对精确网关附加私有能力头；MCP写操作继续使用实际加载工具与当前审批，具体见[插件连接](plugin-connections.md)。

## 受管理命令

命令入口仅在macOS和已注册工作区下提供，使用当前Run绑定的sessionId/runId/taskId和角色范围。参数如下，未知字段拒绝：

| 工具         | 参数及默认值                                                                         | 结果含义                                        |
| ------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| run_command  | command；yieldTimeMs默认10000、范围0–30000；lifetimeMs默认14400000、范围100–86400000 | 创建命令并等待有限时间，返回在途或终态          |
| wait_command | commandId；timeoutMs默认10000、范围0–30000；cursor默认0、非负整数                    | 返回游标后的有界新增输出，短等待超时仍可running |
| stop_command | commandId                                                                            | 停止所属命令并等待进程与资源结算                |

结果包含commandId、status、exitCode、error、output、nextCursor、hasMore、totalBytes和truncated。status为starting、running、completed、failed或stopped；output项包含sequence、stream:stdout|stderr和text。stdout/stderr分别解码，结果保留有界尾部；返回nextCursor供后续读取，截断及累计字节不以当前页长度推断。进程总时限持续覆盖后台running，非零退出、限额、超时或清理失败保留可用部分输出和错误。

同会话根任务的后续Run可查询或停止根命令；其他会话及不同Task拒绝访问。成功根Run结束后命令保持受监管，子任务结束收束所属命令；显式取消、会话归档或关闭、Skill撤权、总时限和daemon退出停止对应工作。停止一次等待不等于停止命令，进程关闭与leader退出分别观察；重启不恢复执行历史命令。

审批与隔离分别确定。ask/auto采用默认断网的workspace-write，角色只读进一步禁止工作区写入；普通角色full-access采用宿主用户权限。隔离初始化失败明确失败，不自动宿主重跑。MCP/OAuth和HTTP工具继续执行自己的公网、目标及凭据规则，权限模式不关闭这些规则。实际平台保证见[sandbox说明](../../packages/sandbox/README.md)。

## 正文与视觉读取

read_document从稳定文件字节提取有界正文，支持PDF及已实现的办公/电子书解析格式；它不进行OCR或版面验证。view_image返回PNG、JPEG、GIF或WebP的真实图像；view_pdf_page从稳定PDF字节渲染一次一至四个指定页，返回实际页图。视觉入口要求当前模型支持图片，PDF渲染还需要可用Python及依赖，缺失明确诊断。附件正文提取复用同一解析实现，授权继续由附件宿主拥有。

## 通用产物

`publish_artifact({path,mediaType?,producerCommandId?})`按需注册当前工作区内的常规文件。宿主复核真实工作根、路径、链接、大小、可观察读取变化和类型，将精确字节写入私有不可变blob；工具结果文本不作为文件声明来源。提供producerCommandId时，先核对同会话和Task的命令已成功结束；省略只证明注册时字节稳定，不证明生产完成或格式正确。

Artifact包含id、sessionId、runId、taskId:string|null、toolCallId、workspaceId、sourcePath、name、mediaType、bytes、sha256、createdAt及可选producerCommandId。sourcePath是工作区相对路径，下载不接受它作为目标。ToolCallView.artifacts为可选数组，客户端省略时按空数组处理。

成功工具终态、canonical结果和`artifact.published`事件在同一批提交，事件data为`{artifact}`。存储核对相同metadata及归属，拒绝非成功或外部MCP伪造产物。blob成功而批次未提交只留下无引用文件，不能公开为成功产物。结构检查、真实重算和视觉复验分别记录，产物注册只证明注册字节和宿主归属。

`GET /api/sessions/:id/artifacts/:artifactId`通过现有应用登录、Host/Origin及会话访问检查，核对当前分支保留的根工具或Task委派锚点，返回注册时的精确附件字节。跨会话、不可见或未注册ID拒绝；源文件后续改变或删除不影响下载，私有blob缺失或hash损坏明确失败。响应设置attachment文件名、真实媒体类型、no-store与nosniff；请求不接受任意路径。

大小、每profile配额、发布引用、下载租约和无引用回收见[storage](../../packages/storage/README.md)。归档、分支切换与投影重建保留历史事实及其blob，不隐式擦除已交付文件。

## 调用与恢复

MCP工具保留精确Server来源及授权版本；普通web_fetch记录原URL和受限结果，不记录宿主能力或供应商Token。派发前持久化may_have_started，失联、超时或撤销后无法核实结果时记unknown，停止模型和自动队列，不自动重试。所有工具终态与中立结果同批写入，日志恢复只重建事实，不重做请求或历史命令；完整磁盘语义由[storage](../../packages/storage/README.md)拥有。
