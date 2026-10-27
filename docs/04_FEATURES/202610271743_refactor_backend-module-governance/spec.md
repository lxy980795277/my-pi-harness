# 后端模块组织与职责治理

## Spec

### Roadmap Alignment

属于M0工程范式及M1–M4已实现模块维护，是M5设计前的代码治理；不增加产品功能，不改变M4必要账号、视觉及平台验收的剩余状态，M5仍未开发。用户已授权目录重组、冗余/未使用内容删除、职责修正及必要重构，并在治理验证后要求本地提交；提交版本为0.9.1，不推送。

### Intent

按实际职责整理daemon、execution、integrations、protocol、storage及agent-runtime源码，使领域、启动装配、传输、持久化和执行能力能从目录识别。治理包含核对消费者、清理失效导出与重复实现、移除过渡转发层和修正已确认的职责混放，不以单纯移动文件作为完成标准。

### Constraints

- daemon移除features层，领域直接位于src；application管理进程配置、启动准备及服务生命周期，http管理Fastify、全局路由和请求生命周期。保留bootstrap启动入口。
- execution按core、filesystem、process、documents、web、office分组；integrations按mcp、network、skills、plugins、connections、search分组；runtime按models、sessions、runs、tools、capabilities、work、context分组。
- storage按profile、sqlite、sessions、repositories、credentials组织；protocol按application、sessions、tools、extensions、host组织。少量包级错误、校验和生成入口允许保留，不创建无归属utils或每文件一目录。
- 根index仅公开实际API；内部实现直接导入所有者，禁止依靠旧路径转发文件维持迁移。跨包继续使用包名、NodeNext相对导入保留.js。
- 删除前核对源码、测试、公开入口、动态注册、Worker、资源和构建消费者；保留实际能力，不将测试替代为仅验证目录存在的用例。
- OAuth、策略、取消/关闭顺序、持久屏障和JSONL事实语义不变；SQL迁移内容、顺序、校验和、schema版本8及协议17不变。治理验证使用产品0.9.0，用户授权提交时按发布规范同步修订版本0.9.1。不读取真实.env，不修改用户运行数据。
- 同步测试、构建后直接导入、资源相对路径、文档及检查脚本的真实路径。为结构治理引入新工具或依赖前先证明必要性。
- 全部apps/packages手写TS/TSX按[声明组织规范](../../05_CONSTRAINTS/source-layout.md)集中类型、常量/schema及模块状态，再声明实现；保留原有运行时依赖与局部作用域。

### Acceptance Criteria

- AC1：六个src按上述实际职责分组，daemon无features目录；根层只保留明确入口或包级定义，无旧路径转发壳。
- AC2：execution入口执行逻辑、protocol宿主协议、共享进程沙箱及runtime端口类型归属清晰，storage跨介质提交和恢复仍由单一拥有者编排。
- AC3：实际发现的无消费者导出、过渡代码、重复配置及错误依赖得到删除或合并，清理依据和保留理由可追踪。
- AC4：类型、lint、格式、源码行为检查通过，干净构建和daemon产物检查通过；关键授权、目录恢复、工具发现浏览器场景保持现有结果。
- AC5：架构、包README及源码路径引用同步；验证记录区分源码、构建、浏览器与未执行的真实账号/桌面平台验收。
- AC6：源码中的模块类型、常量/schema及实现分别集中，新增规范检查实际接受合法布局、拒绝穿插声明；schema推导、网络规则及启动顺序保持原行为。

## UseCase

- UC1：开发者从src定位登录、会话、MCP、工具或存储职责，无需遍历平铺前缀文件；公共入口仍能导入既有API。
- UC2：源码与干净构建均启动独立daemon，配置定位同一仓库根，Web资源、插件声明和Office执行资源正确解析；失效配置仍明确拒绝。
- UC3：隔离profile完成插件授权、App启用、重启恢复、普通输入检索与动态工具调用；取消和关闭不遗留所属工作，不泄露合成秘密。
- UC4：临时SQLite/JSONL重放、分支和工具恢复仍遵守现有测试；迁移SQL及数据版本不因目录变化改变。
- UC5：开发者在文件开头连续阅读类型和常量；lint定位违规声明，初始化所需辅助构造器与局部变量不因分组发生前向值访问或作用域变化。

## Tasks

- [x] 声明组织治理：核对官方资料并制定imports→types→constants/schema→implementation规则，写入共享规范并接入前后端入口。
- [x] 声明组织治理：扫描所有apps/packages手写TS/TSX，将模块类型及常量分区；保留局部作用域、Worker/SQL正文及初始化副作用。
- [x] 声明组织治理：消除schema构造器和lazy/bootstrap的立即初始化依赖，增加AST检查及真实接受/拒绝fixtures，执行类型/行为/产物回归。

- [x] 二次复查：McpError回归MCP、共享网络使用NetworkError、插件自有异常使用PluginError，同步固定诊断和错误映射。
- [x] 二次复查：复用protocol的Skill类型，整理共用OAuth启动ticket与独立MCP路由归属，执行对应回归并补充验证。
- [x] 二次复查：独立连接声明绕开整个插件市场catalog，合并重复HTTP取消包装并显式保留各调用方关闭策略与deadline。

- [x] 建立当前文件归属、消费者与实际路径清单。
- [x] execution/integrations分组，抽共享沙箱和执行入口，清理真实冗余。
- [x] protocol/storage分组，抽宿主协议及存储查询/配置职责，保持原子提交编排。
- [x] agent-runtime分组，整理模型/会话端口与上下文归属，清理失效导出。
- [x] daemon去features并整理application/http，同步入口、E2E及资源定位。
- [x] 检查内部循环/根入口反向依赖、重复定义、未使用内容及动态资源。
- [x] 同步架构、README和权威路径；执行静态、源码、构建产物与关键浏览器验证。
- [x] 根据实际结果生成verify并交付工作区，不自动提交。

## Issues

首轮lint拒绝新抽取的approvalContext缺少显式返回类型。补充领域内ApprovalContext声明后重新执行lint通过；原私有函数移为模块导出时须补齐导出声明约束。

二次复查发现首次只按照现有消费者保留McpError在包根，未纠正共享网络与插件OAuth依赖MCP错误的原因。进一步核对发现插件自有错误借用SkillError、Skill类型手抄公共协议、独立MCP授权启动路由放在插件连接模块。按真正错误/类型/请求所有者拆分，保留HTTP分类、固定安全诊断及运行事实语义；不能以“已有多个消费者”代替职责归属判断。
