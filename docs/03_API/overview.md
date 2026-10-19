# API与共享协议

`packages/protocol` 是Web、daemon和桌面实际共享DTO与schema的唯一来源，必须保持浏览器安全。API边界校验与TypeScript类型从同一schema派生，消费者不复制定义。

应用版本与协议版本用途不同：应用版本来自根版本生成流程；`PROTOCOL_VERSION` 管理跨端协议兼容。修改协议时更新所有消费者和相应检查，不能用产品版本代替兼容判定。

当前协议为9，新增统一应用登录与持久身份；保留结构化多题、计划审核、步骤/Todo依据、上下文摘要版本与分类预算，并允许仅附件发送；保留审批策略、工具消息锚点、Workspace图标和有限目录拖放桥。开发阶段不保留旧协议兼容。客户端与daemon必须采用相同协议版本；SQLite迁移版本与Session事件版本分别管理，不随HTTP协议版本机械递增。

## M0 HTTP

| 方法与路径                | 行为                               |
| ------------------------- | ---------------------------------- |
| `GET /api/health`         | 返回当前已监听daemon实例的公开状态 |
| `GET /api/runtime/events` | 建立SSE，发送服务身份与传输心跳    |

health响应字段为 `status: "ready"`、`appVersion`、`protocolVersion`、`instanceId`、`startedAt` 和 `nodeVersion`。不返回环境变量、凭据、本地数据目录或内部堆栈。`instanceId` 与 `startedAt` 在同一daemon进程内稳定，重启后使用新的实例身份。

## M0 SSE

连接建立后发送 `event: runtime.ready`，其JSON data包含 `type: "runtime.ready"`、`protocolVersion`、`instanceId` 和 `startedAt`。客户端先解析和校验数据，并核对实例身份与health一致，再更新连接状态。协议错误、身份变化、就绪超时或连接错误会关闭当前订阅，用户通过重新连接入口重新读取health并订阅；当前没有自动重连策略。

传输每15秒尝试写入SSE注释 `: heartbeat`；响应处于背压时跳过本次心跳，避免积压无业务价值的输出。它用于保持连接，不是EventSource可见的 `message` 或业务事件。连接关闭清理计时器和响应订阅；服务关闭结束全部SSE连接。该SSE路径不提供HEAD订阅，HEAD请求不会分配长连接。

`runtime/events`仅提供进程状态，不提供Session事件持久化、seq重放或Agent状态；这些能力由独立Session接口提供。

## 桌面启动与桥

daemon监听成功后向启动管道写入 `daemon.ready` 记录，包含 `host: "127.0.0.1"`、实际 `port` 和 `instanceId`。桌面校验记录后才能加载服务页面；stdout不得混入普通日志。

桌面所有者通过Node IPC发送唯一控制消息 `{ type: "daemon.shutdown" }` 请求正常退出，daemon按schema拒绝其他控制值。IPC断开或父进程退出也触发服务关闭；该进程控制管道不暴露给Renderer。

preload暴露 `DesktopBridge.getInfo()`、固定目录选择 `chooseWorkspaceDirectory()`、目录拖放 `getDroppedWorkspaceDirectory(file)` 与有限 `openAuth(flowId)`，后者的授权规则见[模型与会话协议](model-session.md)。getInfo返回经过校验的 `appVersion` 和 `platform`。拖放仅接受浏览器拥有的真实File，preload用Electron webUtils获取路径，main检查所属主frame、参数和实际目录；合成File或普通文件拒绝。点击与拖放均返回canonical目录，取消选择返回null，注册仍执行完整根策略。Renderer不接收通用 `ipcRenderer`、Node对象或任意channel；main校验消息来源，只接受当前窗口的受信任页面。

## 应用身份

[应用身份与登录协议](application-auth.md)拥有本机信任、GitHub登录、Cookie、profile归属、恢复和撤销。

## M1协议

模型、会话、输入队列、分支、本机授权与OAuth见[模型与会话协议](model-session.md)。M0的runtime/events继续只表示进程状态，不承担Session事件；私有会话使用受保护的独立订阅。

## M2协议

工具、审批、文件变化与执行恢复已有独立DTO与持久化规则。HTTP、IPC与持久化记录不能隐式复用含私有字段的服务对象。

工作区与工具的API、审批和私有上下文规则见[M2协议](workspace-execution.md)。目录选择仅从当前受信任主frame调用，无参数，不暴露通用文件系统。

## M3协议

附件上传与引用、AGENTS、上下文预算/压缩、人工提问、Plan/Todos和检查点恢复见[上下文与工作状态协议](context-interaction.md)。工作状态有独立的分支revision；私有内容与公开事件、元数据分别读取。
