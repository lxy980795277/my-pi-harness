# 插件授权与只读网关

每个内置服务插件拥有一份授权，Skill网关和声明为plugin-oauth的MCP App共用它。应用登录、模型和通用MCP独立OAuth不读取该凭据。公开schema由`packages/protocol/src/extensions/skill-connections.ts`拥有，宿主声明由integrations的插件manifest拥有。

## HTTP

| 方法与路径                                                      | 输入与结果                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GET `/api/skill-connections/:collectionId`                      | `{collectionId,isConnected,account}`，account包含id、username、displayName、avatarUrl或为null |
| POST `/api/skill-connections/:collectionId/oauth`               | 无body或`{}`；返回`{authorizationUrl}`                                                        |
| GET `/api/skill-connections/:collectionId/oauth/callback`       | state、code或error、可选iss；完成后303跳转`/skill-oauth/result`                               |
| DELETE `/api/skill-connections/:collectionId`                   | 断开该插件，204                                                                               |
| POST `/api/skill-connections/:collectionId/oauth/launch-ticket` | 受登录与CSRF保护；返回`{launchUrl,expiresAt}`                                                 |
| POST `/api/skill-connections/:collectionId/oauth/launch`        | `{ticket}`；一次性兑换后返回授权地址，不创建应用登录                                          |
| GET `/api/skill-gateway/:collectionId/*`                        | 宿主私有能力头校验后读取允许的供应商路径                                                      |

除OAuth回调、受限ticket兑换和私有网关以外，接口要求原应用登录与CSRF。回调按随机state、插件、profile身份及安装代检查，10分钟过期并一次性消费。客户端信息不接受浏览器提交。状态读取在临近到期时按插件单飞刷新；过期前60秒开始刷新，明确授权失效删除凭据，临时供应商错误保留明确失败。

回调失败按授权响应校验、Token交换、账号读取、流程状态或本机凭据保存返回固定提示。daemon日志只记录请求关联ID、插件ID、有限phase/reason及可选上游HTTP状态；未知错误降为内部异常，不记录供应商正文、error_description、URL参数、Token、Secret、磁盘路径或原始cause。结果页使用同一固定文案，不能把所有失败归为授权过期；重新授权始终创建新state，不重放旧授权码。

## 客户端与凭据

`MY_PI_HARNESS_SKILL_<SERVICE>_CLIENT_ID`和`_CLIENT_SECRET`成对覆盖插件声明，SERVICE为GITHUB、GOOGLE、NOTION、SUPABASE或VERCEL；可选`_CALLBACK_URL`必须是该插件所属回环回调路径。不回退到应用登录客户端。缺少配置明确报错，页面不显示配置表单；实际示例见根`.env.example`。

GitHub请求repo/user；Google包含身份与Drive、Docs、Sheets、Slides、Calendar的声明权限，offline/consent，从id_token读取账号。Notion使用Basic与JSON换码且不启用PKCE；其他供应商按插件声明选择认证格式与账号来源。秘密及完整账号凭据保存在profile的`skill-credentials.json`，按插件ID保存、0600、原子替换；私有owner/identityEpoch/安装代阻止旧归属恢复。Token不返回DTO、浏览器、模型、日志或导出。

OAuth发行者由宿主manifest的`oauth.issuer`显式声明，独立于授权端点；回调携带iss时必须精确匹配，不携带时仍校验一次性state。GitHub发行者为`https://github.com/login/oauth`，不能截断为域名origin；不信任回调提供的发行者来配置校验器。错误发行者在Token交换前拒绝，只输出固定诊断，不回显收到的值。

## 窗口与桌面

浏览器点击授权同步打开`/skill-oauth/:id/launch`；该独立页面读取应用认证后自行POST并跳转供应商。主窗口每秒查询连接状态，每500毫秒检测关窗，关窗结束等待。成功后刷新账号及Apps；默认页面没有账户添加、选择、绑定、取消或重开控件。

Electron沿用系统浏览器。Renderer先申请10分钟一次性启动ticket，本地启动页从fragment提取后立即删除fragment，再POST兑换。ticket绑定插件/Server、身份和版本，不含应用Cookie或供应商Token；过期、重放、目标或身份改变均拒绝。独立MCP对应`/mcp-oauth/:id/launch`和`/api/mcp/remote-servers/:id/oauth/launch-ticket`、`/oauth/launch`，结果同样回到统一页面。系统浏览器没有可供Renderer观察的WindowProxy，桌面等待以连接状态与到期收束。

## Skill与MCP消费

Skill接受时冻结公开gatewayUrl并写入Run私有接受事实及模型上下文；不改磁盘Skill正文/hash。宿主web_fetch仅对精确daemon origin及`/api/skill-gateway/<id>/`附加私有能力头并允许回环访问，模型不能传认证头。普通浏览器、应用登录Cookie或其他回环地址不能代替该能力。

网关只允许插件声明的只读路径与查询，声明的查询接口可转换为受限JSON POST；10秒、5MiB、禁止重定向。供应商Token只加到固定上游，不转发网关私有能力头。写操作通过单独开启的MCP App及原工具审批执行，不再有固定REST操作目录或逐Run服务grant工具。

GitHub/Google App直接按精确插件归属和官方endpoint读取同一Token；其他声明为独立OAuth的App保留MCP自身凭据。安装不启动App，App开关显式开启并信任已安装的固定服务配置；授权变化先清空目录并回收旧SDK连接，再由受管后台任务刷新已开启App，授权结果页和账号状态不等待发现完成，不自动开启其他App。后台任务按App替换，停用取消其所属发现，卸载与退出等待任务收束；意外失败只报告固定诊断，不记录上游正文或Token。断开、卸载和刷新结果发布按拥有者复核，不误删其他插件或手动账户。
