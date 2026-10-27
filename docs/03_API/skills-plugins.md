# Skills 与插件协议

全部接口沿用应用登录 Cookie 与写请求 CSRF 检查，输入、查询与响应由 `packages/protocol/src/skills.ts` 和 `plugins.ts` 校验。读取目录不执行脚本、不启动 MCP 或进行账号授权。

## Skills 管理

| 方法与路径                                        | 行为                                               |
| ------------------------------------------------- | -------------------------------------------------- |
| `GET /api/skills?workspaceId`                     | 当前作用域的目录元数据                             |
| `GET /api/skills/:id?workspaceId`                 | 指令、资源索引与工具声明                           |
| `POST /api/skills`                                | 在用户或已注册项目作用域创建新 Skill               |
| `POST /api/skills/install`                        | 下载并校验显式 GitHub 来源，固定提交后原子安装     |
| `POST /api/skills/:id/control?workspaceId`        | 按 `contentHash` 启用或停用                        |
| `DELETE /api/skills/:id?workspaceId`              | 按 `contentHash` 卸载所属受管安装                  |
| `POST /api/skills/:id/resources/read?workspaceId` | 按 `{contentHash,path}` 读取冻结版本中的文本或图片 |
| `POST /api/skills/:id/directory?workspaceId`      | 返回已注册且经过实际目录检查的 `{path}`            |

查询省略 `workspaceId` 时只访问用户与已安装插件的目录，停用的插件Skill仍返回元数据并标为不可用；不会使用服务 cwd 或 HOME 作为隐式项目。创建体包含 `scope`、`workspaceId`、`name`、`description` 和 `content`；用户作用域明确使用 `workspaceId:null`。GitHub 安装体另包含 `owner`、`repository`、`ref` 与 `path`，不接受压缩包 URL、任意下载主机或安装脚本。

`SkillView` 包含稳定 ID、名称、描述、作用域、所属工作区/插件、内容 hash、启停、同名覆盖、受管标志和资源数。详情另返回正文、资源路径/hash/大小/媒体类型及 `allowedTools`。工具声明不自动获得审批豁免。兼容目录的项目源只允许读取与启停；插件 Skill 由插件组件控制；仅明确安装或创建的受管目录可独立卸载。

## 输入与 Run

普通输入、steer/follow-up、排队编辑和历史重发均接受 `skills?:SkillSelection[]`；每项为 `{id,contentHash}`，最多 16 个不同 ID。省略表示本次没有新的显式选择。选择失效不能静默替换为磁盘最新版本。原请求重试沿用已有 request ID、选择和内容。

宿主 `FrozenSkill` 记录完整指令、资源索引、来源与授权版本；资源本体在 profile 不可变目录中，接受前完成 hash 与文件同步。授权同时绑定 Skill 控制 revision、插件 revision 与安装 generation；停用后重启用、卸载后重装均不能延长旧授权。Run 租约阻止活动资源被卸载，队列恢复核对原授权。动态加载与 Run 级工具请求仍由 agent-runtime 的工具及会话事实拥有，不从安装配置回填历史内容。

`DesktopBridge.revealSkillDirectory(skillId,workspaceId)` 仅接收身份参数。主进程校验所属页面，带所属会话向上述目录 API 解析路径后交给操作系统；Renderer 无任意路径打开能力。浏览器设置使用复制校验路径的降级操作。

## 插件管理

| 方法与路径                                      | 行为                                             |
| ----------------------------------------------- | ------------------------------------------------ |
| `GET /api/plugins`                              | 有限内置 manifest 与当前安装状态                 |
| `GET /api/plugins/:id`                          | 当前插件状态及实际安装或未安装预览的Skill正文    |
| `POST /api/plugins/:id/install`                 | 装配独立 Skill 资源与所属 MCP Apps               |
| `POST /api/plugins/:id/control`                 | 按 `{expectedRevision,enabled}` 批量控制全部组件 |
| `POST /api/plugins/:id/components/:componentId` | 按相同 revision 控制一个组件                     |
| `DELETE /api/plugins/:id`                       | 按 `{expectedRevision}` 卸载所属资源与关联       |

`PluginView` 返回 manifest、安装/启停、revision 和组件引用。Skill 组件为 `skill:<name>`，App 使用 manifest 中的独立 ID；相同名称不能混用控制入口。安装代次留在宿主配置与冻结授权中。每个插件只有一个管理操作，冲突返回错误；取消或关闭等待所属暂存清理。

协议16为App声明可选的`credentialSource`：`plugin-oauth`复用所属插件授权，`mcp-oauth`使用独立MCP授权，`none`不使用OAuth；省略时沿用独立MCP授权语义。内置App在各插件的 `.app.json` 中显式声明名称、简介、授权来源、地址和传输；公开manifest只返回元数据，宿主从同一声明读取目标，不按插件名称分支或维护第二份端点表。加载拒绝未知执行/秘密字段、所属插件错配、重复ID、私网或带参数地址，以及链接、非UTF-8或超过64KiB的声明文件。客户端秘密始终不进入公开manifest。

协议15新增只读 `PluginDetail`：`{plugin:PluginView,skills:[{name,description,content}]}`。未安装时 `content`来自随包 `SKILL.md`，已安装时来自精确所属组件的实际安装文件，停用也可读取；Apps继续读取 `plugin.manifest.apps`。详情读取不改变组件开关，正文与Agent实际加载的版本保持一致。未安装、插件停用及Skill组件停用都可预览；未知插件返回404，接口不接受路径或工作区查询参数。

详情只读取有限内置manifest或精确安装记录拥有的文件，拒绝链接、非法UTF-8、损坏元数据和超过128KiB的Skill文档。不返回宿主路径、资源字节、凭据或Run授权，不创建安装目录、Skill快照或配置记录，不触发MCP、账号授权或模型请求。预览随包正文不代表已安装版本获得执行权限；启用、安装与Run选择仍使用各自已有接口。

安装只登记 App 配置，不授权本机启动、第三方账户或实际工具调用。精确 `referenceId` 由宿主拥有者验证，卸载不按名称匹配或删除手动 Server。远端授权和供应商连接遵守其所属协议；真实供应商、预注册客户端限制和平台验收不由本地安装成功推导。

## 插件授权与资源同步

服务插件使用[插件授权协议](plugin-connections.md)，每插件一份凭据，弹窗自行发起OAuth。详情不创建通用账户，不提供手动关联。App开关显式开启对应已安装配置，授权成功刷新已开启App，不开启其他App。

启动在接受Run和MCP目录预热之前同步当前随包manifest拥有的Skills，按正文、资源hash和精确组件引用比较，未变化时不写配置。更新拒绝活动资源租约，保留原组件开关和App引用，新增Skill随已启用插件开启，停用插件的新组件保持停用；用户和项目Skill不参与。整体插件开关批量设置全部Skill和App，单独开启组件会激活插件，关闭最后一个组件会停用插件；子开关不因其他组件全关而禁用。资源先完整暂存，发布期间持久停用插件以阻止新租约，成功或普通失败回滚都推进revision，旧Run授权不能复活。SQLite与目录交换不是跨介质事务：硬退出可能留下暂时停用记录或隐藏备份，下次启动可重建缺失或旧资源，但不承诺恢复硬退出前的开关偏好。App配置同步只修复精确拥有者和官方目标，新增App默认关闭；缺失配置重建或信任撤销后需用户重新开启，不自动恢复启动信任。
