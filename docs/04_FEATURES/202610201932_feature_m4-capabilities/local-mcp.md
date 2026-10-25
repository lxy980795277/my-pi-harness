# M4.1 本地MCP详细设计

## Spec

状态：L1内置RunToolset随0.6.4提交0755d79；本轮实现L2–L4及macOS的SDK/Pi/JSONL/HTTP/浏览器链路。协议、原子结果及生命周期见[细化设计](local-mcp-contracts.md)，实际检查及未验证项见[本轮验证](verify.md)。M4.2动态加载与M4.3远端OAuth未进入本轮。

### Roadmap Alignment

本设计属于M4.1本地MCP闭环，不包含M4.2大目录搜索/动态加载或M4.3远程OAuth。M4.1.1内部先交付当前工具定义的真实统一消费，本轮加入外部来源协议和结果未知事实；外部来源与unknown已随本轮真实MCP调用接入，不以接口存在代替验收。

### Intent

让用户在设置添加并信任一个本机stdio Server，从输入框显式选择有限工具，Agent获得准确schema并经现有策略调用，结果及不确定状态进入会话，停止/退出回收所属资源。

### 架构与数据

- execution拥有持久双向进程、cwd/环境/隔离、输出限制和进程组/管道收束；integrations/mcp将其适配为官方SDK Transport，不重新实现JSON-RPC；daemon拥有配置、凭据装配、连接池与管理API。
- agent-runtime拥有RunToolset、冻结定义/来源/版本、模型声明、预算、策略与执行路由。storage拥有配置/信任及会话事实；Web的Query缓存管理配置与目录，composer Store只持有尚未发送的选择。
- Server配置包含稳定ID、名称、stdio command/args、注册工作区、非秘密环境配置、秘密引用、enabled与revision。秘密只进入系统凭据库；启动信任绑定完整有效启动配置、工作根与隔离策略，修改后重新确认。
- 会话选择与调用来源使用稳定Server ID、revision、工具原名、模型别名及定义指纹。Run接受时冻结有限选择；M4.1不热换定义，后续M4.2单独设计active revision。
- 模型可见定义及实际结果必须进入JSONL；配置记录在SQLite，HTTP/SSE只给安全DTO。已发送后的取消、超时、断线或进程退出可能产生unknown，恢复不连接Server或重跑工具，Todo不能将unknown当完成证据。

### M4.1.1第一批：统一现有Run工具集

现有内置工具在接受Run前由ToolRuntime选择一次，SessionRuntime接受审计、RunExecution的Pi声明、WorkContext预算及ToolRuntime路由共用同一RunToolset。

- ToolRuntime按实际启用的会话能力和工作区确定候选，生成只读定义及稳定来源/指纹。没有工具运行时使用空集合；不能把没有工作区的文件工具加入模型。
- SessionRuntime在提交run.accepted前获得集合，接受审计保存同一份模型声明及其来源信息；RunExecution获得该集合，不再次推导候选。
- Pi工具声明、每次请求的上下文预算与审计从同一集合读取，实际调用只在该集合中查找定义与来源，统一校验参数后进入原审批/执行链。
- 工作区工具与会话工具保持现有名称、schema、顺序、审批与结果语义。冻结的数据不因外部数组或schema修改而变化；重名或不存在的路由明确拒绝。
- TypeBox的Value.Clone保留非枚举元数据，再深冻结定义；私有接受审计的tools保留模型定义，toolSources单独保存名称、来源及稳定SHA-256指纹，不将内部来源字段传给模型或预算。
- 底层execution和会话执行器对固定内置目录的二次参数校验继续生效。L1冻结的是接受定义与来源，不代表已经实现MCP连接或执行器版本冻结。
- L1的历史证据仅覆盖内置工具；L2及后续实现已新增integrations包、锁定SDK，并扩展来源、冻结授权与unknown事实。

L1的集合边界、真实Pi/JSONL/预算/文件执行及装配差异回归已通过，具体验证命令、数量与边界见[首批验证](local-mcp-verify.md)。这些证据不代替SDK Server或完整MCP验收。

### stdio、信任与关闭

- 直接spawn明确程序和参数数组，不隐式执行Shell或安装依赖。M4.1本地Server要求注册工作根；命令、参数、cwd及环境来源在启动前可检查并单独确认。
- ask/auto沿用受监管macOS隔离，失败明确拒绝；full-access仅由用户选择。连接按Server revision、真实工作根、隔离策略、身份/凭据epoch隔离，不跨权限复用。
- 连接持有发现和调用租约，释放一个Run不误关其他Run。超时/无响应导致连接失效时结算所有依赖调用，按实际派发事实区分取消与unknown。
- 拒绝新租约后关闭SDK请求，停止所属进程组，确认exit/close与管道结束，再清理临时目录。关闭幂等可等待，不仅检查child.killed或等待上层Promise超时。
- 忙时编辑/删除默认拒绝；显式禁用/撤销使旧配置不能再启动或派发，已发出调用保留真实不确定结果。重新信任不恢复旧授权或重跑历史动作。

### SDK核对

截至2026-10-20，[官方TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)以拆包v2为稳定线，旧聚合sdk为维护线。已核对client/server 2.3.1的官方npm发布物、公开导出与Node>=20要求；实际TypeScript/Pi兼容测试已通过，client/server 2.3.1已写入catalog和lockfile。

采用[官方自定义Transport接口](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/advanced/custom-transports.md)，由execution拥有进程。发布物核对还确认了ReadBuffer跳过部分坏JSON、listTools自动聚合和调用内部重发的默认行为；严格分帧、逐页限制、冻结完整Tool及禁止自动履行/重发的具体规则统一见[协议与生命周期设计](local-mcp-contracts.md#6-官方sdk与持久stdio)，不能直接套用默认行为。

外部schema在发现阶段限制方言、大小、深度与引用并验证Pi可编译，再由调用路径按冻结定义校验；TSchema类型断言不能代替外部验证。结果文本、图片和structuredContent有界投影，参与推理的结构化值进入content；不支持媒体返回可读说明或受保护引用。

### UI与API

设置Dialog新增MCP页，提供Server列表、编辑、秘密专用入口、启停、信任确认、发现与诊断。输入框加号下MCP随实际能力完成解禁，选择有限工具；Skill保持原状态。服务端配置/状态使用Query，共享未提交选择按新对话代际或会话ID进入composer Store。

管理接口按Server CRUD、信任/撤销、发现/诊断拆分，使用revision冲突控制，危险动作显式POST/DELETE，GET不启动进程。全部沿用本机信任、应用登录、Origin/CSRF和安全响应校验；具体DTO与路径在配置阶段和全部消费者一起落地。

字段、路径、启停/信任与浏览器logout范围、队列选择及界面行为由[协议与生命周期设计](local-mcp-contracts.md)约束；已提供接口以[API入口](../../03_API/overview.md)为准。

### Acceptance Criteria

- AC-01：第一批接受审计、模型声明、预算与执行路由来自同一只读RunToolset，来源/指纹稳定；无工作区、无WorkRuntime及空工具场景准确，重名/缺失/非法参数被拒绝，旧审批/取消行为不变。
- AC-02：真实SDK Server经持久受监管stdio发现和调用；启动失败、输出超限、坏帧、取消、超时与退出均收束实际进程/管道，不用一次性Shell收集器冒充。
- AC-03：配置重启可恢复，秘密不回显或导出，修改使信任失效；设置及输入选择完整可用，两Run租约、撤销与权限隔离正确。
- AC-04：批准后才派发，派发前拒绝无调用；已发出但未确认结果记录unknown，重启不重跑。结果/schema真实进入Pi请求及JSONL，M1–M3回归和平台证据分别记录。

## UseCase

- UC-01：当前内置工具接受后读取接受审计及实际Pi请求，再执行一次工具；定义、参数及路由一致，预算使用同一集合。
- UC-02：用户创建Server并确认启动范围，发现后选择一个工具并批准调用；收到结果且日志可重建来源。
- UC-03：拒绝、停止、超时、撤销或退出；检查是否已派发、unknown记录、其他Run租约与所属进程/管道结束。

## Tasks

- [x] L1：统一当前RunToolset，迁移接受审计/模型/预算/运行时路由，完成真实Pi/JSONL消费、集合边界及原工具行为回归。
- [x] 细化L2–L5协议与生命周期设计，明确持久派发、原子结果、unknown停Run、共享连接关闭及SDK默认行为；本轮相应实现已落地。
- [x] L2：外部工具来源、冻结选择、派发/unknown协议与宿主codec/投影消费者。
- [x] L3：受监管持久进程、官方Transport/SDK和租约，完成取消/输出/回收fixture。
- [x] L4：配置、秘密、revision与信任管理、设置页及有限工具选择。
- [x] L5本机链路：真实Pi、JSONL恢复、Web与既有会话回归；Electron重打包、第三方Server和其他平台不冒充本机fixture证据。

## Issues

- 官方内置stdio进程拥有者不满足本仓库隔离/收束规则，使用实际自有execution进程拥有者；不因此复制官方协议实现。
- Pi动态工具声明和WorkContext旧system重建的协调仍归M4.2；本模块只冻结有限集合，不将动态加载标完成。
