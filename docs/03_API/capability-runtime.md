# 运行时能力协议

共享协议版本见[API入口](overview.md)。用户输入的`skills`仍为`{id,contentHash}[]`，最多16项，贯通picker、发送、历史编辑和队列更新；空选择明确为空数组。模型工具`load_skill({id})`由宿主解析内容绑定，不改变用户显式选择协议。MCP显式选择最多16项、按需候选最多512项，不向Renderer暴露宿主授权或凭据。

## 目录、默认声明与接受事实

原生工具共28项，schema由各领域拥有，`tools/catalog`统一来源、执行族及默认策略，`tools/selection`根据实际执行器能力、工作区、角色和当前状态选择。以macOS、有工作区、Work及委派均可用的普通根Run为例：基础7项加ask_user、tool_search、spawn_agent和wait_agents默认11项；有可用Skill目录时再提供load_skill，共12项。Office、计划/历史、Skill资源及非必备Agent控制按需；显式选择、已有工作状态和角色限制会改变实际集合，不构成跨平台固定数量。

`run.accepted`私有记录保存初始`tools/toolSources`、MCP绑定/候选和诊断、`nativeCandidates`、`skillCandidates`及已激活Skill正文。原生候选记录definition/source/fingerprint，准确区分session与workspace；SkillCandidate只保存selection、authorization、name、description、scope和source，不含正文、资源或活动租约。预算、供应商schema及执行使用同一可见集合，来源和加载策略不混入供应商schema。

队列保存显式MCP/Skill绑定、Skill候选目录、发现诊断及原requestId；原生候选在Run接受时由统一目录选择并记录。原授权不能因重新信任或同内容插件重装而复活，不从systemPrompt文本反查结构化绑定。

## 搜索与请求前激活

`tool_search({query,limit?})`搜索本Run获准的原生和MCP候选，以服务/原名、描述及参数执行词法检索，并可融合本地多语言向量；完整名字优先，MCP关闭或失败不阻断内置发现。默认最多返回8项，单次最多10项；每项标记`already-available`或`next-model-request`。新增命中自动暂存，重复命中不重复加载或提交事件，全部可调用工具（含内置）最多64项。语义失败或18秒截止保留词法，Run取消继续传播；零命中不能被解释成OAuth状态。

宿主已确认的依赖走同一激活路径：当前Plan/Todos提供对应更新入口，已激活Skill的附加资源索引非空时提供reader，裁剪提示给出可恢复宿主记录ID时当前请求已提供read_tool_result。纯投影只返回依赖信息，不修改运行状态。

`run.tools_loaded`先持久化递增revision、完整可调用定义/来源及激活正文，再更新下一模型请求的工具入口、声明和预算。公开数据为`{revision,names,skills}`，完整定义和正文留privateData。同一assistant工具批次保持原快照，不能立即调用刚发现的工具；`context.prepared`记录最终capabilityRevision及实际模型输入。提交失败停止Run，不使用未提交集合继续调用。

动态集合在当前Run只追加，压缩不卸载。Run正常结束、失败或取消后释放所属资源，新顶层Run按当前环境、有效显式选择和Skill重新构建，不从历史自动激活全部旧工具。子Run继承父可继承项并筛选当前集合与候选，初始提供父通信；其新增不传播到父或兄弟。spawn的深度限制不连带关闭收集已有后代的wait。

## Skill正文与资源

接受的Skill摘要包含ID、名称、简介和作用域，摘要不激活正文。`load_skill({id})`从本Run的SkillCandidate解析预期hash、来源及skillEpoch/pluginEpoch/pluginGeneration，加载前后核对当前绑定；文件改变、被遮蔽/停用或同内容插件重装均不能静默换版本。实际激活才创建正文/资源快照并持有租约；已激活正文继续使用原快照，后续源文件编辑不替换它，授权撤销仍生效。

`$skill-name`显式提及按可用目录冻结正文，与picker合并激活，最多16项；公开输入skills仍表示picker选择，提及绑定留私有接受/队列事实。同Run新增显式选择走原接受链，不能替换已激活ID的内容或授权。每次请求从冻结正文重建指令，当前分支的有效正文跨Run和压缩保留；继承失效项被省略并记录固定诊断，不阻塞普通聊天，新的显式选择仍严格校验。reset或摘要选择继续限定可继承历史范围。

`read_skill_resource({skillId,path})`只读取当前激活快照中登记的相对资源，校验路径、hash、大小和绑定，返回有界文本或图片。工作区外的托管Skill资源不扩大read_file范围。Skill的allowed-tools只是需求提示，只从本Run已有的工作区候选预选本地工具，不按任意名称取得MCP或写入权限；真实权限与逐次审批仍由统一工具策略拥有。

插件服务Skill额外冻结公开gatewayUrl，进入`run.accepted`及`context.prepared`；会话级`web_fetch`不要求工作区，不附带文件/Shell权限；宿主只对精确网关附加私有能力头。固定REST操作目录、connection来源和逐Run服务grant已移除，具体协议见[插件连接](plugin-connections.md)。

## 调用与恢复

MCP工具保留精确Server来源、配置及授权版本；普通web_fetch记录原URL和受限结果，不记录宿主能力或供应商Token。写入仍由MCP和原执行器按审批策略处理。

派发前持久化`may_have_started`；失联、超时或撤销后无法核实结果时记unknown，停止模型和自动队列，不自动重试。终态和中立结果同批写入。日志恢复只重建事实，不重做请求；完整磁盘语义由[storage](../../packages/storage/README.md)拥有。

## 办公产物下载

`GET /api/sessions/:id/tools/:toolId/artifact`通过已有应用登录保护，只接受会话与工具ID。宿主从当前分支可见、已完成的原生Office工具记录读取artifact，不接受客户端路径；按注册工作区打开文件，核对记录中的大小和SHA-256后返回附件。生成后文件改变返回409，越界/秘密路径/非Office或非成功记录拒绝。链接不是永久授权，退出登录后不能下载。
