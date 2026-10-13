# daemon与后端约束

Fastify负责本地HTTP与协议装配。路由声明参数和响应schema，应用服务处理流程，领域实现处理业务判断，repository处理持久化。M0尚无业务数据库或Agent模块，不为这些职责创建空实现。

权限与进程执行见 [安全约束](security.md)，持久化见 [存储约束](storage.md)。

## 分层与模块

| 层次                   | 负责                                             | 不应依赖                                   |
| ---------------------- | ------------------------------------------------ | ------------------------------------------ |
| route / Fastify plugin | 请求schema、来源检查、服务调用、状态码、公开响应 | 具体SQL、Agent创建和工具直接执行           |
| application service    | 用例编排、事务需求、策略调用与生命周期           | FastifyRequest、FastifyReply、Electron对象 |
| domain / capability    | 状态转换、业务判断、模型和工具能力               | Web组件与HTTP状态码                        |
| repository / adapter   | SQLite或外部系统的具体读写与错误映射             | 页面状态和路由处理                         |

按实际功能域组织路由、服务与私有类型。使用工厂和显式依赖参数，不为模仿Nest创建Module、装饰器或DI容器；Fastify插件按实际装配和封装范围使用，不通过全局变量绕过资源所有者。

## schema与请求

- 跨端DTO/schema由protocol拥有；私有输入留在所属域。外部数据校验后进入服务，TS泛型不能证明HTTP JSON有效。
- 有输入的路由声明params、querystring、body或headers schema，公开JSON响应声明实际状态码的schema；不直接序列化数据库Entity、凭据或服务对象。
- schema只来自应用代码，不将插件、用户或模型提交的schema动态编译。Fastify校验与序列化生成函数，schema应当作受信任代码。
- 首轮校验处理结构和范围，数据库存在性、权限及外部查询在校验后执行，不在Ajv首轮异步校验内查询数据库。[Fastify校验与序列化](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- 副作用接口显式规定未知字段、类型转换与默认值政策。Fastify默认Ajv可能转换值和移除额外字段；需要拒绝时配置实际选项并证明非法输入被拒绝，不能只写additionalProperties:false便声称拒绝。
- 输入长度、bodyLimit、分页和输出大小按资源限制；默认值在请求或配置解析所有者统一决定，不在服务深处随意 `?? []`。

## 状态与错误

GET不改变业务状态。资源路径优先复数名词与kebab-case，操作型接口由协议解释。根据真实结果使用200/201/204、400、401/403、404、409、422与5xx，不为固定包装禁止合法204。

错误码归属实际领域，route映射状态、安全消息及关联ID。未知错误记录服务侧堆栈，对外返回稳定错误；禁止所有错误回200、吞错返回空集合或把执行结果未知改成成功。框架校验错误与领域错误分别处理，不为重抛相同异常在每个函数加catch。

需要幂等的写操作先定义幂等键、存储与重放结果。网络失败、超时或断线只说明观察失败，不自动重试结果未知的文件、Shell、插件和远程写入。

## 配置与日志

配置在监听、打开数据库或启动外部进程前解析，使用显式schema、范围和受控默认值。端口、路径及未来模型/MCP设置由所属配置模块负责，协议常量与安全不变量不作为任意可调选项。配置错误不能静默回退成另一个目标。

daemon启动记录独占stdout，普通日志进入stderr。使用Pino结构化日志，按实际拥有者记录instanceId、requestId和已有sessionId/runId/toolCallId；child logger补充领域，不逐层打印同一输入。Fastify自带请求ID，允许客户端提供ID时先约束长度和字符，不盲信任外部header。[Fastify日志](https://fastify.dev/docs/latest/Reference/Logging/)

记录关键写入、外部调用结果、取消、启动和关闭原因。debug级别受配置控制；禁止完整env、认证头和不必要敏感正文。日志去重和脱敏不通过吞掉错误实现。

## 生命周期与流

- 资源创建后立即建立失败清理，dispose/stop幂等，关闭结果可等待；不能只对上层Promise设超时而遗留底层工作。
- 关闭先拒绝新工作，再收束已有工作，最后关闭依赖；保留错误，不用process.exit跳过正常flush。
- Fastify hook只用async或callback其中一种，不混用Promise和done。SSE长连接在preClose结束，普通资源在onClose清理，避免server.close等待自身未关闭的连接。[Fastify hooks](https://fastify.dev/docs/latest/Reference/Hooks/)
- SSE遵守背压和输出界限，关闭清理heartbeat；心跳注释不是业务事件，连接存活不代表Agent执行成功。seq、重放和恢复由后续协议定义。
- 取消传播到模型、工具、MCP和文件工作；区分已完成、已取消与结果未知，保留部分执行事实。
- CPU密集解析、embedding及大型同步SQLite工作限制工作量；影响响应性时使用明确worker，不长期阻塞事件循环。

临时实例、连接、队列和锁可用Map/Set；持久事实见存储约束，不强行引入Redis或多实例状态共享。平台启动与进程退出要求见 [桌面约束](desktop.md)。
