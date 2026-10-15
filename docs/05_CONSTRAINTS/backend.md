# 后端规范

适用于 daemon、agent-runtime、storage、共享 protocol 及 Node 工具。Fastify 装配 HTTP，agent-runtime 拥有模型与 Run，storage 拥有事务和系统凭据；进程职责见 [架构](../01_ARCHITECTURE/overview.md)。下列工具、插件和导入要求在对应能力实现时生效，不表示后续功能已经可用。

## 类型与模块

- ESM、strict、noUncheckedIndexedAccess、exactOptionalPropertyTypes；包间用 `@my-pi-harness/*`，NodeNext 包内相对导入保留编译后 `.js`。Node 能力使用 node: 前缀，不深层跨 workspace 导入私有源码。
- 类型 PascalCase，值与函数 camelCase，协议常量 UPPER_SNAKE_CASE，文件 kebab-case。interface 表达对象，type 表达联合/组合；闭合联合显式处理每个状态，扩展事件声明未知类型政策。
- 共享 DTO 从 protocol schema 派生，不复制定义；protocol 不含 Node/Electron、环境读取、数据库对象、业务配置、凭据或 Pi 实例。内部类型留在真实所有者，不建万能共享包。
- 外部 JSON 先用 unknown，经 schema/守卫解析；禁止 any、双重断言、非空断言和 ts-ignore 掩盖缺失校验。同进程类型已要求的值不反复猜测 typeof、可选链或默认值。
- 一个 package 声明自己直接使用的依赖，不借根包或传递依赖偶然解析。源码检查解析 src，产物检查解析真实 exports，不指向旧 dist 掩盖未构建问题。
- 导出函数/类记录非显然行为、失败、时间与资源所有权，不逐行解释。文件超过 500 行评估职责，超过 1000 行先拆分；不建空包、转发层或保留注释实现与废弃业务副本。

## 分层、输入与错误

| 所有者               | 负责                                           | 不负责                               |
| -------------------- | ---------------------------------------------- | ------------------------------------ |
| route/Fastify plugin | schema、来源与授权、用例调用、状态码和安全 DTO | SQL、Agent 创建与工具执行            |
| application service  | 用例编排、策略、事务需求和生命周期             | Fastify Request/Reply、Electron 对象 |
| domain/capability    | 状态转换、模型、Run 与工具判断                 | HTTP 状态码和页面状态                |
| repository/adapter   | 数据库或外部系统读写及错误映射                 | 组件、路由处理和产品缓存             |

- 按功能域组织模块，工厂显式接收依赖；不模拟 Nest 装饰器/DI 容器，不用全局变量绕过拥有者。
- HTTP/IPC、配置、文件、持久记录、子进程消息与模型工具 JSON 在入口校验结构、版本、大小和关联。模型或外部文档的指令不能覆盖应用策略。
- 路由声明实际 params/query/body/headers 与响应 schema，只使用应用拥有的受信 schema。数据库存在性、权限及外部查询在结构校验后处理，不塞进首轮 Ajv 异步验证。
- 未知字段、转换与默认值政策必须实际配置；additionalProperties:false 不等于 Fastify 默认会拒绝。非法请求需要真实拒绝用例。
- 长度、bodyLimit、分页和输出受限。配置默认值在解析所有者产生，配置错误在监听、打开数据库或启动进程前失败，不静默换目标。
- GET 不改变业务事实。状态码反映结果，公开 DTO 显式选字段，不直接序列化 Entity、服务或 Error。领域错误映射安全状态/消息与关联 ID，未知错误服务侧记录，对外稳定失败。
- 不回 200 假成功、吞错返回空集合或把结果未知当完成。需要幂等的写操作定义键与重放结果，断线/超时不自动重试不确定副作用。

## 生命周期、异步与日志

- Promise 必须 await、返回或由明确拥有者捕获并追踪；不以 void 消除失败责任，不保留无说明空 catch。catch 为 unknown，窄 try 只包可能失败的工作，已知忽略说明原因，其余错误继续传播。
- 资源创建立即建立失败清理，stop/dispose 幂等且可等待。关闭先拒绝新工作，再收束活动工作，最后关依赖；不只超时上层 Promise 而遗留底层工作，不用 process.exit 跳过 flush。
- AbortSignal、超时和输出上限贯通模型、工具、网络与子进程；区分已完成、取消和结果未知，保留部分事实。Fastify hook 只用 async 或 callback 之一。
- SSE 在 preClose 结束连接，onClose 清理普通资源，清除心跳并执行背压/输出界限；事件先提交再发布，seq/重放遵守实际协议。心跳或连接存活不能证明 Run 成功。
- 同步 SQLite、CPU 密集解析和批处理限制工作量；明显影响响应时交给明确 worker。Map/Set 可存临时实例、锁和连接，需重启恢复的事实持久化。
- daemon.ready 独占 stdout，Pino 普通日志走 stderr；记录已有 instanceId/requestId/sessionId/runId，不逐层重复输入。外部 request ID 先限制长度和字符。
- 日志记录关键写入、外部结果、取消和关闭，不输出完整 env、认证头或不必要正文；脱敏覆盖参数、响应、异常 cause 与 trace，不仅匹配 token 字段。

## 回环安全、凭据与副作用

- 仅绑定 127.0.0.1。回环与 CORS 不等于认证；有状态 API 按协议校验真实 Host、Origin、认证和 CSRF。没有 Origin 不自动可信，Token 不进 URL/SSE query。
- 已保存 Key/OAuth Token 留服务侧系统凭据库，不进业务 SQLite、ASAR、DTO、页面通用状态、日志或导出。专用表单允许短暂输入秘密，写请求和公开 DTO 分开，响应不回显；无系统凭据能力时明确失败，不降级明文文件。
- 审批指向已解释的具体目标、范围、时效、关联和撤销；读取/写入/删除/执行分别授权，审批通过不等于执行成功。安装插件、连接 MCP 不自动授予主机全部权限。
- 路径检查真实目标与 Workspace；创建检查已存在父目录，读取/修改检查实际对象，不用字符串 startsWith 判断包含。执行前再核对，不能认为一次 realpath 消除竞态；凭据目录和安装资源不是普通写入目标。
- Shell 明确程序、参数数组、cwd、环境白名单、AbortSignal、总时限与输出界限，不拼接未知文本为宿主命令。取消、超时、输出超限回收所属进程树，不按进程名误杀。
- 隔离失败明确报错，不自动退回宿主；Renderer sandbox 与 Node Permission Model 不能替代恶意代码的 OS 隔离。Windows 所有权与退出见 [桌面规范](desktop.md)。
- 外部抓取限制协议、响应体、解压、重定向和总时间，每次 DNS/重定向检查目标；默认拒绝私网、回环、链路本地与元数据地址。用户配置本机网关只允许所需目标，不开放全部私网。
- OAuth 的 state、PKCE、回调、超时、重放和取消由实际协议定义，回环监听结束后关闭。系统浏览器只打开经过验证的所属流程 URL，不提供任意 openExternal。
- 诊断使用脱敏摘要与用户选择，不读取任务无关秘密；假凭据测试证明不泄露。HTTP 拒绝、越界、取消和超时需要实际边界证据。

## SQLite、迁移与恢复

- storage 独占业务连接与写入，Renderer/main 不打开业务库。SQLite durable events 是 Session 执行事实来源，JSONL 仅显式交换，不实时双写或竞争恢复来源。其他配置按其领域事务拥有。
- 事件有稳定 ID、sessionId、单会话递增 seq、类型与格式版本，唯一约束及事务保证顺序，不靠 Date.now 排序或幂等。原子提交事实和投影，提交后才向客户端发布；派生索引可重建，失败不删事实。
- 事务只含本机数据库工作，不等待模型、HTTP 或用户。参数绑定 SQL，索引覆盖实际查询，避免 N+1、无界加载与无限 busy 重试；WAL 不放网络共享目录当多人数据库。
- 启动先取得 profile 所有权，再迁移与恢复；所有权由 OS 锁/连接释放判断，不用陈旧 PID 或时间戳猜测。损坏库不能静默清空并显示成功。
- SCHEMA_VERSION 单调增加，未知更高版本拒绝。迁移与校验随产物发布，已在用户安装应用的迁移冻结，只追加后继，不要求用户手动 DDL。数据转换声明前置版本、失败、备份和恢复，保留已有 ID、凭据引用与执行记录。
- 活动库备份用 SQLite 备份 API 或停写完整快照，不只复制主库忽略 WAL。恢复先核对完整性与目标版本；破坏性改变先验证备份可打开且可恢复。
- JSONL 导入验证完整记录、版本、关联、顺序、重复政策和事务，不半导入后标完成；导出只含已提交事实，不含凭据或临时对象。记忆/来源为事实，FTS/vector 为索引；embedding 记录模型/版本/维度，变更后重建兼容索引。
- 重启区分完成、未完成与结果未知，started 不证明副作用没发生；重试与 undo 明确范围和证据，不能宣称不可逆外部操作完全撤销。没有升级/恢复验证不声明兼容已有数据。

验证范围、非法用例与证据见 [测试规范](testing.md)。实现接口参考 [Fastify 校验](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)、[生命周期 hooks](https://fastify.dev/docs/latest/Reference/Hooks/)、[SQLite WAL](https://sqlite.org/wal.html) 与 [备份 API](https://sqlite.org/backup.html)。
