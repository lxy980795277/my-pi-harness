# M4运行时扩展设计

## Spec

2026-10-22继续既有M4，用户授权M4.2–M4.9全部进入开发。M4.1保留已有工作区实现与验证，不自动提交。各能力分别维护子Spec、可用界面与真实验证；未完成项不因本轮启动而标为完成。

### Roadmap Alignment

本页拥有M4.2的Run内工具可见版本、M4.4的Skill激活和M4.7的运行授权装配。MCP目录/远端传输、Skills/插件宿主与办公执行分别在对应子Spec设计。不扩展到子Agent、跨会话记忆或Computer Use。

### Intent

用户选择的MCP工具和Skill随输入冻结。Agent可检索已授权候选目录、显式加载工具或Skill资源；每次真实模型请求使用当次可见定义和冻结指令，预算、审批、实际执行及JSONL事实保持一致。

### Constraints

- 候选目录在接受Run时从已启用、已信任且作用域匹配的缓存冻结，普通检索不启动Server；最多512候选，不把完整目录schema加入prompt。显式选中的MCP工具初始可见。
- `tool_search`只返回名称、描述和来源摘要；`load_tools`只从冻结候选加载，最多64个外部工具。持久化`run.tools_loaded`的完整定义/来源及递增版本后才能供后续请求使用；加载失败不改变内存可见集合。
- 使用Pi公开的prepareRequest/prepareNextTurnWithContext更新真实AgentContext和工具执行入口，不修改SDK源码。不允许同一assistant中的后续工具提前使用尚未进入模型请求的定义。
- WorkContext每次按当前可见集合重建system工具声明和预算，保留新增定义。context.prepared记录实际请求版本和内容，不复用包含旧toolsAdded的system副本。
- SkillSelection包含稳定ID和内容hash，正文/资源manifest在输入接受时冻结，原文进入私有日志。每次请求从冻结正文重建明确有来源的指令段；摘要不能替代已激活指令。资源读取校验注册根、路径与hash，不能读秘密目录或外部地址。
- 排队/重试/历史编辑携带原选择；消费时验证原绑定。不同Skill或MCP集合与授权不能合并进一个Run；显式编辑重选才产生新绑定。Run持有资源lease，结束/取消/初始化失败均释放，排队不永久占用资源。
- Skill正文和allowed-tools不自动提升权限。`request_skill_tools`需要用户明确批准，只授予当前Run、当前Skill hash及具体冻结工具；禁用、撤销或Run结束后失效。Plan、工作区、启动信任和每次工具审批仍独立执行。
- 外部连接凭据只留宿主。受限gateway授权绑定Run/激活Skill/账户/服务/方法路径/期限和撤销epoch；子请求记录关联父调用及已知/未知结果，不能把一次Shell批准转换为全账户访问。
- 新的持久化数据有明确版本，开发期不建立旧格式兼容或静默默认修复。模块闭环后才记录verify，真实账号、桌面安装和平台分别验收。

### Acceptance Criteria

- AC-01：真实Pi首次请求不含未加载候选schema；加载后下一请求、预算、日志与执行使用同一版本，旧定义/越权名字和超限加载拒绝。
- AC-02：Skill正文与资源来源/hash可从日志重建，压缩/磁盘修改不替换旧Run内容，越界及取消无遗留资源。
- AC-03：选择贯通首发、重试、steer/follow-up、队列编辑、重发和分支；失败不清掉用户输入或自动重绑。
- AC-04：Run工具授权需要显式批准，撤销/结束拒绝后续使用；unknown停止模型和自动队列，不能借新能力重新执行旧副作用。

## UseCase

- UC-01：选择MCP→检索目录→加载新工具→实际调用；检查每次Pi声明、JSONL工具版本和执行身份。
- UC-02：选择Skill→请求资源→长对话触发压缩→继续；指令保持冻结内容，原资源越界或hash变化被拒绝。
- UC-03：排队、停止、编辑重选、恢复与撤销；旧绑定不复活，新的用户选择成为新的可追溯输入。
- UC-04：激活Skill申请有限外部工具/连接→用户批准→执行→结束或撤销；其余工具、账户及路径仍不可访问。

## Tasks

- [x] 冻结候选目录、Run可见版本及真实Pi动态声明。
- [x] 检索/加载工具、原子持久事实、预算和恢复关联验证。
- [x] Skill输入选择、冻结日志、资源lease及压缩保留。
- [x] Run有限授权和外部gateway生命周期装配。
- [x] 共享Web输入/设置装配、浏览器和构建产物验证。

## Issues

M4.1的RunToolset不可变且RunExecution捕获初始定义；直接向SDK追加工具会使WorkContext、持久审计和执行路由不一致。本轮明确区分不可变候选与按请求推进的可见版本，加载事实提交成功后再更新下一请求。

定向运行时证据：`capabilities.test.ts`覆盖真实Pi动态声明、同assistant提前调用拒绝、日志失败、冻结Skill/资源、自动压缩保留、用户批准/拒绝、队列撤销以及两处撤销竞态；`connection-runtime.test.ts`覆盖有限服务授权的拒绝、已知及unknown结果。统一静态、产物和浏览器证据见[本轮整体验证](m4-completion-verify.md)。
