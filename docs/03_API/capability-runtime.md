# 运行时能力协议

共享协议版本见[API入口](overview.md)。输入的`skills`为`{id,contentHash}[]`，最多16项，贯通发送、历史编辑和队列更新；空选择明确为空数组。MCP显式选择仍最多16项，按需候选最多512项，不向Renderer暴露宿主授权或凭据。

## 输入接受与可见版本

`run.accepted`私有记录冻结初始工具定义/来源、MCP候选目录、发现诊断、启用且未被遮蔽的Skill摘要、工作区Office候选和Skill正文/资源manifest/授权epoch。队列接受时保存相同冻结数据及原requestId；不同完整授权不能在同一Run合并，重新信任或重装插件不会修复旧输入。用户明确编辑重选才更新绑定。

`tool_search`只搜索本Run冻结的已授权MCP与工作区工具，以服务名称、原始工具名称、说明及参数执行BM25检索；本地多语言向量与词法结果使用排名融合，完整工具名优先。搜索默认自动暂存8项、单次最多10项，略过已加载或已暂存名称，全部可调用工具（含内置）最多64项。`load_tools`保留按精确名称显式暂存；搜索结果中的名字可在下一次模型请求直接调用，无须再次调用`load_tools`。语义计算失败或18秒截止后使用词法结果，Run取消继续传播。零命中返回冻结的目录诊断，不能把服务尚未就绪推断为OAuth未授权。`run.tools_loaded`先持久化递增revision、完整可调用定义及来源，再在下一模型请求更新Pi工具入口。公开事件为`{revision,names,skills}`；完整定义和正文留privateData。同一个assistant中尚未提供的工具不能调用。

`context.prepared`记录当次capabilityRevision与实际模型输入。预算、system工具声明和执行路由使用同一可见集合；加载不会改变旧模型步骤的定义。日志损坏或提交失败停止Run，不继续模型或上游调用。

## Skills与有限授权

已启用且未被遮蔽的Skill摘要和MCP发现状态在每次实际system消息中重建；摘要不激活Skill正文。`$skill-name`显式提及按可用目录解析并冻结正文，和picker选择合并激活，最多16项；公开输入选择仍只包含picker选择，提及绑定留私有接受/队列事实，恢复不得换成新磁盘内容或新授权。

`skill_search`仅返回可用元数据；`load_skill`按精确hash冻结正文并在下一请求激活；`read_skill_resource`只读取当前激活版本中的注册相对资源，返回路径/hash和有界内容。每次模型请求从冻结正文重建指令；当前分支已提交激活正文跨Run及压缩保留，重启不读取新版正文。后续Run逐项重验，失效继承被省略并在记录的system上下文给出固定诊断，不阻塞其他聊天或复活旧授权；本次显式选择仍严格拒绝。reset或选择摘要按首次生成摘要时的reset边界限定来源，排除已放弃的消息。动态Skill仅暂存其声明且已在本Run冻结的本地Office工具，不按任意allowed-tools名称自动激活MCP或授予调用权限。

`request_skill_tools`绑定当前Run、激活Skill版本和具体冻结工具，始终要求用户明确批准。Skill正文和allowed-tools不自动授予权限；Plan、工作区范围、Server启动信任及每次工具审批仍有效。`revoke_skill_tools`保存撤销事实后停止Run，结束释放资源lease。

插件服务Skill额外冻结公开gatewayUrl，进入`run.accepted`及`context.prepared`；会话级`web_fetch`不要求工作区，不附带文件/Shell权限；宿主只对精确网关附加私有能力头。固定REST操作目录、connection来源和逐Run服务grant已移除，具体协议见[插件连接](plugin-connections.md)。

## 调用与恢复

MCP工具保留精确Server来源、配置及授权版本；普通web_fetch记录原URL和受限结果，不记录宿主能力或供应商Token。写入仍由MCP和原执行器按Plan及审批策略处理。

派发前持久化`may_have_started`；失联、超时或撤销后无法核实结果时记unknown，停止模型和自动队列，不自动重试。终态和中立结果同批写入。日志恢复只重建事实，不重做请求；完整磁盘语义由[storage](../../packages/storage/README.md)拥有。

## 办公产物下载

`GET /api/sessions/:id/tools/:toolId/artifact`通过已有应用登录保护，只接受会话与工具ID。宿主从当前分支已完成的原生Office工具记录读取artifact，不接受客户端路径；按注册工作区打开文件，核对记录中的大小和SHA-256后返回附件。生成后文件改变返回409，越界/秘密路径/非Office或非成功记录拒绝。链接不是永久授权，退出登录后不能下载。
