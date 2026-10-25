# 远程MCP协议

远端配置使用独立`RemoteMcpInput/View`，不要求本地工作区，也不填写虚构的启动程序。它与[本地MCP及目录协议](local-mcp.md)共享工具选择、派发屏障、unknown、目录控制与JSON交换；应用身份和CSRF规则继续有效。

## 配置与认证来源

输入为`name`、显式`transport:streamable-http|sse`、`endpoint`、`publicHeaders`、`secretHeaders:[{slotId,headerName}]`与`oauth`。可选`oauthClient`记录预注册Client ID、issuer、scope、是否需要独立秘密及offline参数；可选`connectionId`引用已连接的外部服务账号。服务连接、独立MCP OAuth及静态Authorization互斥。

公开View增加id、revision、accessEpoch、启用/信任/账户连接状态及秘密是否配置；Token、客户端秘密、凭据引用和插件私有归属不返回。配置变化推进版本并取消旧授权，秘密使用新ref写入后CAS，失效/回滚不保留假成功。启用需要重新核对endpoint、传输、认证来源和公开头范围。

界面的“MCP ID”对应name别名，远程配置内不区分大小写地唯一，内部id仍由宿主生成。地址及传输不变且槽位名称匹配时，编辑保留已保存的Header值；修改地址或传输不能沿用原凭据。

只允许HTTPS标准端口、公网目标、无URL凭据或认证查询参数。每次请求验证全部DNS结果，并把所选地址固定到实际socket；禁止重定向及跨origin SSE POST地址。认证头不能进入普通公开头，静态秘密只注入获准来源。OAuth元数据可声明不同的公网授权来源，SDK校验issuer后才使用与其绑定的客户端或令牌。

## 管理接口

以下相对`/api/mcp/remote-servers`。编辑、删除与已保存配置的控制操作携带观察到的revision，控制额外携带accessEpoch；新建和草稿测试不依赖已有版本。

| 方法与路径                            | 行为                                              |
| ------------------------------------- | ------------------------------------------------- |
| GET /、/:id                           | 只读安全配置，不连接上游                          |
| POST /、PUT /:id、DELETE /:id         | 创建停用配置、CAS编辑、删除所属配置及凭据         |
| POST /:id/trust-preview               | 返回规范地址、传输、头名称与指纹，不连接上游      |
| POST /:id/trust                       | 核对指纹后保存profile授权并启用，不调用工具       |
| POST /:id/disable、/:id/revoke-trust  | 先撤销旧授权，再收束所属在途连接                  |
| POST、DELETE /:id/secrets/:slotId     | 写入或撤销静态秘密请求头，需重新确认远端范围      |
| POST、DELETE /:id/oauth/client-secret | 独立保存或撤销预注册OAuth App秘密                 |
| POST /:id/discover、/:id/test         | 用户明确请求后连接并读取目录，不调用具体工具      |
| POST /test-draft                      | 对未保存草稿握手并读取目录，不写配置或授权        |
| GET /:id/tools、/:id/metadata         | 读取当前目录缓存；缺缓存返回null，不隐式连接      |
| POST /:id/oauth/start                 | 返回授权URL、state和过期时间，浏览器显式打开      |
| POST /:id/oauth/disconnect            | 撤销本机MCP OAuth连接，清理账户令牌并使旧绑定失效 |

工具开关及可信只读API见[目录协议](local-mcp.md#目录控制与json交换)。插件安装的Server归属只在宿主私有记录保存，清理按稳定Server ID与归属匹配，不根据名称删除手动配置。授信、目录冻结和实际调用要求插件已完成安装、插件与App均启用，且组件referenceId仍精确指向该Server；停用或安装未提交的配置不能在MCP页面重新授信绕过插件控制。

草稿测试输入为严格的`{transport,endpoint,headers}`，沿用登录与CSRF校验，临时Header不写凭据库。30秒内通过SDK初始化并读取tools/resources/prompts目录，只返回`connected:true`、三类数量和elapsedMs；取消、超时及认证未完成返回安全错误。测试不复用按ID查找的旧秘密，不创建Server、信任、目录缓存或JSONL，也不自动开始OAuth。

## OAuth与调用生命周期

回调为当前daemon监听地址的`GET /api/mcp/oauth/callback`，允许`code/state/iss/error/error_description`，拒绝未知字段。回调不依赖第三方Origin或应用Cookie，而由单次state验证profile owner、身份epoch、Server revision/accessEpoch、有效期和回调流程。错误或成功都会消费state，issuer混淆在兑换授权码前拒绝；state十分钟过期，同时最多32个流程。

SDK负责发现、PKCE和OAuth语义，宿主把秘密保存在系统凭据库。刷新按同一授权串行；过期或权限扩大需要新的明确连接动作。账户连接状态不代表某个工具已获逐次批准。应用退出登录保留profile授权，MCP断开、Server撤销及外部账号断开分别使对应来源失效。

调用使用真实SDK Transport，发送前先提交JSONL屏障，每个attempt只发送一次。断线、超时、坏响应或取消发生在可能派发之后且没有可靠结果时，保存unknown、停止Run，不自动重试或消费后续输入。远端取消不能证明上游撤销副作用。SDK OAuth错误经过安全映射，不把上游错误正文或cause带入UI和日志。

本机HTTP/SSE及OAuth协议fixture与真实第三方账号验收分开记录。Vercel等上游可能要求客户端审核，Google需要预注册OAuth App；官方地址核对和限制见[实现Spec](../04_FEATURES/202610201932_feature_m4-capabilities/mcp-expansion.md#官方服务地址核对)。
