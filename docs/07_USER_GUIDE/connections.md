# 外部服务连接

在设置的「外部服务连接」添加GitHub、Google Workspace、Vercel、Notion或Supabase。外部服务授权与本应用的GitHub登录分别管理，登录应用不会自动获得你的仓库、文档或云平台权限。

先选择服务与授权方式。OAuth填写单独注册的Client ID，保存后在该连接下单独录入Client Secret，再点「连接账户」到官方授权页。回调使用daemon监听地址的 `/api/connections/oauth/callback/<服务ID>`，需要在供应商的客户端配置中登记准确地址。Token模式使用你明确创建的供应商访问Token；保存时会调用供应商账户端点核实身份。秘密留在系统凭据库，应用不回显，也不写入对话。

Google一个连接覆盖Drive、Docs、Sheets、Slides和Calendar，但需要在Google Cloud项目启用对应API，并确认所需scope。Google官方MCP处于Developer Preview，另有MCP API及项目准入要求；普通REST连接成功不代表MCP已开通。Vercel和Supabase的资源权限还受供应商客户端与团队/组织配置限制。Notion仅能访问用户授权给该连接的页面。供应商真实限制以授权页和官方客户端配置为准。

连接完成后安装并启用对应插件及App，选用或加载插件Skill。Agent可以搜索该服务允许的固定操作，再请求你明确授权当前Run使用某个账号和操作集合。授权最长15分钟；写入仍遵守工具审批，Plan不能执行写操作。应用不会把Token交给Skill或Shell，也不提供任意HTTP请求代理。

MCP设置可引用同服务连接，避免重复保存Token；它仍需要独立的远端信任和工具审批。供应商是否允许相同Token同时用于REST和MCP，需要实际账号验证，不能仅根据连接状态判断。

点「取消授权」终止等待中的OAuth；「断开」立即使原Run和相关MCP授权失效，之后需要重新连接和审批。更换Client Secret或编辑公开配置也会使旧账户授权失效。对已可能发出的请求，撤销不能保证上游副作用回滚；结果未知时应用会停止并保留日志，不自动重试。应用退出登录不会删除profile外部连接。

目前的工程验收使用独立本机HTTP服务和明确假凭据；真实第三方账号、供应商审核/开通、系统浏览器及跨平台情况分别记录在M4验收中。详细接口见[连接协议](../03_API/connections.md)。
