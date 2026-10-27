# 高级外部账户管理协议

此入口管理显式创建的独立服务账户，不再承载插件默认授权、固定REST操作或逐Run服务grant。插件界面使用[插件授权与只读网关](plugin-connections.md)。应用登录、模型OAuth、独立账户及插件凭据分别管理。

| 方法与路径                                       | 用途                                             |
| ------------------------------------------------ | ------------------------------------------------ |
| GET `/api/connections/providers`                 | 有限服务、scope及MCP地址元数据                   |
| GET/POST `/api/connections`                      | 列表与创建公开账户配置                           |
| GET/PUT/DELETE `/api/connections/:id`            | CAS读取、编辑、删除                              |
| POST `/api/connections/:id/client-secret`        | 单独保存Client Secret                            |
| POST `/api/connections/:id/token`                | 验证显式Token并连接                              |
| POST `/api/connections/:id/disconnect`           | 提升epoch、撤销关联并删除秘密                    |
| POST `/api/connections/:id/oauth/start`          | 独立state/PKCE流程，5分钟                        |
| POST `/api/connections/:id/oauth/cancel`         | 取消本账户的等待流程                             |
| GET `/api/connections/oauth/callback/:serviceId` | 按供应商、身份、revision、epoch、state校验后换码 |

创建包含serviceId、name、authMode、clientId、scopes；编辑另带expectedRevision。控制请求带expectedRevision与expectedAccessEpoch，秘密请求另带value。未知字段拒绝，秘密不混入公开配置或DTO。SQLite仅保存配置、账户元数据、版本及系统凭据引用；这个高级入口继续使用原系统凭据库。

普通GET不访问供应商或刷新Token。OAuth固定官方端点，回调检查issuer、一次性state及所属身份。断开优先于在途秘密发布，失败清理暂存引用。引用此账户的手动MCP按官方endpoint与冻结epoch读取Token，仍遵守自身配置、信任和工具审批；插件App使用插件专属Token，不再自动创建或关联此类账户。
