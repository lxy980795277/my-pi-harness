# 运行时能力协议

共享协议版本见[API入口](overview.md)。输入的`skills`为`{id,contentHash}[]`，最多16项，贯通发送、历史编辑和队列更新；空选择明确为空数组。MCP显式选择仍最多16项，按需候选最多512项，不向Renderer暴露宿主授权或凭据。

## 输入接受与可见版本

`run.accepted`私有记录冻结初始工具定义/来源、MCP候选目录、工作区Office候选和Skill正文/资源manifest/授权epoch。队列接受时保存相同冻结数据及原requestId；不同完整授权不能在同一Run合并，重新信任或重装插件不会修复旧输入。用户明确编辑重选才更新绑定。

`tool_search`只搜索本Run冻结的已授权MCP与工作区工具摘要；`load_tools`只暂存候选中的名字，最多同时加载64个外部工具。`run.tools_loaded`先持久化递增revision、完整可调用定义及来源，再在下一模型请求更新Pi工具入口。公开事件为`{revision,names,skills}`；完整定义和正文留privateData。同一个assistant中尚未提供的工具不能调用。

`context.prepared`记录当次capabilityRevision与实际模型输入。预算、system工具声明和执行路由使用同一可见集合；加载不会改变旧模型步骤的定义。日志损坏或提交失败停止Run，不继续模型或上游调用。

## Skills与有限授权

`skill_search`仅返回可用元数据；`load_skill`按精确hash冻结正文并在下一请求激活；`read_skill_resource`只读取当前激活版本中的注册相对资源，返回路径/hash和有界内容。每次模型请求从冻结正文重建指令，压缩不替代该正文。

`request_skill_tools`绑定当前Run、激活Skill版本和具体冻结工具，始终要求用户明确批准。Skill正文和allowed-tools不自动授予权限；Plan、工作区范围、Server启动信任及每次工具审批仍有效。`revoke_skill_tools`保存撤销事实后停止Run，结束释放资源lease。

`service_search`返回当前插件Skill可用的连接与固定操作摘要。`request_service_access`需要明确批准，绑定Run、Skill hash/插件epoch、账户/服务、配置revision/访问epoch、具体操作及30至900秒期限。批准后保存`run.service_access_granted`及固定操作定义，下一可见版本生成账户隔离的服务工具名。主机按固定方法与路径构造请求，模型不能提供任意URL或认证头；写操作仍执行Plan与工具审批。`revoke_service_access`撤销并停止Run。

## 调用与恢复

`ToolSource.kind`包含`connection`，记录`connectionId/grantId/operation`，与MCP Server来源分开。每个具体服务工具保存真实参数、父调用关联、派发屏障及终态；秘密由宿主临时附加，不进入模型、工具参数或JSONL。

派发前持久化`may_have_started`；失联、超时或撤销后无法核实结果时记unknown，停止模型和自动队列，不自动重试。终态和中立结果同批写入。日志恢复只重建事实，不恢复服务grant或重做请求；完整磁盘语义由[storage](../../packages/storage/README.md)拥有。

## 办公产物下载

`GET /api/sessions/:id/tools/:toolId/artifact`通过已有应用登录保护，只接受会话与工具ID。宿主从当前分支已完成的原生Office工具记录读取artifact，不接受客户端路径；按注册工作区打开文件，核对记录中的大小和SHA-256后返回附件。生成后文件改变返回409，越界/秘密路径/非Office或非成功记录拒绝。链接不是永久授权，退出登录后不能下载。
