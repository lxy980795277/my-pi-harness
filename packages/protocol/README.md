# Protocol

跨 HTTP、SSE、所有者进程 IPC 与 preload 的 DTO 和 TypeBox schema。只依赖浏览器安全的 TypeBox；不加载 Node、Pi 或业务实现。

产品应用版本由根 `package.json` 通过 `pnpm version:sync` 生成，协议版本独立控制。源码检查使用 TS paths，发布消费者通过包 exports 加载 `dist`。

协议18的会话创建和工作状态不包含执行/Plan模式参数。计划内容、审核、任务与人工提问仍由独立的上下文交互schema表达；输入的send/follow-up/steer继续表示发送与队列语义。

`src/index.ts`只汇总公开导出，`src/version.ts`是版本脚本生成的固定入口。`application/`定义应用登录、模型设置与工作区协议；`sessions/`定义会话、流更新及上下文交互；`tools/`定义工具调用、私有冻结记录及办公产物；`extensions/`定义MCP、Skills、插件和服务连接；`host/`定义服务健康状态、桌面启动消息、有限桌面桥及外链校验。所有目录均保持浏览器安全，不引入宿主实现或Node依赖。

字段、失败语义和桌面桥见 [协议文档](../../docs/03_API/overview.md)。改变协议时同时更新所有消费者和相关行为验证。

应用身份使用`AppUser`、`LoginProvider`、`LoginSessionInfo`、`LoginFlow`，`AuthStatus`分别表达本机信任与应用登录。未登录不返回profile用户资料；公开登录流程只包含用户验证码，不含私有device_code、上游Token或应用bearer。模型授权继续使用独立`AuthFlow`。

`sessions/agents.ts`定义子Agent角色与限制、任务摘要/分页详情、通信、停止命令及看板筛选。`RunView.taskId`省略表示根执行，存在时指向同Session的子任务；任务源仅持久化`sourceToolCallId`，公开摘要中的父子关系和用量由宿主投影，不要求日志重复保存。`MessageView.agentMessageId`标识通信形成的模型输入，关联原始通信，不能冒充用户提问或进入提问编辑入口。`defaultAgentSettings()`是角色与预算默认值的唯一解析入口，宿主保存设置时检查revision和模型选择关联。全局任务变更SSE只发送`ready/changed`失效通知，不携带任务正文或凭据。
