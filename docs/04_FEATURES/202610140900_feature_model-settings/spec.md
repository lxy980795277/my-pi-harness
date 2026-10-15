# M1.6 模型设置与代码规范

## Spec

本页记录M1.6初始范围；后续六厂商目录和用户卡片设置入口由[Provider与侧栏精简](../202610150900_refactor_provider-navigation/spec.md)接续。

状态：实现与macOS本机验证完成，待用户统一体验验收。证据见[verify.md](verify.md)。用户授权按「更新Spec与功能编码 → 合并规范 → 按新规范检查和修复现有代码」连续完成，最终统一验收；本次不提交或推送。

### Intent

用户在浏览器和Electron中通过同一个设置弹窗完成模型选择、Provider配置、认证和模型管理。布局、字段粒度和操作流程按pi-harness当前模型设置对齐，使用shadcn独立实现，避免每次新建会话重复配置。同步将编码约束收敛为四份，并整改已有前端，使TSX主要承担布局和组件组合。

### Constraints

- 设置窗口按标杆实现为应用内Dialog，不新增操作系统窗口；两种入口共用Renderer。参考UI和可观察行为，不复制参考仓库业务源码。当前仅展示已实现的设置分类，不建立未来功能的假入口。
- 内置Provider按厂商固定展示，每个厂商只有一个当前配置入口；新增操作只创建自定义Provider。内置模型与端点由Pi目录拥有，用户只能启停和认证，不能通过内置编辑器修改名称、端点或模型。
- 自定义Provider表单包含名称、三种已支持协议、Base URL、是否需要API Key及认证；允许先保存空模型列表。模型增删改和逐模型连接测试位于单独Dialog，常规表单不展示compat或headers JSON编辑器。
- 全局默认模型包含Provider、modelId和thinkingLevel，持久化后用于新建会话。已有会话、队列与活动Run保持原有明确选择；无有效模型时给出配置入口，不静默发起其他模型请求。
- 密钥和OAuth Token仍由宿主凭据存储拥有。表单秘密只在局部Hook中短暂持有，提交或关闭时清理，不进入Query mutation variables、缓存、Zustand或浏览器持久化。关闭Provider认证Dialog取消其所属未完成OAuth流程，成功后刷新公开状态并关闭Dialog。
- 自定义无Key模式必须在真实HTTP中证明不发送占位Authorization、不读取环境凭据；保存、已配置和连接成功分别表达。切换requiresApiKey不自动删除已保存凭据，是否参与请求由显式认证设置决定。
- 已验证M1数据按已有安装处理：冻结0001及校验值，追加0002迁移。保留Provider ID、credentialRef、Session引用和已提交事件。旧重复内置账户保留兼容读取与凭据，不静默合并或删除；正常配置列表只展示一个厂商入口，迁移规则和兼容读取必须有测试。
- 前端手写TS/TSX禁止三目运算符、void运算符和Promise链式then/catch/finally；返回类型void与Promise<void>正常保留。异步操作使用具名async函数与try/catch/finally，必要异步启动集中在处理异常与取消的适配层，不全局关闭Promise检查。
- 纯计算、选项构建和多条件转换放.ts函数；请求、Query编排和副作用放.ts Hook。TSX保留布局、简单绑定和已准备数据的渲染，不机械为每个简单表达式创建工具函数。
- 业务组件使用shadcn基础控件，不直接写button/input/select/option/label等已有替代控件；components/ui内部可使用HTML。div/span用于普通布局，form、真实链接及必要语义保留，不能用可点击div/span冒充按钮。
- Web源码由Bundler解析，模块导入统一无后缀；样式与静态资源保留实际扩展。NodeNext宿主与共享包的相对ESM导入仍使用.js，跨workspace用包名。
- Radix需要的动态style使用页面nonce。生产HTML每次响应生成随机nonce并禁止缓存，Select/ScrollArea与弹窗滚动锁共享该值；script-src仍为self，不使用unsafe-inline或unsafe-eval解决样式问题。开发复用Vite相同meta格式，不将开发脚本例外带入生产。
- docs/05_CONSTRAINTS保留frontend、backend、desktop、testing四份规范和仅导航的overview；合并React、Zustand、TypeScript、安全、存储和禁止事项，删除重复及过期描述，更新全部引用。新增机械规则必须由实际门禁及拒绝用例证明。

### Acceptance Criteria

| ID    | 可验收结果                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------------------- |
| AC-01 | 设置Dialog在两种入口可打开、关闭及重新打开；聊天状态保留，布局、Provider卡片和二级Dialog按标杆对照检查     |
| AC-02 | 20个内置Provider固定单例展示，只有custom可新增或删除；自定义可保存空模型列表且支持明确无Key模式            |
| AC-03 | 内置模型只读；custom模型在独立Dialog增删改，逐模型测试呈现独立结果；模型与Provider修改保留并发冲突检查     |
| AC-04 | 默认模型与思考等级重启后保留，新会话采用默认值；无效默认不会触发模型调用，已有会话不改变选择               |
| AC-05 | API Key/OAuth交互收敛到Provider配置，关闭取消、成功刷新和秘密清理有行为证据；公开响应无秘密                |
| AC-06 | v1真实SQLite升级到v2后旧配置、凭据引用与历史保留，重复内置配置有明确兼容策略；迁移失败不伪装成功           |
| AC-07 | 四份规范是唯一规范来源，旧链接全部修复；新门禁确实拒绝三目、Promise链、void丢弃、裸控件与不合法导入        |
| AC-08 | 按新规范扫描并整改全部现有源码；格式、lint、类型、行为及真实浏览器回归通过，未验证平台与真实供应商明确记录 |

### 实现设计

协议升级为PROTOCOL_VERSION 2，新增Provider公开认证状态、requiresApiKey、模型能力与默认选择；持久HarnessEvent.version仍为1。模型Dialog持有本地草稿，最终通过Provider写接口一次原子保存整份模型列表，不增加第二套逐模型写入口。Web测试独立采用Bundler编译配置，Node配置不再通过测试入口追入无后缀Renderer源码。

Provider配置、模型与默认选择仍由agent-runtime通过ProviderStore拥有，storage提供版本化事务，daemon只校验和装配路由；前端Query拥有公开快照，Zustand只保存设置分类、Dialog选择与非秘密UI状态。默认模型由服务在新建会话时显式解析并检查可用性，再保存完整选择。

迁移通过builtin_provider_slots绑定当前厂商入口，仅将旧baseUrl为null且models为空的内置配置作为官方候选，按enabled优先、ID字典序决定唯一绑定。端点或模型曾被覆盖的配置一律保留为legacy，不把代理端点的凭据自动用于官方地址；没有安全候选时创建新的官方配置，不复制旧凭据。旧配置ID、credentialRef、版本记录和Session事件保持可读，正常配置列表不提供新增重复账户的入口。

已保存的provider_versions仅用于追加审计，迁移保留其JSON字节，不因当前DTO新增字段而重写；Run从既有私有codec读取冻结参数，不依赖新的历史配置读取API。配置和默认设置的revision拒绝并发覆盖，模型修改携带Provider revision。自定义协议、contextWindow与maxTokens的合法性由服务校验，UI只显示相应错误。

## UseCase

| UC                   | 操作                                                       | 预期与异常                                                             |
| -------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| UC-01 内置配置       | 打开设置，查看厂商列表，启停并配置认证，打开模型列表       | 无需添加内置Provider；模型目录只读，未授权状态和认证方式明确           |
| UC-02 自定义Provider | 创建名称/协议/地址/Key要求，保存后打开模型Dialog并添加模型 | 可分两步保存；模型ID、上下文、输出限制、reasoning可编辑，非法输入拒绝  |
| UC-03 默认与新会话   | 选择默认模型/思考等级，刷新或重启，再创建会话              | 默认持久化并自动采用；停用或删除后提示配置，现有会话保留其选择         |
| UC-04 凭据与OAuth    | 输入Key并保存，开始OAuth后关闭Dialog，或完成授权           | 临时秘密清理，取消与完成按服务事实显示；失败可重试，不能残留秘密到缓存 |
| UC-05 无Key服务      | 关闭requiresApiKey，添加模型并测试及对话                   | 真实本机HTTP成功且无Authorization头；打开Key要求后按认证状态拒绝缺凭据 |
| UC-06 数据升级       | 使用有会话、凭据引用及重复内置账户的v1数据库启动           | 迁移保留原ID和事件，旧会话可读取；单例入口与兼容账户归属稳定           |
| UC-07 规范整改       | 执行新lint及源码检查、类型和已有回归                       | 现有代码通过，故意违反新规则的隔离fixture被拒绝，无全局规则放宽        |

## Tasks

- [x] 记录已确认UI、Provider粒度、四份规范及代码风格范围。
- [x] 实现Provider目录/认证要求、模型管理、默认选择协议与追加迁移，验证旧数据兼容。
- [x] 用shadcn实现设置与二级Dialog、默认选择及授权生命周期，独立对照标杆体验。
- [x] 合并四份规范、更新AGENTS与全部文档引用，补齐新静态门禁及拒绝用例。
- [x] 按新规范检查全部已有源码并修复，完成模型、会话、授权、浏览器与桌面相关回归。
- [x] 实际验证后编写verify，更新用户指南、功能索引和里程碑，交付统一验收。

## Issues

- 已扩大前端静态检查至手写TS/TSX，并替换原生Select包装与使用方；拒绝用例覆盖新规则，秘密提交不进入mutation variables。
- 旧Provider多实例通过追加迁移兼容，原ID、凭据与会话历史保留。
- 真实浏览器回归发现并修复受控Dialog关闭焦点丢失和OAuth嵌套form。独立审查补齐OAuth-only入口限制与草稿初始revision，避免旧草稿携带新revision覆盖配置。
- Pi底层SDK会读取进程环境中的认证、租户和自定义头。已在独立daemon启动时集中清理已知SDK变量，保留显式配置请求头；无Key模式在实际HTTP中验证，不能仅依赖表单开关。
- Radix动态style需要共享nonce；生产HTML响应使用新nonce且不缓存，非法nonce仍被CSP拒绝。
