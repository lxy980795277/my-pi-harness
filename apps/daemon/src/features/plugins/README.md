# 内置插件

`PluginService` 装配 `integrations/resources/plugins` 中独立编写的 Skill 资源和有限 manifest。每个 App 保存精确 Server 引用，管理入口不按可改名称查找或删除配置。安装不授权第三方账号，不授予 MCP 启动信任。

插件具有独立安装 generation，组件以 `skill:<name>` 与 App ID 区分；整体和逐项控制递增 revision。卸载先检查活动 Skill 租约、撤销当前代授权，再释放所属 App 和目录。手动 Server 及其他插件资源由各自所有者保留。每个插件只有一个管理操作，关闭拒绝新操作并取消、等待所属安装完成清理。

第三方服务的 OAuth、账户和网络限制由连接模块及 Remote MCP 所有者执行；内置 manifest 不保存凭据或供应商 Client Secret。官方服务器或预注册客户端限制及真实账号验证范围，必须与本地装配测试分开记录。
