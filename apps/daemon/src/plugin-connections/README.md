# 插件服务授权

`PluginConnectionService` 为每个已安装服务插件管理一份 OAuth 授权。授权页只发起连接和读取账号状态；账户创建、Client 配置、Token 保存与 Apps 复用均由 daemon 管理，不建立高级服务账户记录或手工绑定关系。

`integrations/resources/plugins/<id>/manifest.yaml` 声明 API 来源、OAuth 端点、Scopes、PKCE、账号字段和只读网关路径。daemon 的专用 `MY_PI_HARNESS_SKILL_*` 客户端配置覆盖 manifest 的客户端字段；不回退应用登录客户端。GitHub 使用 `repo user`，Google 申请离线授权并从 Token 响应的 `id_token` 读取展示账号；这些账号字段不建立应用登录身份。

随机 state 和 PKCE verifier 只在内存保存十分钟。state 绑定插件安装 generation、profile 用户和身份 epoch，只消费一次；重新开始、断开、卸载和关闭取消所属流程。授权码交换和账号读取受十秒截止及请求取消约束。回调成功后通知 Remote MCP 失效旧目录和连接，Apps 仍须各自显式开启。

插件 Token 独占 profile 的 `skill-credentials.json`，由 storage 校验并以 `0600` 文件原子替换保存；不进入 SQLite、系统账户列表、公开 DTO 或会话日志。记录包含私有用户、身份 epoch 和插件安装 generation；更换身份或重新安装不能复用旧授权。到期前六十秒刷新，同插件刷新合并；失败的 refresh grant 清除对应凭据。刷新发布前核对原凭据，旧刷新不能覆盖或删除后来完成的新授权。

`routes.ts` 提供 `/api/skill-connections/:collectionId` 的状态、授权码发起、回调和断开接口。浏览器弹窗自己请求授权地址；桌面系统浏览器通过短时、一次性 launch ticket 启动，不获得应用会话。回调统一重定向至不带 Token 的结果页。

回调失败由`failure.ts`映射为应用拥有的固定提示；OAuth适配器只携带有限阶段、原因与HTTP状态，流程过期和本机保存失败分别显示。日志保留请求关联ID和安全诊断，不记录外部error_description、未知错误字符串、路径或原始cause。详细分类见[插件协议](../../../../docs/03_API/plugin-connections.md)。

只读 `/api/skill-gateway/:collectionId/*` 要求 daemon 内部能力请求头；普通浏览器登录不会获得此能力。`web_fetch` 仅向注册的准确本机网关 GET 注入该头。网关先校验 manifest 路径和查询限制，再附加同一插件 Bearer Token 访问供应商；内部请求头不会转发上游。MCP Apps 从同一服务读取 Token，不复制至 Server 配置。高级 Connections 和独立 App MCP OAuth 保持各自数据所有权。
