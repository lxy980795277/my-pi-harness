# 应用身份与登录协议

共享协议版本见[API入口](overview.md)，schema由`packages/protocol/src/auth.ts`拥有。应用登录、模型Provider OAuth与MCP/服务启动授权分别管理；应用登录不会创建模型或GitHub仓库访问凭据。

## 访问控制

业务API需要同时提供本机信任Cookie `my_pi_local`与应用登录Cookie `my_pi_session`，后者绑定前者的clientId。Cookie均为HttpOnly、SameSite=Strict、Path=/api；本机信任最长90天，应用会话最长30天且不超过所属客户端有效期。原始token不进入DTO或数据库，SQLite仅保存SHA-256哈希。有效期绝对计算，GET不续期。

Host必须对应实际回环监听器或自有开发页面；有Origin时必须准确匹配，写请求必须携带合法Origin与当前本机客户端CSRF到`X-CSRF-Token`。桌面bootstrap使用私有启动secret，不要求浏览器Origin；普通浏览器不能用它替代登录。所有API响应禁止缓存。

`health`和`runtime/events`只公开脱敏进程状态。`auth/status`、一次性配对和桌面bootstrap允许未登录调用；登录流程及退出只要求本机信任和写入CSRF。其余Provider、设置、工作区、附件、会话、工作状态与模型授权接口同时检查应用登录，私有SSE也不例外。未授本机信任返回401 `LOCAL_AUTH_REQUIRED`，未登录/已失效返回401 `LOGIN_REQUIRED`，来源或CSRF拒绝为403。

## DTO

| 类型             | 字段与含义                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| AppUser          | `id`内部用户ID、`name`展示名、`avatarUrl`可空；不公开外部subject                                                                     |
| LoginProvider    | `id/name/available/methods`；available表示有Client ID，methods列出可用的device/web方式，不表示上游账号已授权                         |
| LoginSessionInfo | `id/providerId/expiresAt`；会话ID不是bearer，expiresAt为毫秒                                                                         |
| AuthStatus       | `localAuthorized/authenticated/csrfToken/providers/profileBound/user/session`；未信任无CSRF，未登录无user/session                    |
| LoginFlow        | `id/providerId/status/url/deviceCode/expiresAt/error`；状态pending/completed/failed/cancelled；验证码为GitHub用户码，不是device_code |

## 端点

| 方法与路径                              | 输入                                             | 结果                                                                                 |
| --------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| GET /api/auth/status                    | 无                                               | AuthStatus；只读，不签发Cookie                                                       |
| POST /api/auth/pair                     | `{code}`                                         | 一次性建立本机信任，返回AuthStatus与本机Cookie；仍未登录                             |
| POST /api/auth/desktop                  | `{secret}`                                       | `{ok:true}`与本机Cookie；可复用仍有效客户端，不签发登录Cookie                        |
| POST /api/auth/login                    | `{providerId,method}`                            | LoginFlow，首版providerId为github；method为device/web，缺省device                    |
| GET /api/auth/callback/:providerId      | GitHub `state/code` 或 `state/error`，可含 `iss` | 校验回调专用 Cookie、state及PKCE，303至发起页面 `/?login_flow=...`；不签发应用Cookie |
| GET /api/auth/login-flows/:id           | 所属客户端                                       | LoginFlow；其他客户端404                                                             |
| POST /api/auth/login-flows/:id/complete | `{}`                                             | 一次性消费已验证身份；AuthStatus与应用Cookie                                         |
| DELETE /api/auth/login-flows/:id        | `{}`                                             | 取消并等待所属任务收束，204                                                          |
| POST /api/auth/logout                   | `{}`                                             | 撤销当前客户端全部应用会话并取消其登录流程，清除登录Cookie，返回`{ok:true}`          |
| POST /api/auth/pairing-code             | `{}`；应用登录                                   | `{code}`；只在既有挑战过期时更新挑战                                                 |

配对挑战10分钟有效，使用后替换。每分钟最多5次尝试，超过返回429。配对码仅在直接运行daemon的交互终端或已登录页面展示，不进入普通日志和公开启动记录。

## 登录与恢复

Electron Device Flow由daemon发起和轮询；Web使用授权码+state+S256 PKCE。Web缺少Client Secret时methods不包含web，不能静默改用Device Flow。只有流程所属本机客户端可以读取/完成/取消。GET观察到completed表示身份已验证；只有POST complete才能生成应用会话。重复完成返回409，过期或已取消不能重新发放。账号与profile不匹配返回409 `PROFILE_ACCOUNT_MISMATCH`，不设置Cookie、不修改原归属。

Web发起接口要求本机信任与CSRF；再次显式发起会取消同客户端未完成的Web流程，旧state/nonce立即失效；callback与发起页面hostname不同在跳转前拒绝，端口可不同。callback仅凭限时、一次性的随机state和回调nonce定位原客户端。nonce由HttpOnly、SameSite=Lax、仅callback路径可用的Cookie持有，避免依赖跨站回调不携带的Strict业务Cookie；PKCE verifier只留内存。callback验证身份后返回发起页面，由该页面带Strict Cookie和CSRF同源POST complete。授权码、token与verifier不进入URL返回、DTO或持久化；请求日志不记录query。错配、重放、取消或超时不会签发会话。

OAuth回调的查询字段遵守上游协议：可选 `iss` 由宿主流程与适配器声明的 `authorizationIssuer` 精确比较，GitHub为 `https://github.com/login/oauth`；不匹配在兑换code前返回400 `LOGIN_ISSUER_MISMATCH`。未携带iss时仍执行绑定state/nonce/PKCE验证。该授权服务器标识不替换持久外部身份的issuer。仅此OAuth响应查询允许未知扩展并忽略它们，已知参数的类型、长度及重复值仍严格拒绝；普通业务接口不放宽字段约束。依据：[RFC 9207](https://www.rfc-editor.org/rfc/rfc9207.html#section-2.4)、[RFC 6749](https://www.rfc-editor.org/rfc/rfc6749.html#section-4.1.2)。

插件OAuth使用独立客户端、凭据与回调，见[插件连接协议](plugin-connections.md)。应用登录回调不再分发插件state，也不读取插件凭据。

临时授权流程不跨daemon重启恢复；用户重新开始登录。持久客户端和应用会话可以用原Cookie恢复，有效本地登录无需访问GitHub。离线使用不表示已检查上游撤销；本地退出只撤销本地客户端会话，不自动撤销GitHub侧授权，不删除业务数据。

退出立即撤销数据库记录，再取消所属流程；晚到验证结果不能签发会话。私有SSE在撤销或到期时结束；客户端重新读取status并清理私有缓存、导航和草稿。已接受后台Run保留，未登录无法读取或响应审批。传输网络失败与401区分：网络失败不能自行撤销仍未到期的本地登录。

## 桌面浏览器入口

`DesktopBridge.openAuth(flowId)`仅接受流程ID。`login_`前缀查询应用登录端点，其余ID查询模型授权端点。main每次从当前Renderer的Cookie存储读取两种Cookie，daemon检验流程归属后返回公开授权地址，main校验HTTPS与无URL凭据，再交系统浏览器；Renderer不传任意URL。

GitHub配置、profile归属及使用步骤见[登录指南](../07_USER_GUIDE/application-login.md)，设计与扩展位置见[用户身份与登录设计](../09_TECHNICAL/用户身份与登录设计.md)。
