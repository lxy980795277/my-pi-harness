# Integrations

`@my-pi-harness/integrations` 使用官方 `@modelcontextprotocol/client` 2.3.1，将本地 MCP stdio 连接适配到 sandbox 的受监管双向进程，并通过官方远端Transport提供Streamable HTTP与显式兼容SSE。它不依赖数据库、Agent Runtime、Fastify 或 React；配置、系统凭据、启动授权与 JSONL 事务由 daemon/storage/runtime 拥有。

## 源码组织

`src/index.ts`仅导出包API；`mcp/`拥有本地与远端连接、传输、目录及快照、协议schema和结果投影，`network/`拥有MCP、服务OAuth与联网服务共用的受控远端网络访问及其RemoteFetch接口，不依赖某一消费协议的请求类型。`oauth/`拥有通用授权码、PKCE、Token交换、刷新和安全错误，`connections/`提供独立服务账户的凭据编码与协议适配，`web/`负责DeepSeek网页搜索与正文提取。McpError、NetworkError和WebServiceError由各自领域的errors模块定义。插件声明、资源与授权生命周期由[plugins](../plugins/README.md)拥有；本地工具搜索Worker由daemon拥有，本包不承接插件安装或本地模型推理。

## 网页搜索与正文

`DeepSeekWebClient`调用固定的官方`https://api.deepseek.com/v1/tools/search`和`/v1/tools/fetch`，分别映射结构化搜索结果和Markdown正文；默认传输复用`createRemoteFetch`的公网DNS全结果检查、socket固定与来源限制。调用者显式传入独立的官方Key，不读取环境、模型配置或当前聊天供应商凭据。两个接口在业务上都是只读操作，不能按其HTTP POST推断为写操作；原始HTTP/API请求和精确本地Skill网关仍由tools拥有，不经过DeepSeek。

网页目标只允许无认证信息的HTTP(S)标准端口；上传URL前验证全部本机DNS结果为公网，拒绝本地网关、私网与保留地址。搜索文本只检查其中可识别的HTTP(S)引用，拒绝本地/私有字面地址、已知本地域名与URL认证信息，不解析普通查询、不为示例域名做DNS，也不承诺识别任意私人文本。提取由第三方执行，不能以本机地址检查承诺控制其后续DNS或重定向，也不承诺浏览器脚本执行。

每次公开客户端操作拥有一个60秒截止，覆盖目标检查、HTTP和正文读取；内部POST继承该信号，不重复创建截止。daemon可施加更短的产品请求截止。响应总量4MiB并校验UTF-8、JSON与必需字段；搜索空数组和网页空标题是合法结果。API响应schema由web适配器本地维护，校验后映射protocol/internal的宿主结果接口；公开protocol只声明模型搜索输入和跨端配置DTO。内容是外部不可信文本，工具负责模型输出的截断和来源呈现。失败仅保留固定安全分类及HTTP状态，不回显上游正文、Key或cause；正文释放失败不覆盖已经确定的HTTP、格式或取消错误。取消贯穿DNS、传输和读取，调用不会自动重试或切换到原始请求。设置保存凭据本身不发起付费探测。API字段与供应商限制以[官方Search](https://api-docs.deepseek.com/zh-cn/api/search/)和[Fetch](https://api-docs.deepseek.com/zh-cn/api/fetch/)文档为准。

## 启动与租约

`previewLaunch` 只解析真实工作根、绝对可执行程序和程序身份，不启动进程。启动指纹包括参数、普通环境、秘密 slot/ref/epoch、隔离范围和资源策略，排除秘密字节。daemon 在每次租约前核对 profile 身份、配置 revision、access/credential epoch 与对应范围的授权，再调用 `acquire`。同进程调用者仍负责这些持久权限事实。

`acquire` 在任何异步初始化之前登记租约；同一冻结授权复用一条连接。目录发现也是租约，最后一个租约释放会等待进程组、管道与临时目录回收；回收完成前仍报告忙碌，普通配置修改不能提前进入。`invalidateServer` 同步封禁旧连接与写入，再异步等待回收；不能使用取消通知证明外部副作用已经停止。普通释放只影响所属租约，强制回收会使同连接的未完成已派发调用分别变为 unknown。默认最多 8 条连接、每条 16 个租约、8 个在途调用，超限明确拒绝。

连接使用显式 legacy 协议握手，不探测、不自动履行交互，不声明 sampling、elicitation、roots 或异步任务能力。SDK 负责协议校验、请求配对和取消通知；自有 Transport 仅负责受监管字节通道、有界 LF 分帧、严格 UTF-8 与一次写入许可。每秒最多 1024 帧、突发 2048 帧、连接累计 65536 帧，合法小帧洪泛同样受限。stdout 污染、半帧 EOF、坏帧和输出超限使连接失效；原始 stdout 不落盘。stderr 保留有界环形诊断，已知秘密的直接回显不会进入目录、结果或安全错误。

## 目录与调用

逐页 `tools/list` 最多 16 页、512 个工具、累计 2 MiB，拒绝重复 cursor 和名称。完整 SDK Tool 被复制冻结并计算定义指纹；后续新进程必须重新发现，实际调用只接受与原冻结定义相符的工具。`callTool` 始终传完整 `toolDefinition`，不读取新的目录替换已接受定义。

首版输入/输出 schema 接受可由真实 TypeBox 构造并编译的 draft-07 子集：显式 object/array/标量、对象 required/additionalProperties、数组长度/uniqueItems、字符串长度、有限数值约束、标量 enum/const 与 anyOf。根必须是 object，单项 64 KiB、深度 16；引用、正则、format、混合类型约束及不支持的方言明确不可选，不以类型断言冒充可执行 schema。测试通过 Pi 的实际参数验证确认等价拒绝。

`lease.call` 由调用者提供 `callAttemptId` 和 `beforeDispatch`。首次 `tools/call` 写入之前等待该回调完成持久屏障；SDK 提前拒绝或取消会撤销未使用的许可；已交给 stdin 而没有合法结果时，先启动真实通道回收，再等待已登记 send 任务收束，避免背压写入与关闭互相等待。队列结束、实际 stdin.write 前再次检查取消；每个 attempt 只许可一次发送。持久化异常原样交回拥有者，不能转换成普通工具失败。

返回值区分 `known`、`not-dispatched` 与 `unknown`。只有明确没有交给 stdin 才报告未派发；已经写入而没有合法有界结果时报告 unknown，并回收连接。宿主独立 deadline 默认 120 秒，不只依赖 SDK timeout。已知 `isError` 是明确错误结果，不承诺副作用回滚。unknown 不自动重试。

文本/图像块使用protocol/internal的ToolContent，McpCallOutcome继续独立表达known、not-dispatched与unknown；投影结果最多 128 个 content 块，附加 structuredContent 同样计入。文本与 structuredContent 共同进入最多 128000 字符的模型文本；图片总量 2 MiB，仅接受标准 base64 且签名匹配的 PNG/JPEG/GIF/WebP，不承担完整图像解码，是否进入模型及受保护附件由 runtime 决定。资源链接只作为标明未读取的文本，嵌入文本保持来源；音频与嵌入二进制仅说明类型，不自动抓取外部资源。

## 远端连接与OAuth

`RemoteMcpManager`每个租约建立独立SDK连接，不把本地进程策略或工作区要求带到远端。默认最多8条连接，每租约最多8个在途调用和64个attempt；完成后释放等待传输关闭。远端调用同样先等待`beforeDispatch`持久屏障，受控fetch按attempt仅允许一次tools/call POST；SDK认证重试、重新握手或断线不重发已派发操作。Streamable HTTP自动重连关闭，SSE只用于明确选择的兼容Server。

`createRemoteFetch`只允许HTTPS标准端口与公网DNS结果，逐次固定实际socket地址，拒绝URL凭据、认证查询参数、私网/保留地址、重定向、未授权来源和受限请求头。地址判定、可取消DNS全结果校验和Node socket固定复用sandbox/network；远端传输提供公网策略并保留安全NetworkError映射，IPv4-mapped IPv6继承内嵌IPv4的公网/禁止范围，全部A/AAAA均通过才创建socket。MCP传输及OAuth开启严格UTF-8检查；请求正文4MiB、响应流8MiB、有界DNS与120秒请求截止贯通取消。`fixtureOrigin`仅是宿主测试注入的精确回环来源，不出现在产品配置或环境开关中。静态认证不会转发至另一origin，原始响应和SDK错误cause不进入诊断。

`RemoteOAuthSession`实现公开OAuthClientProvider，使用SDK的发现、授权码、PKCE、issuer校验和刷新。调用Transport只获得已解析的Bearer字节，不持有交互Provider，因此401不能自动重新授权并重复工具调用。宿主保存单次、有界、身份/配置绑定的state与回调拥有者；令牌和客户端信息通过秘密端口保存。预注册客户端支持独立Client Secret、scope和Google offline参数。MCP OAuth与应用登录、Provider连接各自拥有记录；服务连接的临时token由daemon内部端口共享，不复制到公开配置。

目录按Server能力发现tools/resources/prompts；没有tools能力的Server仍可提供只读元数据。后两类每类最多16页、512项，共计2MiB，拒绝重复URI/名称/cursor与秘密回显。目录结果不触发资源正文读取或Prompt执行。

`encodeMcpCatalog`只编码经发现验证的协议定义及元数据，不序列化运行时schema对象；`decodeMcpCatalog`对宿主持久快照重新执行官方SDK结构、数量、名称唯一性与有界JSON校验，并重建输入schema和定义指纹。当前不支持的schema仍显示为不可选择，恢复目录不创建连接，也不建立任何启动或调用授权。

## 验证

包级 `typecheck`、`lint`、`test` 在真实临时工作根运行。fixture 使用同版本官方 Server，通过实际 stdio 覆盖成功、已知错误、派发屏障、超时、共享租约、撤销、坏协议、目录界限与秘密回显；执行进程生命周期测试由 sandbox 拥有。macOS 是当前实际验证平台；Windows/Linux 的受监管 stdio 明确不可用，真实第三方 MCP Server 与账户另外验收。

## 服务OAuth

`oauth/authorization-code`通过oauth4webapi生成state、PKCE和校验回调，使用固定声明执行form/JSON Token请求与body/basic客户端认证。声明显式提供issuer；回调iss存在时精确匹配，未提供仍校验state。授权流程单次消费，调用者拥有有效期、账号归属、取消与凭据保存。网络统一经过createRemoteFetch的来源、地址、大小与截止时间检查。Basic客户端认证使用SDK的表单编码；Token响应按grant调用SDK授权码或刷新校验，保留nonce、issuer、audience及字段类型检查。零秒expiry保留为立即过期，超出支持范围明确拒绝，不将错误字段转换为永久Token。

OAuthError仅包含有限阶段、原因、固定安全提示和可选HTTP状态；未知供应商正文、网络消息和cause不保留。无效刷新grant抛出独立OAuthRefreshRequiredError，由账号拥有者撤销对应凭据。Token响应含error时，即使HTTP成功且同时包含Token也拒绝使用。

插件授权和高级多账户通过同一OAuth机制执行，分别保留自己的身份、安装归属与权限策略。插件的声明与账号展示字段在plugins维护；高级账户适配只编码私有Token及scope，不保存插件安装状态，也不处理HTTP回调。插件适配显式允许缺失token_type并将id_token仅作为账号展示字段；已提供Token类型、刷新字段和scope仍校验。高级账户不启用这些响应策略，保留严格SDK校验。独立MCP OAuth继续使用SDK公开Provider进行发现、PKCE和刷新，不与固定服务端点的授权实现混用。
