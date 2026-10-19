# 用户身份与应用登录

## Spec

### Roadmap Alignment

M4 前置专项，先于 M4.1 实现。M4.1–M4.9 已获用户确认，功能范围和编号保持不变；本专项完成后继续本地 MCP。M2 已暂缓的 Windows Shell、浏览器新增目录和 M5–M7 不纳入本次。状态：根 `.env` 配置与 Web/桌面 OAuth 分工已按标杆修正并完成本机自动化；待用户真实GitHub及体验review；用户授权连续设计、开发与验证，最后统一 review，不自动提交。

### Intent

将现有“本机授权后可选补充 GitHub 昵称”改为全系统统一的真实登录。桌面和本机浏览器经过本机信任后，以 GitHub 验证身份并获取可恢复的应用会话。身份模型支持后续增加登录来源，应用登录与模型/MCP/外部服务的授权分别管理。

### Constraints

- 保持独立本地 daemon，不新增云端服务。对齐标杆：Web 使用授权码 + state + S256 PKCE，Electron 使用 Device Flow 并自动打开系统浏览器。配置由仓库根 `.env` 提供，进程环境优先；移除 TypeScript 内置 Client ID。Web 另需 Client Secret 和匹配的 callback，缺失时明确不可用，不降级 Device Flow。桌面打包只提取公开 Client ID 到 `desktop-oauth.env`，不得携带根 `.env`、Client Secret 或其他凭据。GitHub.com OAuth App 为本轮唯一提供方。
- GitHub 只验证身份，申请 `read:user`，使用 `/user` 的稳定数值 ID 作为 subject，不以用户名、头像或邮箱识别/自动合并用户。Access token 查询身份后丢弃，不保存为 M4 GitHub 工具凭据。授权超时、拒绝、取消、轮询间隔与 slow_down 有明确处理；网络响应有时限与大小上限。
- `User` 拥有内部 userId；`ExternalIdentity(providerId, issuer, subject)` 唯一关联 User；`AuthSession` 关联 User 与本机客户端。Provider 适配器输出统一 VerifiedIdentity，登录编排不包含 GitHub 特有参数。首版只注册 GitHub，不预建其他登录入口或账号合并功能。
- 单 profile 单账号：首次已获本机信任的用户登录时，在同一 SQLite 事务内绑定 profile、创建身份和会话，接管既有本机配置与会话，不修改工作区文件。不同 subject/provider 不可自动继承；拒绝换号且不改变原绑定。未来增加身份绑定须在已登录账号内显式验证，不按相同 email 自动合并。本轮不做多人共享、云同步或清空/转移归属功能。
- 本机信任与应用登录分别保存。配对/桌面私有启动链只授予本机客户端资格，业务 API 还必须验证应用会话。信任 token 与登录 token 只以哈希写 SQLite；CSRF token 归本机客户端，原始 bearer 只由 HttpOnly、SameSite=Strict、Path=/api Cookie 持有，不进入 URL、JSONL、日志、前端 Query/Zustand/LocalStorage。登录会话绝对有效期 30 天，本机客户端 90 天，过期明确要求重新授权。
- 桌面重启复用其持久 Cookie 中仍有效的本机客户端；bootstrap 不自动签发应用登录或绕过 GitHub。浏览器已配对客户端与登录事实可跨 daemon 重启恢复；有效本地会话离线可用，不暗示已经检测 GitHub 侧撤销。
- 登录流程绑定本机 clientId，最多一个在途流程；显式重新发起 Web 登录替换该客户端旧的未完成 Web 流程，旧回调立即失效，Device 流程仍要求取消后重试；不同客户端不得读取、完成或取消它。临时流程不跨重启恢复。GET 查询不签发会话；POST complete 一次性消费已验证身份并设置 Cookie。重复完成、过期、取消、退出后返回、关闭时在途响应均不得恢复已撤销权限。退出撤销当前客户端全部登录会话并取消该客户端流程，保留本机信任用于再次登录。
- Web 临时流程绑定原始本机 clientId、state、PKCE verifier 与随机回调 nonce；回调 hostname 必须与发起页面相同，允许不同端口，配置不匹配在跳转前明确拒绝；nonce 使用短命 HttpOnly、SameSite=Lax 回调专用 Cookie。跨站回调不依赖 Strict 本机 Cookie，不直接签发会话；返回页面后由同源客户端 POST complete，避免 URL 中出现登录 token。拒绝、重放、错配或取消不得完成；请求日志去除 query，避免记录授权码。
- daemon 统一校验 Host/Origin、本机信任、应用登录与写入 CSRF。仅 health/脱敏进程事件及必要授权接口例外。Provider OAuth、设置、附件预览、工作区、会话和私有 SSE 均受保护；登录失效关闭私有 SSE，客户端及时清理查询、草稿、导航和传输授权。已接受的后台 Run 继续持久运行，未完成审批/提问需重新登录才能操作，退出不自动重执行或取消副作用。
- Renderer 只消费公开 DTO，不接触 GitHub token、device_code 或 Cookie 原值。Electron 系统浏览器入口只根据所属流程 ID 从 daemon 读取并验证 URL，不开放任意 openExternal；模型授权与应用登录使用分开的 API。
- 本轮不删除用户数据、不运行真实用户 OAuth、不自动 commit/push。真实 GitHub 授权由用户最终 review；keyless 测试注入可控 GitHub 响应但保持真实 HTTP、Cookie、SQLite 和页面链路，不增加生产登录绕过配置。

### API 与数据流

公开 `AppUser = { id, name, avatarUrl }`。`AuthStatus = { localAuthorized, authenticated, csrfToken, providers, profileBound, user, session }`；providers 为 `{ id, name, available, methods }[]`，methods 为当前可用的 `device` / `web` 登录方式，session 为 `{ id, providerId, expiresAt } | null`。未登录不暴露 profile 用户资料。登录流程单独使用 `LoginFlow = { id, providerId, status, url, deviceCode, expiresAt, error }`，status 为 pending/completed/failed/cancelled，ID 使用 login\_ 前缀，公开 deviceCode 是用户验证码而非协议 device_code。

| 接口                                    | 前提                                      | 结果                                                               |
| --------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| GET /api/auth/status                    | 合法本机来源                              | 读取信任和应用登录；不创建 Cookie                                  |
| POST /api/auth/pair                     | 合法 Origin + 一次性配对码                | 仅建立本机信任，返回 AuthStatus                                    |
| POST /api/auth/desktop                  | 私有启动 secret                           | 建立/复用本机信任，不自动登录                                      |
| POST /api/auth/login                    | 本机信任 + CSRF；`{ providerId, method }` | 返回 LoginFlow                                                     |
| GET /api/auth/callback/:providerId      | 一次性state + 回调专用Cookie              | 校验授权码/PKCE，303返回 `/?login_flow=...`，不签发应用Cookie      |
| GET /api/auth/login-flows/:id           | 流程所属本机客户端                        | 读取流程                                                           |
| POST /api/auth/login-flows/:id/complete | 所属客户端 + CSRF；`{}`                   | 一次性签发应用会话 Cookie，返回 AuthStatus                         |
| DELETE /api/auth/login-flows/:id        | 所属客户端 + CSRF                         | 取消流程；204                                                      |
| POST /api/auth/logout                   | 本机信任 + CSRF；`{}`                     | 撤销当前客户端登录、取消流程并清理登录 Cookie；不删除信任/业务数据 |
| POST /api/auth/pairing-code             | 应用登录 + CSRF；`{}`                     | 为另一浏览器生成一次性配对码                                       |

SQLite 新增用户、外部身份、profile 归属、本机客户端和应用会话事实；均不参与会话投影重建。采用独立 schema migration，不创建旧身份兜底。登录/绑定/撤销使用同步事务，不在事务内等待网络。哈希查询、有效期和归属在每次受保护请求及 SSE 生命周期中校验。

### UI

未取得本机信任显示原配对页；已信任未登录显示独立紧凑登录页，不加载工作区/模型等私有查询。GitHub 未配置时明确显示所选入口缺失的配置项，不降级 mock。Web 同页跳转 GitHub，回调恢复临时流程并同源完成登录；Electron 启动 Device Flow 后自动打开系统浏览器，并保留手动重开按钮。登录页包含品牌、GitHub 登录按钮、授权验证码/打开 GitHub、取消/重试和必要错误；无冗余限制说明。桌面从系统浏览器打开，普通浏览器同页跳转受控授权地址。登录后卡片显示实际头像/姓名；点击信息卡片向上弹出菜单，第一项设置、第二项退出登录，分别使用齿轮与退出图标，退出项使用危险操作色。选择后关闭菜单并打开设置或退出确认弹窗，Esc/点击外部关闭菜单、键盘可达，打开弹窗后焦点进入弹窗；移除侧栏原有独立退出图标。刷新/启动显示检查态；失效/退出回登录页并清理私有缓存，主题偏好保留。

登录视觉按2026-10-18用户参考图调整：居中窄卡、圆角浅边与轻阴影；顶部复用项目现有Logo，标题“登录”与说明“使用 GitHub 账号登录进入”居中；下方为GitHub品牌Logo加“使用 GitHub 登录”的描边圆角长按钮。复用现有静态品牌资产，保持浅/深主题，配置提示、授权验证码、等待、错误、取消与重试延续同一卡片样式；不改变登录协议。

GitHub真实Web回调包含RFC 9207的 `iss`，允许读取这个字段，并在兑换授权码前与身份适配器声明的授权服务器issuer精确比较；缺省时仍由已绑定的state/nonce/PKCE验证当前GitHub流程，不把持久身份issuer改为OAuth端点地址。OAuth回调按RFC 6749忽略未知响应扩展，仅此查询允许扩展；已知参数仍校验类型、长度与重复，错误issuer不得请求上游或签发会话。验收包含正确issuer成功、错误/重复issuer拒绝、未知非安全扩展不阻断、原state/nonce/PKCE/取消和重放规则不变。

网页授权URL显式带 `prompt=select_account`，让GitHub展示账号选择页；其他state/PKCE/issuer和profile账号归属规则继续适用，选择不同账号不自动继承已有profile。用户信息菜单在信息卡片上方起始边对齐，属于当前Popover默认下方规则的明确业务例外；复用现有shadcn基础控件，不增加另一套UI。

退出菜单先打开“确认退出登录？”弹窗，展示警示图标、需要重新登录的简短说明，以及取消/红色退出按钮；只有确认才调用现有退出流程。取消或Esc保留登录、草稿和页面，并将焦点还给用户卡片；打开弹窗后焦点留在弹窗内，默认落在取消按钮。

登录卡片在请求发起与网页跳转期间保持原布局，GitHub按钮禁用并显示“正在前往 GitHub…”，保留品牌图标；收到Web流程后到页面离开前继续保留这个状态，不闪现只有取消/重登按钮的空授权面板。授权返回同源完成时显示“正在登录…”；实际拒绝、网络失败或离开授权页后返回仍可取消/重试，Electron设备码与等待授权交互保持可用。不增加人为等待，不修改登录协议。

### Acceptance Criteria

- AC-01：Provider 注册与三类身份/会话数据分工明确，稳定 GitHub subject 对应稳定内部 User；更名不创建新用户，另一账号拒绝，首次绑定原子且重启后保留。
- AC-02：桌面/配对只授信任，未登录业务 API/SSE 均 401；用户登录后原有设置、会话、附件、工作区正常使用，跨来源/缺 CSRF/伪造登录拒绝。
- AC-03：Web 授权码/PKCE/state/nonce/重放与 Device Flow 协议经可控响应验证成功、pending、slow_down、拒绝、超时、取消和无效身份；凭据不进入公开响应/日志/SQLite明文，流程严格绑定客户端且一次性完成。
- AC-04：真实 Cookie/SQLite 登录在 daemon 重启及离线时恢复，过期/退出立即失效；桌面 bootstrap 复用信任且不恢复已经退出的应用会话。
- AC-05：退出/过期关闭私有 SSE，页面清理私有缓存与草稿；已接受 Run 不因退出被重放或取消，未登录不能审批/读取。
- AC-06：Web/Electron共用登录UI，无 mock 兜底；配置缺失、检查态、授权态、重试/取消、真实头像、退出/重新登录可验收。浏览器自动化保留截图，真实GitHub与原生Electron分别记录证据。
- AC-07：相关静态检查、存储与HTTP行为、keyless页面用例及受影响M1–M3回归通过；文档说明配置、首次归属、离线和撤销范围，未验证项明确记录。

## UseCase

| UC    | 前置与操作                                                      | 预期与异常                                                                                                   |
| ----- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| UC-01 | 新 profile，桌面启动或浏览器配对后尝试读取私有 API              | 仅本机信任不足以访问；进入登录页；根 `.env` 自动加载 Client ID，非法配置在启动时拒绝；Web 缺 Secret 时不降级 |
| UC-02 | 点击GitHub登录；Web同页授权返回，桌面输入用户验证码并批准       | 轮询验证稳定ID，POST complete绑定用户并创建应用Cookie，显示姓名头像；model/MCP凭据不被创建                   |
| UC-03 | 重复启动/读取别的客户端流程、无效验证码、拒绝/超时/取消/关闭    | 受控错误，不签发会话，取消后在途结果不登录；可重试                                                           |
| UC-04 | 同账号退出重登、更名重登、另一GitHub账号尝试登录                | 前两者同内部userId并刷新展示；另一账号明确拒绝且原profile归属/数据不变                                       |
| UC-05 | 保存Cookie后重启daemon，网络不可用，访问旧Cookie                | 有效信任与登录可恢复；过期/撤销拒绝；新登录仍需GitHub网络                                                    |
| UC-06 | 两个客户端分别登录同账号，打开私有SSE，其中一个退出             | 当前客户端全部登录会话及SSE失效，另一客户端保留；旧Cookie重放拒绝，信任仍可发起新登录                        |
| UC-07 | 未登录/错误Origin/缺CSRF读取设置、下载附件、订阅SSE、修改工作区 | 统一拒绝；正确登录后现有功能正常；后台Run保持既有事实                                                        |
| UC-08 | 页面刷新、登录完成、取消、退出、过期、重登；Electron重启        | 页面和API一致，私有缓存/草稿清理，头像与用户名真实，桌面持久Cookie不被bootstrap覆盖                          |

## Tasks

- [x] 核对现有授权与标杆，确定M4前置范围、纯本地流程及账号归属。
- [x] 完成Spec、API/数据流、UC/AC和验证计划。
- [x] 实现protocol、AuthRepository与真实SQLite行为测试（AC-01/04）。
- [x] 实现Provider适配、绑定客户端的登录流程及统一API/SSE鉴权（AC-02/03/05）。
- [x] 实现Web登录/恢复/退出及ElectronCookie与系统浏览器集成（AC-04/06）。
- [x] 执行静态、HTTP、存储、浏览器和受影响回归，修正问题并记录证据（AC-07）。
- [x] 同步架构/API/用户说明和核心技术文档；写verify，交用户review。
- [x] 改为根 `.env` 与 `.env.example`，自动加载开发配置，桌面产物只包含公开 Client ID。
- [x] 补齐 Web state/PKCE/callback 和入口选择，桌面自动打开系统浏览器；验证归属、重放、拒绝、取消和错误恢复。
- [x] 同步配置与双入口文档，完成针对性静态、HTTP、浏览器及打包检查。

- [x] 按用户参考图更新登录卡片、项目与GitHub品牌Logo，完成针对性静态检查和页面视觉验证。

- [x] 修复真实GitHub回调的iss字段误拒绝，补充issuer来源校验与HTTP/浏览器回归。

- [x] 对齐网页GitHub账号选择参数与用户信息向上菜单（设置/退出），更新受影响的浏览器及桌面smoke操作并验证。

- [x] 增加退出确认弹窗与按钮内登录loading态，验证取消不退出、确认退出、慢请求/跳转/回调恢复及错误重试，并检查浅深主题。

## Issues

- 现有身份为daemon级内存变量，不能绑定每个客户端或恢复；现有authenticated只代表本机配对。统一拆分localAuthorized/authenticated，并移除可选昵称式GitHub路径。
- 现有桌面每次启动重建授权Cookie，新增持久应用会话必须保留独立Cookie并复用本机clientId；主进程模型授权请求也必须带当前应用会话。
- 既有HTTP/页面fixture把配对当登录；调整为测试依赖注入的可控GitHub链路，不添加生产绕过开关。

依据：[GitHub授权协议](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)、[OAuth应用实践](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app)。Web 使用本机 daemon 执行授权码交换，桌面 Device Flow 不需要 Client Secret；两种方式共享身份与应用会话，不把桌面公开产物中的 secret 当作保密能力。

- 网络错误曾使已有身份被误判为退出；授权判断现以未撤销、未过期的服务器快照为准，明确401仍触发清理。
- 过期流程目录项曾从关闭等待中消失；活动验证按所属记录独立保存，关闭及退出等待收束，watch timer显式释放；新增生命周期回归。
- 完成请求明确4xx与网络结果未知需要不同恢复；前者重新登录，后者先查实际status再由用户重试，过期旧流程不阻止新登录。
