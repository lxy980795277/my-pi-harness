# 外部服务连接协议

连接属于当前profile所有者，应用登录、模型OAuth和MCP独立OAuth各自拥有凭据。公开schema由 `packages/protocol/src/connections.ts` 定义，配置及授权epoch保存在SQLite，秘密只保存系统凭据引用。普通GET不请求供应商、不刷新Token。

| 方法与路径                                       | 用途                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| GET `/api/connections/providers`                 | 五个固定服务、默认scope、Google子App及预置MCP地址                   |
| GET/POST `/api/connections`                      | 列表与创建公开配置                                                  |
| GET/PUT/DELETE `/api/connections/:id`            | 读取、CAS编辑、删除；删除要求revision与accessEpoch                  |
| POST `/api/connections/:id/client-secret`        | 单独保存OAuth Client Secret；旧账户及授权失效                       |
| POST `/api/connections/:id/token`                | 验证静态Token账户后连接，不把Token回显到DTO                         |
| POST `/api/connections/:id/disconnect`           | 提升epoch并撤销Run授权和在途请求，再清所属秘密                      |
| POST `/api/connections/:id/oauth/start`          | 启动独立state/PKCE流程，返回授权URL和5分钟到期时间                  |
| POST `/api/connections/:id/oauth/cancel`         | 取消本连接等待中的授权，要求当前revision与epoch                     |
| GET `/api/connections/oauth/callback/:serviceId` | 一次性state、供应商、profile身份、revision、epoch和issuer校验后换码 |

创建字段为 `serviceId`（github/google/vercel/notion/supabase）、`name`、`authMode`（oauth/token）、公开 `clientId`、`scopes`。编辑另带 `expectedRevision`。控制请求带 `expectedRevision` 和 `expectedAccessEpoch`；秘密请求另带 `value`。Token和Client Secret不能混入普通配置，未知字段在HTTP入口拒绝。响应不包含credentialRef、access/refresh token、Client Secret或PKCE verifier。

OAuth上游固定官方端点，用户不能配置issuer/authorize/token URL。回调允许供应商已知附加字段（Google的scope/authuser/prompt等），不接受任意字段。实际换码和账户检查跟随HTTP中断/30秒期限；授权开始响应结束不会自动撤销用户随后在浏览器操作的流程。断开优先于在途配置写入；旧写入CAS失败并清理未提交秘密。应用退出登录不等同外部连接撤销。

REST网关不提供任意HTTP代理API。Agent经 `service_search` 找到固定operation，激活相应插件Skill后通过 `request_service_access` 明确获得Run级权限，下一轮才出现对应工具定义。运行时调用宿主ConnectionGatewayPort，参数使用operation自身schema；固定来源、method、path及query/body映射由integrations拥有。工具名由运行时按连接ID隔离，同服务不同账号不会因同名互换。期限最长15分钟，Run结束、Skill/插件撤销、账号或epoch变化立即失效；恢复不会重建授权或重发动作。

MCP共享连接只传入connectionId及冻结connectionAccessEpoch，由宿主在精确预置endpoint上读取Token；MCP仍需独立远端信任和工具审批。相同凭据只存一处，断开立即使相关MCP绑定失效。不是所有供应商都保证REST OAuth Token可用于MCP，其真实互通状态由供应商验收单独记录。

调用前持久化parentToolCallId、operation与派发事实，结果回到同一工具日志。响应正文最多2MiB；持久化JSON投影超过100k时保留HTTP状态、父工具ID、operation及明确缩短的预览，不把已知响应改成unknown。派发后断线/超时/撤销且无可靠响应为unknown；无自动重试，未知结果不能作为任务成功证据。刷新只在宿主同ref串行事务中进行，返回账号必须与原连接一致；401不自动重发业务请求。URL/DNS/重定向/响应界限见[后端约束](../05_CONSTRAINTS/backend.md)，具体操作和验证见[M4.7设计](../04_FEATURES/202610201932_feature_m4-capabilities/connections.md)。
