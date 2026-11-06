# Protocol

跨模块共享的数据类型与TypeBox schema。根入口提供HTTP、SSE、所有者进程IPC与preload的公开DTO；`@my-pi-harness/protocol/internal`只提供宿主模块间的数据。两个入口均只依赖TypeBox，不加载Node、Pi或业务实现；浏览器安全不表示宿主数据应公开给Renderer。

产品应用版本由根 `package.json` 通过 `pnpm version:sync` 生成，协议版本独立控制。源码检查和消费者通过包exports读取src；Node使用tsx加载，Web和Electron构建器将浏览器安全协议打入各自产物。

协议18的会话创建和工作状态不包含执行/Plan模式参数。计划内容、审核、任务与人工提问仍由独立的上下文交互schema表达；输入的send/follow-up/steer继续表示发送与队列语义。

`src/index.ts`只汇总公开导出，`src/version.ts`是版本脚本生成的固定入口。`application/`定义应用登录、模型设置与工作区协议；`sessions/`定义会话、流更新及上下文交互；`tools/`定义公开工具调用与产物；`extensions/`定义MCP、Skills、插件和服务连接；`host/`定义公开服务健康状态、桌面启动消息、有限桌面桥及外链校验。

`internal/`拥有冻结MCP授权、Skill正文与资源绑定、canonical工具结果、实时消息覆盖输入及持久提交数据。`EventInput`、`RequestAcceptance`与已分配身份的`SessionCreateRecord`在这里唯一定义，runtime和storage通过此入口共享，不互相依赖实现。公开模块不得引用internal，Renderer不得导入internal；源码边界检查覆盖合法宿主消费、公开重导出和非法子路径。

字段、失败语义和桌面桥见 [协议文档](../../docs/03_API/overview.md)。改变协议时同时更新所有消费者和相关行为验证。

应用身份使用`AppUser`、`LoginProvider`、`LoginSessionInfo`、`LoginFlow`，`AuthStatus`分别表达本机信任与应用登录。未登录不返回profile用户资料；公开登录流程只包含用户验证码，不含私有device_code、上游Token或应用bearer。模型授权继续使用独立`AuthFlow`。

`sessions/agents.ts`定义子Agent角色与限制、任务摘要/分页详情、通信、停止命令及看板筛选。`RunView.taskId`省略表示根执行，存在时指向同Session的子任务；任务源仅持久化`sourceToolCallId`，公开摘要中的父子关系和用量由宿主投影，不要求日志重复保存。`MessageView.agentMessageId`标识通信形成的模型输入，关联原始通信，不能冒充用户提问或进入提问编辑入口。`defaultAgentSettings()`是角色与执行限制默认值的唯一解析入口；限制包含任务数、深度、并发、轮数、时限和单请求输出，不设累计token额度，宿主保存设置时检查revision和模型选择关联。全局任务变更SSE只发送`ready/changed`失效通知，不携带任务正文或凭据。
