# 内置插件

`PluginService` 装配 `integrations/resources/plugins` 中独立编写的 Skill 资源和有限 manifest；每个插件的 `.app.json` 同时拥有公开 App 简介、授权来源以及仅宿主使用的 MCP 地址和传输，daemon 不维护第二份端点表。每个 App 保存精确 Server 引用，管理入口不按可改名称查找或删除配置。安装不授权第三方账号，不授予 MCP 启动信任。

插件具有独立安装 generation，组件以 `skill:<name>` 与 App ID 区分；整体开关批量控制所有组件，逐项开启会激活插件，最后一个组件关闭后插件停用；每次控制递增 revision。卸载先检查活动 Skill 租约、撤销当前代授权，再释放所属 App 和目录。手动 Server 及其他插件资源由各自所有者保留。每个插件只有一个管理操作，关闭拒绝新操作并取消、等待所属安装完成清理。

第三方服务的 OAuth、账户和网络限制由连接模块及 Remote MCP 所有者执行；内置 manifest 不保存凭据或供应商 Client Secret。官方服务器或预注册客户端限制及真实账号验证范围，必须与本地装配测试分开记录。

默认授权由[插件服务授权](../plugin-connections/README.md)管理：一个插件对应一份私有 JSON Token，Skills 网关和所属 MCP Apps 共用，不创建高级服务账户或执行手动关联。客户端仅从插件 manifest 和 daemon 专用配置解析，不回退应用登录注册信息。安装、授权和开启 Apps 各自独立；卸载先确认允许移除，再撤销插件授权并清理精确所属资源。

启动时 `synchronize` 在工具目录预热和接受Run之前核对内置Skill正文、资源hash及精确组件引用，仅不一致时调用 `sync.ts` 原子更新，未变化的安装不递增revision；同名Skill开关、App引用及账户凭据保留，用户和项目Skill不参与。已安装详情读取实际安装正文，未安装详情读取随包预览；界面与Agent使用同一版本。活动租约拒绝更新；发布期间停用插件，普通失败回滚并推进revision。目录交换与SQLite不是全局事务，硬退出可能留下停用记录或隐藏备份，不承诺自动恢复停用前偏好。App对账仅按精确拥有者修复缺失配置及官方目标，拒绝接管手动配置；新配置或被撤销的信任不会自动恢复，用户需重新开启App；显式开关会先修复缺失的精确所属配置，再由本次用户操作授予启动信任。App开关返回后，由MCP拥有者在后台发现目录，界面区分账号授权与工具就绪，发现失败可见且可重试。协议与UI流程见[补齐Spec](../../../../docs/04_FEATURES/202610201932_feature_m4-capabilities/plugin-completion.md)。
