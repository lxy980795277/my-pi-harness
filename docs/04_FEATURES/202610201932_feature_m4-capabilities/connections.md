# M4.7 外部服务连接设计（初版记录）

2026-10-27用户确认完整重构插件授权与消费路径。本文的固定operation、Run grant和插件账户关联已被[当前重构设计](plugin-completion.md#插件完整流程重构2026-10-27实施中)取代；高级手动账户仍保留独立管理，当前接口见[插件协议](../../03_API/plugin-connections.md)。

状态：工程实现与本机协议、账户连接界面验证已完成，具体证据及真实供应商缺口见[外部连接验证](connections-verify.md)。覆盖GitHub、Google（Drive/Docs/Sheets/Slides/Calendar）、Vercel、Notion和Supabase。属于M4.7；与应用GitHub登录、模型OAuth和MCP专用授权分别拥有记录。真实供应商验证需要用户注册的客户端及账号，不使用用户现有登录Token或测试Key。

## 连接与凭据

设置提供有限服务目录、连接创建、OAuth Client配置、秘密单独录入、授权、取消、状态和断开。客户端ID及用户选择的scope是公开配置，Client Secret、access/refresh token只放系统凭据库。SQLite保存owner/identity epoch、账户稳定ID、scope、revision/access epoch和秘密引用。普通GET不发网络请求，不刷新Token，不改变连接状态。

OAuth使用维护中的oauth4webapi，服务端固定官方issuer/authorize/token端点；PKCE S256和state每流程独立、5分钟过期、回调provider/流程/owner/identity/revision/epoch关联、一次性消费。若回调提供iss必须匹配固定issuer，不能通过用户输入改授权服务器。Google显式offline；Notion使用其要求的JSON token请求；其他服务使用公开标准接口。供应商不支持的能力、未注册Client和未经真实账号验证分别报告，不能以fixture宣称平台已授权。静态Token也是显式单独录入并通过该服务用户端点核实账户，不接收浏览器Cookie。

刷新通过CredentialStore.modify对同一引用串行化，保留新的refresh token；认证失效使当前连接不可用并提示重新授权，不通过自动401重发业务副作用。断开先提升epoch/清关联、撤销Run授权并取消在途，再删除所属秘密；重新连接得到新epoch，旧授权不能复活。应用退出登录不删除profile连接，显式连接撤销立即影响所有相关调用。

## 两条消费路径

MCP App可引用同服务连接，由宿主读取Token并仅向该服务的预置MCP endpoint附加，Token不复制到MCP配置。MCP仍需要其自身远端信任和工具审批；连接登录不等于授权所有工具。卸载插件由所有者释放关联，不能删除另一个插件或手工MCP仍引用的凭据。

REST通道使用固定operation目录，不接收任意URL、认证头、HTTP方法或路径。GitHub提供用户/仓库/Issue，Google覆盖五个子App的读取及受控创建/更新，Vercel提供项目/部署，Notion提供搜索/页面/块，Supabase提供组织/项目/安全建议。operation参数经自身schema验证并映射固定上游method/path/query/body；分页和正文有界，不转发任意URL/redirect/upload地址。

Run先激活属于该服务的插件Skill，再明确申请connection/operations权限。审批通过后冻结grantId、Run、Skill稳定ID和内容hash/插件epoch、owner/identity epoch、连接revision/access epoch、account ID、operation集合和期限（最长15分钟）。授权和父工具事实先进入JSONL，然后才可能派发子请求。工具不把临时Bearer交给Skill/Shell；宿主内部gateway port持有grant，逐请求重新验证Run、Skill及连接。Plan只允许目录标记只读的operation，写请求仍走逐次审批，Skill正文不能提升权限。

业务调用使用公网DNS检查和socket pin、HTTPS标准端口、固定origin、无Cookie/ambient proxy、禁止重定向、单次60秒及2MiB响应。持久化结果投影最多100k；过长正文明确缩短，保留已知HTTP状态及父工具关联。已进入派发屏障但无可靠响应为unknown；不自动重试，不报安全失败，不成为Todo成功证据。JSONL保存parentToolCallId、operation和安全结果，秘密不进入模型内容、公开状态或日志。运行结束即撤销内存grant，恢复不会续接授权或重发请求。

## 验收

使用动态端口、独立临时SQLite和明确假系统凭据的真实HTTP fixture：五服务operation目录/schema及路径映射、Google五子App，真实OAuth state/PKCE与code交换/refresh串行化，账户错配、过期/重复/异provider回调、revoke/reconnect旧grant、未激活Skill/错误hash/Plan写入/未知operation/越界路径拒绝；派发后断线返回unknown且只请求一次；响应和DTO不含假秘密。UI创建/授权/取消/断开与实际工具消费由M4.9组合场景验证。真实第三方、MCP各服务互通、系统浏览器和跨平台明确单列。

## 官方依据

- [oauth4webapi公开API](https://github.com/panva/oauth4webapi/blob/main/docs/README.md)
- [GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Google Workspace五个MCP服务与预览项目要求](https://developers.google.com/workspace/guides/configure-mcp-servers)
- [Google桌面OAuth与PKCE](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Vercel授权服务器](https://vercel.com/docs/sign-in-with-vercel/authorization-server-api)
- [Notion授权](https://developers.notion.com/guides/get-started/authorization)
- [Supabase Management OAuth](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration)
