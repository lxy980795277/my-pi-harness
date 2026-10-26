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

查询省略 `workspaceId` 时只访问用户与已安装启用插件的目录；不会使用服务 cwd 或 HOME 作为隐式项目。创建体包含 `scope`、`workspaceId`、`name`、`description` 和 `content`；用户作用域明确使用 `workspaceId:null`。GitHub 安装体另包含 `owner`、`repository`、`ref` 与 `path`，不接受压缩包 URL、任意下载主机或安装脚本。

`SkillView` 包含稳定 ID、名称、描述、作用域、所属工作区/插件、内容 hash、启停、同名覆盖、受管标志和资源数。详情另返回正文、资源路径/hash/大小/媒体类型及 `allowedTools`。工具声明不自动获得审批豁免。兼容目录的项目源只允许读取与启停；插件 Skill 由插件组件控制；仅明确安装或创建的受管目录可独立卸载。

## 输入与 Run

普通输入、steer/follow-up、排队编辑和历史重发均接受 `skills?:SkillSelection[]`；每项为 `{id,contentHash}`，最多 16 个不同 ID。省略表示本次没有新的显式选择。选择失效不能静默替换为磁盘最新版本。原请求重试沿用已有 request ID、选择和内容。

宿主 `FrozenSkill` 记录完整指令、资源索引、来源与授权版本；资源本体在 profile 不可变目录中，接受前完成 hash 与文件同步。授权同时绑定 Skill 控制 revision、插件 revision 与安装 generation；停用后重启用、卸载后重装均不能延长旧授权。Run 租约阻止活动资源被卸载，队列恢复核对原授权。动态加载与 Run 级工具请求仍由 agent-runtime 的工具及会话事实拥有，不从安装配置回填历史内容。

`DesktopBridge.revealSkillDirectory(skillId,workspaceId)` 仅接收身份参数。主进程校验所属页面，带所属会话向上述目录 API 解析路径后交给操作系统；Renderer 无任意路径打开能力。浏览器设置使用复制校验路径的降级操作。

## 插件管理

| 方法与路径                                      | 行为                                          |
| ----------------------------------------------- | --------------------------------------------- |
| `GET /api/plugins`                              | 有限内置 manifest 与当前安装状态              |
| `GET /api/plugins/:id`                          | 当前插件状态及随包Skill简介与完整Markdown正文 |
| `POST /api/plugins/:id/install`                 | 装配独立 Skill 资源与所属 MCP Apps            |
| `POST /api/plugins/:id/control`                 | 按 `{expectedRevision,enabled}` 控制整个插件  |
| `POST /api/plugins/:id/components/:componentId` | 按相同 revision 控制一个组件                  |
| `DELETE /api/plugins/:id`                       | 按 `{expectedRevision}` 卸载所属资源与关联    |

`PluginView` 返回 manifest、安装/启停、revision 和组件引用。Skill 组件为 `skill:<name>`，App 使用 manifest 中的独立 ID；相同名称不能混用控制入口。安装代次留在宿主配置与冻结授权中。每个插件只有一个管理操作，冲突返回错误；取消或关闭等待所属暂存清理。

协议15新增只读 `PluginDetail`：`{plugin:PluginView,skills:[{name,description,content}]}`。`content`是随包 `SKILL.md` 解析后的完整Markdown正文，名称与manifest声明一一对应；Apps继续读取 `plugin.manifest.apps`。已安装组件的启停偏好保持在 `plugin.components`，预览不改变它们。未安装、插件停用及Skill组件停用都可预览；未知插件返回404，接口不接受路径或工作区查询参数。

详情只读取有限内置manifest拥有的随包文件，拒绝链接、非法UTF-8、损坏元数据和超过128KiB的Skill文档。不返回宿主路径、资源字节、凭据或Run授权，不创建安装目录、Skill快照或配置记录，不触发MCP、账号授权或模型请求。预览随包正文不代表已安装版本获得执行权限；启用、安装与Run选择仍使用各自已有接口。

安装只登记 App 配置，不授权本机启动、第三方账户或实际工具调用。精确 `referenceId` 由宿主拥有者验证，卸载不按名称匹配或删除手动 Server。远端授权和供应商连接遵守其所属协议；真实供应商、预注册客户端限制和平台验收不由本地安装成功推导。
