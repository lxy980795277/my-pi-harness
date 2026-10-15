# Agent Runtime

Node端的模型接入与持久会话运行层，使用固定的Pi core/ai 1.1.0公开接口。HTTP、SQLite、OS凭据和页面由宿主提供；本包不导入Fastify、Electron、React或SQL驱动。源码测试通过paths消费protocol/storage，生产仅导出dist。

`ModelGateway`装配账户实例、模型清单、连接探测与认证。OpenAI（Codex）、Anthropic、Google、DeepSeek、MiniMax、Kimi六个内置Provider按公开factory固定为单例入口，名称、端点和模型目录只读；旧重复账户及代理配置由具体ID继续兼容会话。自定义Provider允许空模型列表，模型Dialog草稿一次提交整个Provider，保留未提交的同ID模型headers/compat，切换协议同步已有模型API。自定义Provider使用Pi的Chat Completions、Responses或Anthropic lazy API。请求HTTP与模型SSE解析由Pi负责。OpenAI兼容Base URL通常含`/v1`；Anthropic SDK会追加`/v1/messages`，通常配置不含`/v1`的服务根地址。HTTPS及显式回环HTTP可用，地址不得含用户信息、query或fragment。

公开providerKind、配置实例ID与credentialRef分别表示协议/厂商、账户配置和秘密存储引用。不同实例使用独立Pi注册ID与凭据；旧代理凭据不会转移到新的官方入口。生产默认AuthContext不读取供应商环境变量或其他应用认证文件。requiresApiKey=false跳过保存及环境凭据，通过Pi公开fetch注入剥除SDK认证头；恢复Key要求可继续使用原保存凭据。模型定义显式指定真实modelId、能力、上下文和compat，保存配置不证明远端可用。`testConnection`发起有超时的真实请求，可能产生供应商用量；它返回脱敏结果。

`resolve()`返回Model、绑定的streamFn及必须调用的`release()`。该lease从认证检查前开始，阻止运行期间修改Provider和凭据；调用者在失败或SDK真正结算后释放。本包的SessionRuntime与连接探测负责这些释放，外部调用者须遵守相同规则。

宿主须在独占daemon启动时清理OpenAI/Anthropic SDK的环境认证、租户、Base URL、custom headers和console日志覆盖项；本包不在每个Gateway或请求内修改进程全局环境。Pi的AuthContext隔离不能代替底层SDK的环境策略。keyless最终fetch另外移除认证与OpenAI租户头，显式非秘密模型headers继续传递。应用启动清理的确切变量由daemon的model-environment模块拥有。

认证通过真正的`Models.login/logout`执行。AuthFlow暴露URL、device code、secret/code/select prompt及终态，输入只交给当前prompt，不存入公开DTO。宿主提供稳定profile deviceId。凭据适配将版本化Pi认证对象保存在宿主SecretStore，整段异步refresh在串行modify内进行；已开始的OAuth刷新在调用者取消后仍保存旋转Token。Gateway关闭会中止连接探测与登录，并等待在途凭据操作，不提前宣布退出。

`resolveSessionInput`解析显式选择或持久化全局默认，创建前检查模型、思考等级、启用与认证；失效默认不会改用其他模型。已有会话仍保留自己的选择。

`SessionRuntime`序列化单会话命令；每个Session只有一个活跃Run，不同Session可独立运行。输入、Run配置与模型上下文版本先原子提交，再创建真实Agent请求。SDK事件立即映射为独立公开字段，delta先提交后广播；订阅者不等待SDK idle，真正结算由Run所有者等待。绑定工作区的会话通过`ToolRuntime`提供受策略与单次审批约束的工具循环；没有工作区不自动获得本机目录权限，deferred不会被误报为完整成功。

运行中的follow-up/steer输入先进入持久队列，再交Pi对应队列消费；文本更新与删除重建其内存投影。每个Run只投递当次允许的输入集合，普通发送与编辑不会激活旧暂停队列。取消、失败与重启保留未消费输入，恢复收费请求需显式resume，且原始分支必须与所选分支相符；同一恢复Run只激活相同Provider/model的输入。编辑用户消息追加分支与新输入，保留旧分支并排除其后续回复。session.deleted归档会话，保留事件，不是彻底删除私人数据。

输入接受后若Agent初始化或首次队列读取失败，运行层清理订阅与临时所有权、释放模型lease并停用Session；不会遗留可继续工作的假Agent，也不补写假完成。下一次启动将已接受但未结算的事实恢复为interrupted。

SQLite事件与投影始终由RuntimeStore拥有。公开MessageView与私有模型codec分离，完整成功消息保留Provider签名、responseId等重放字段；错误/取消的SDK错误文本不进入公开事件。codec新写version2且读取version1/2；工具结果按assistant消息锚点进入私有上下文和分支前缀，未完成工具周期不伪造结果。公开工具记录ID按Run、assistant消息ID与SDK调用ID派生，兼容网关可在不同assistant轮次复用SDK调用ID；读取旧历史始终使用已存记录ID。存储写入失败会中止并停用该Session，不广播假完成或继续使用未提交Pi state；修复后重启从已提交事实恢复为interrupted。

本包测试使用真实临时SQLite、真实Pi Agent与受控faux Provider、动态端口HTTP/SSE和显式内存凭据适配器。它们不调用真实供应商账号或用户keyring，不能替代真实API、系统凭据和macOS/Windows发布验收。

```sh
pnpm --filter @my-pi-harness/agent-runtime typecheck
pnpm --filter @my-pi-harness/agent-runtime lint
pnpm --filter @my-pi-harness/agent-runtime test
```
