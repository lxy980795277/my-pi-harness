# Skills 与内置插件

## Spec

本模块属于 M4.4–M4.6。Skills 使用公开 [Agent Skills 格式](https://agentskills.io/specification)和[渐进加载流程](https://agentskills.io/client-implementation/adding-skills-support)：目录只公开名称与描述，激活记录正文，资源按需读取。独立编写九个内置插件及其正文，不引入远程市场和可执行插件代码。

### 目录与身份

用户安装目录为当前 profile 的 `skills/`；项目依次扫描工作区 `.my-pi-harness/skills/`、`.agents/skills/`。插件目录为当前 profile 的 `plugins/<pluginId>/skills/`。未绑定工作区时只列用户和启用插件。项目优先于用户，用户优先于插件；同名项保留稳定 ID 和 shadowed 标志，不依赖扫描顺序。禁用项不作为新 Run 候选。

每个 Skill 的稳定 ID 由作用域、拥有者、相对名称计算；版本 hash 同时覆盖正文及资源路径/hash。选择包含 ID 与 hash，接受时拒绝过期选择。Run 保存完整正文、来源与资源索引，资源复制到有界不可变版本目录；旧 Run 的资源读取从该版本完成，不读取更新后的源文件。资源由宿主读取，正文和 allowed-tools 均不授予额外权限。

### 文件与安装

拒绝目录和文件符号链接、路径穿越、特殊文件及超限资源。单 Skill 最多 256 个文件、16 MiB，总深度 8，单文件 2 MiB，SKILL.md 128 KiB。先校验 staging，再原子重命名到新目录；同名拒绝覆盖。GitHub 安装只接受显式 owner/repo/ref/path，先解析提交 SHA，再读取固定提交树与 blob，不运行生命周期脚本。取消或下载失败清理所属 staging。

创建仅写新 SKILL.md 与用户指定资源。删除仅删除安装记录拥有的受管目录，兼容发现的项目目录不由卸载操作删除；活动租约存在时拒绝删除。插件系统/资源由插件管理，不能作为独立 Skill 删除。启停持久化于 SQLite，不改写 SKILL.md。

### 插件装配

目录包含 GitHub、Google、Vercel、Notion、Supabase、Documents、PDF、Spreadsheets、Presentations。manifest 声明分类、独立 Skill 资源与 App 模板。安装创建插件拥有的目录与精确关联 ID，不按显示名查找或删除 Server。安装不授权账号、不启用 MCP 启动信任。整体启停和逐项启停影响新 Run；已接受内容依照冻结和撤销规则处理。卸载检查活动资源，释放所属 App 关联，保留手动 Server 及其他插件的配置。

### 宿主接口与 UI

integrations 提供解析、扫描、版本冻结、资源读取和安装算法；storage 只保存启停、安装记录、插件组件及归属；daemon 校验工作区和装配宿主端口。设置提供 Skills 列表/正文/资源、作用域、创建/GitHub 安装、取消、启停和卸载；插件目录提供分类、详情、安装、启停和组件管理。输入框 Skill 选择和运行时激活由会话层接入同一冻结端口。

### 验证

真实临时文件系统覆盖格式、同名优先级、无工作区、符号链接、穿越、版本变更、不可变资源及活动卸载；临时 SQLite 覆盖 CAS 与精确所属。GitHub fixture 覆盖固定提交、取消、坏文件和失败清理；HTTP 与浏览器证明设置可以完成安装并选用。真实第三方账号和跨平台证据分别记录，不以 fixture 宣称外部供应商已验收。

### 实现补充

冻结授权包含 Skill 控制 revision、所属插件 revision 与安装 generation。停用后重启用、卸载后重装均不能复活先前接受的授权。用户安装卸载保留撤销记录；插件重装创建新 generation。App 和 Skill 组件使用独立 ID，避免同名 GitHub App 控制误作用到同名 Skill。

正文和资源快照在注册或返回接受结果前完成文件与目录同步。GitHub 下载仅使用公开 API、固定提交和有界 blob；单次下载总期限 60 秒，不接受重定向、链接和子模块。设置可显式读取资源，并经有限桌面 ID 接口打开注册目录；浏览器可复制校验后的路径。
