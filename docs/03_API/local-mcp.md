# MCP目录与本地协议

共享协议版本由[API入口](overview.md)维护。`packages/protocol/src/mcp.ts`拥有管理DTO、隔离范围与工具选择schema；`tools.ts`和`tool-results.ts`拥有调用来源、派发事实与私有中立结果。所有接口复用[应用登录](application-auth.md)、Host/Origin和写请求CSRF校验，未知字段拒绝。

## 配置与安全DTO

本节的本地Server使用stdio，注册到一个已有工作区；远端HTTP/SSE及MCP OAuth见[远程协议](remote-mcp.md)。创建输入为`name`、`workspaceId`、绝对程序`command`、独立`args`数组、`publicEnvironment`及`secretSlots:[{slotId,environmentName}]`。工作根固定为注册目录；不隐式调用Shell、安装程序或继承宿主全部环境。启动控制环境变量不可覆盖。

公开`McpServerView`增加`id`、`revision`、`enabled`、`accessEpoch`、`trustedScopes`、`connectionState`、安全诊断与时间；秘密槽位只返回名称和`configured`。秘密字节留系统凭据库，`credentialRef`与凭据epoch属于宿主记录，不进入DTO。配置、控制、秘密引用和授权存SQLite，调用事实进入会话JSONL。

配置修改以`expectedRevision`做CAS并推进revision，失效旧启动授权。控制操作额外核对`expectedAccessEpoch`，停用、撤销和凭据删除推进accessEpoch。新Server默认停用；普通编辑、删除及秘密轮换遇活动租约或未收束资源时返回409。字段错误返回400，版本/忙碌冲突409，启动配置或选择不合法返回领域错误；错误响应使用`{code,message}`，不返回上游原文或cause。

## 管理接口

以下路径均相对`/api/mcp/servers`。列表直接返回数组，单项直接返回DTO，不增加通用响应封套。

| 方法与路径                  | 输入与响应                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| GET /                       | McpServerView[]；只读配置，不启动                                                        |
| GET /:id                    | McpServerView；只读配置，不启动                                                          |
| POST /                      | McpServerInput → McpServerView                                                           |
| PUT /:id                    | 配置字段加expectedRevision → McpServerView                                               |
| DELETE /:id                 | {expectedRevision} → {ok:true}；删除配置与系统秘密引用，保留历史日志                     |
| POST /:id/secrets/:slotId   | {expectedRevision,value} → McpServerView；新ref写入后CAS，失败回滚新ref                  |
| DELETE /:id/secrets/:slotId | {expectedRevision,expectedAccessEpoch} → McpServerView；先持久撤销，再回收连接和删除引用 |
| POST /:id/trust-preview     | {expectedRevision,expectedAccessEpoch,scope} → McpTrustPreview；解析启动范围，不启动     |
| POST /:id/trust             | 上述字段加startupFingerprint → McpServerView；重验指纹后保存授权并启用                   |
| POST /:id/disable           | {expectedRevision,expectedAccessEpoch} → McpServerView；停用并撤销旧授权                 |
| POST /:id/revoke-trust      | 同disable；撤销授权并停用                                                                |
| POST /:id/discover          | {expectedRevision,expectedAccessEpoch,scope} → McpToolCatalog；明确启动并发现工具        |
| POST /:id/test              | 同discover，执行连接与目录检查，不调用具体工具                                           |
| GET /:id/tools?scope=...    | McpToolCatalog或null；只读当前revision/accessEpoch匹配的内存目录缓存                     |

`scope`为`sandboxed`或`full-access`。预览返回有效程序、参数、工作根、环境变量名、网络范围与启动指纹；指纹覆盖程序和显式文件入口身份、参数、根、普通环境、秘密slot/ref/epoch、隔离及资源策略，排除秘密内容。两种scope分别授权，不能相互继承。授权只允许启动这组配置，不能替代每次工具调用审批，也不承诺外部程序所有隐式磁盘依赖不可变化。

发现和测试使用短租约，结束等待连接及进程关闭；目录缓存独立保留。普通GET、打开设置与页面聚焦不隐式启动程序。缓存工具含`serverId`、`serverRevision`、`remoteToolName`、模型别名`name`、描述、`definitionFingerprint`及可选状态、工具开关和精确只读授权提示；不支持的schema显示不可选。实际调用新进程重新发现并核对完整定义指纹，不能悄悄替换旧选择。

## 目录控制与JSON交换

本地与远端均提供`POST /:id/tool-control`，输入`expectedRevision`、`expectedAccessEpoch`、`remoteToolName`、`enabled`。每次开关推进独立工具控制revision，并撤销该Server的只读授权；关后再开不能复活旧Run绑定。工具控制不伪造新的Server定义版本。

`GET /:id/metadata`返回已发现的Resources和Prompts元数据；本地需要`scope`查询参数，远端不需要。响应不读取资源正文或执行提示词。`GET /:id/readonly-grants`列出公开授权摘要；`POST`接受完整工具选择、`expectedAccessEpoch`及`arguments`对象，只对当前有效定义及有界合法参数授予可信只读。`DELETE /:id/readonly-grants/:grantId`使用空JSON对象，撤销后旧绑定立即失效并关闭相关连接。授权绑定profile身份、定义、Server配置/访问epoch、工具控制revision和参数hash，不把外部注解当作证明。

`GET /api/mcp/configuration/export`返回`{version:1,local:[],remote:[]}`，只含公开配置与秘密槽位，不导出秘密、凭据引用、信任或插件归属。`POST .../preview`先校验整批字段、工作区和名称冲突；`POST .../import`提交同一JSON内容，创建停用配置，失败回滚本次已创建项。每种传输最多32项、总正文2MiB；导入不会启动、授信或代替OAuth。

## 输入选择与授权冻结

`InputRequest`、`QueueInput`、`QueuePatchInput`及`EditInput`使用可选`mcpTools`数组，每Run最多16项。每项为`{serverId,serverRevision,remoteToolName,definitionFingerprint}`，不含程序、环境或秘密。宿主在接受输入前校验工作区、当前目录、scope与授权，再冻结模型定义、选择和profile身份/访问/凭据epoch、授权ID及真实根。

排队输入接受时即保存私有授权；编辑重选产生新输入revision。重试沿用原requestId与原选择，不读取当前界面选择来替换已提交输入。运行中的steer/follow-up必须与当前Run完整冻结集合及授权相同；队列合组也比较这些值。旧授权失效后保留输入并明确拒绝消费，重新信任不能复活旧输入，用户需要明确重选。

本地外部工具仅用于所属工作区；ask/auto对应受监管隔离，full-access使用单独授权。Plan与内部read-only模式仅允许当前用户明确授权的工具定义及精确参数；Server自报readOnlyHint不授予权限。

接受Run时从已启用、已信任的缓存目录冻结最多512个候选和非秘密授权，不启动Server。显式选择最多16项，先进入模型可见集合；Agent可通过tool_search检索冻结候选，再用load_tools加载完整定义，最多64项外部工具同时可见。工具集revision及新定义先写JSONL，下一次真实Pi请求、预算、审计与执行读取同一revision；未加载的候选不能直接调用。新发现或配置变化不修改旧Run内容。

## 调用终态与撤销

`ToolCallRecord.binding`区分accepted来源与rejected模型请求；accepted来源为session、workspace或mcp。MCP来源记录Server ID/revision与原始工具名，定义指纹独立保存；模型别名不反向解析为执行目标。

`dispatch`区分内置/拒绝调用的not_applicable、外部未派发的not_started，以及含attemptId和时间的may_have_started屏障。屏障先持久化，再允许首次tools/call写入；它不证明Server收到或完成操作。只有明确证明没有交给stdin，屏障后取消才可记录confirmedNotWritten。

工具状态增加unknown：屏障后失去可靠结果，操作可能已生效。unknown停止当前Run，保留未消费输入，不自动重试或继续调用其他工具；Todo不能引用它作为完成证据。合法isError结果是已知失败，但不表示副作用回滚。终态及中立私有结果同批提交，晚结果不能覆盖终态，恢复不连接Server或重放工具；持久机制见[会话存储设计](../09_TECHNICAL/会话存储与恢复设计.md)。

普通浏览器退出仅撤销该浏览器登录，不撤销profile级MCP授权或停止已接受Run。显式停用、撤销、凭据删除及profile身份撤销先封禁新租约/写入，再收束所属连接；共享连接被强制回收时，其他已派发未完成调用也分别保守结算unknown。当前受监管stdio执行仅支持macOS，其他平台明确不可用。
