# Plugins

`@my-pi-harness/plugins`拥有插件声明、随包资源、安装/启停/更新/卸载和服务授权生命周期。它通过宿主注入的仓储、凭据、Skill和MCP接口工作，不依赖storage、agent-runtime、Fastify或Renderer。通用Skill引擎继续由tools拥有，OAuth协议和受控网络由integrations拥有。

## 源码职责

`src/plugins/<id>`保存manifest、App声明、Skill正文和脚本；同目录下catalog、apps和preview读取有界声明及预览。`lifecycle`拥有安装代、组件引用、操作串行、资源更新和关闭收束；`auth`拥有声明校验、安装/身份绑定、授权有效期、凭据刷新和撤销。`accounts/providers`为高级账户提供独立权限策略，同时从插件声明读取统一的OAuth端点。`apps`拥有精确MCP目标匹配，`gateway`执行声明中的只读路径和响应限制。根index仅公开实际接口。

插件公开清单不含OAuth客户端、Token或私有传输目标；`.app.json`同时提供公开简介和固定宿主目标，不维护第二份端点表。预览只读取所属SKILL.md，不安装、激活或执行脚本。

## 安装与贡献

每次安装生成独立generation，组件以skill:<name>和App ID区分。整体开关批量控制组件；逐项开启激活插件，最后一个组件关闭后插件停用。每次状态变更递增revision。宿主仓储按预期revision原子保存，旧版本写入明确拒绝。

插件只管理自己保存的目录与精确App引用，不能按可改名称移除手动Server。卸载先检查活动Skill租约、撤销当前安装授权，再释放所属App与目录。每个插件只有一个管理操作，关闭拒绝新操作并取消、等待所属操作清理。

启动同步只核对已安装内置插件的正文、资源和贡献；不一致时原子交换Skill目录，保留开关与App引用，未变化时不递增revision。活动租约拒绝更新；普通失败恢复旧目录并推进revision。目录交换与宿主数据库不是全局事务，硬退出可能留下停用记录或隐藏备份。用户和项目Skills不参与插件更新。

通用Skill发现、冻结与资源租约通过tools/skills公开接口使用。`BUILTIN_PLUGIN_SKILL_RESOURCES`声明插件共享办公脚本，宿主合并原生文档helper后显式注入resourceSources；通用引擎不查找插件源码目录。所有依赖继续验证路径、大小与hash，冻结副本不随升级改变。

## 服务授权

插件授权与安装、App开启各自独立。一份插件授权供Skill网关和所属MCP Apps共用，不创建高级账户。daemon提供独立OAuth客户端配置和本机回调地址；不回退应用登录客户端。OAuth协议由integrations统一处理授权码、PKCE、Token交换、刷新及安全诊断。

PluginConnectionService绑定profile身份与安装代；state限时、单次使用，重复授权取消先前流程。保存前重新检查归属与撤销状态；刷新串行并核对旧凭据，不能覆盖新授权。Token通过PluginCredentialPort保存，公共状态只包含脱敏账号。卸载、断开或关闭会取消所属流程和请求，MCP由宿主按授权epoch失效旧绑定。

gateway仅转发manifest允许的固定来源与只读路径，限制认证头、查询参数、响应大小和超时；HTTP路由、请求身份与内部网关令牌由daemon拥有。授权错误只保留有限阶段/原因和可选HTTP状态，不传播供应商正文、秘密或原始cause。

## 宿主装配与验证

daemon拥有HTTP、profile/workspace路径、存储适配和MCP/Skills装配；plugins通过窄端口使用它们。存储的PluginInstallation与PluginOAuthCredential由protocol/internal统一定义，数据库和私有文件仍由storage管理。源码exports与完整src资源共同部署，不依赖旧后端dist。

现有回归覆盖清单/预览、安装同步、开关、撤销/刷新、OAuth拒绝与诊断、网关限制、MCP精确归属及四个办公Skill资源冻结。测试使用临时profile与合成凭据；真实账户和平台验收范围仍见[里程碑](../../docs/00_OVERVIEW/roadmap.md)。
