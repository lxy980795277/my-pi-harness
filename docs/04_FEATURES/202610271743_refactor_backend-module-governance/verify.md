# 后端模块治理验证

日期：2026-10-27。治理验证阶段产品0.9.0，协议17，SQLite schema8；macOS arm64、Node24.20.0、pnpm10.34.6、Chromium。范围为M0工程范式及M1–M4维护，未进入M5；用户后续要求按0.9.1执行本地提交流程，历史各轮记录保留当时状态。

## 目录与职责

六处src根层TS由118个收敛为8个：daemon仅bootstrap；execution与integrations仅index；protocol为index/version；storage仅index；agent-runtime为index/errors。首轮保留的integrations根错误文件已在二次复查中归回领域。daemon无features层，应用装配与HTTP独立，领域直接挂src。架构与各包README说明当前职责，权威API/技术文档的源码链接及符号已同步。

实际职责调整：

- execution根执行实现归core/execute，共享sandboxProfile归process/sandbox，Office具体实现由office/index改为office/executor；内容提取Worker与Office生成编辑分别归documents和office。
- integrations的MCP实现归mcp，插件/MCP/手动账户共享远端访问归network；McpError、NetworkError、PluginError与SkillError分别由其领域拥有，保持错误码、固定诊断与明确宿主映射。
- protocol根宿主schema和桌面桥归host，index只公开导出；storage通用持久数据校验与会话事件schema分开。
- ModelSettingsRepository拥有8个模型配置方法，ProfileStore从961行降至885行，保留锁、JSONL/SQLite提交、恢复和写失败冻结；仓储仍由同一transaction入口写入，既有提交失败测试补充配置写入拒绝与重启恢复断言。
- runtime分离ProviderStore和会话端口，模型认证、工具执行、能力发现、工作状态及请求上下文分别归属；daemon的SkillsPort转换和审批上下文归所属领域，访问校验及安全错误映射从路由装配分开。

## 冗余清理依据

删除runtime无消费者的RunCapabilities.selections方法、RunToolSource纯别名及context/index内部转发；revoke只有本类消费者，改为private。Skill grants原Map的值没有读者，所有消费者只检查ID的存在和撤销，改Set；持久化事件中的工具名称仍保留。

移除execution的office执行模块及根入口中重复转导，收窄integrations根网络出口；createRemoteFetch、assertRemoteAddress、RemoteNetworkOptions仍有包内实际消费者，内部保留。多个仅所属模块使用的声明取消export，删除daemon重复realpath调用及两个无外部消费者的内部导出。不把公开函数参数/返回类型、实际动态加载资源或SDK适配当成死代码；未新增依赖、utils容器或旧路径转发文件。

独立交叉审查逐项核对迁移前后AST：执行入口、沙箱、HTTP访问/错误回调、宿主schema、事件校验及ProviderStore抽取保持原实现；8个模型配置方法只改变事务调用对象。storage、protocol及runtime根公开导出名称集合不变；8个历史迁移文件逐字节不变，不调整SQL顺序、checksum或数据版本。

## 静态与源码

实际执行：

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
git diff --check
```

首轮lint发现新导出函数缺少显式返回类型，补齐ApprovalContext后重新执行通过。最终lint覆盖743个源码导入、801个源码规范文件及当时172个文档，版本检查通过；新增本验证文档后另执行文档与格式检查。全仓typecheck的8项任务通过。

源码Vitest为152个文件通过、1个文件跳过；1499项通过、2项跳过，耗时64.16秒。跳过项不计为本轮覆盖。没有以源码路径检查冒充构建产物验证。

临时TypeScript AST脚本读取六处src的227个文件：相对模块导入缺失0、包内反向引用根index为0、包内相对值导入图的强连通环为0。权威文档源码路径与链接、daemon领域README和各包README链接另实际扫描，缺失0；脚本是本次审查手段，没有加入新产品依赖或常驻检查框架。

## 干净构建与产物

清理8个明确拥有且未跟踪的dist目录后实际执行：

```sh
pnpm build
pnpm test:artifact
```

8项构建任务全部实际执行并通过，非旧产物缓存恢复；daemon产物2文件6项通过。新bootstrap、http/server及五包新模块JS实际存在，映射中已移走的旧平铺JS、声明及source map残留为0。bootstrap源码/产物入口保留；daemon package exports与E2E启动器4个直接产物导入已同步；config在src/application和dist/application均正确定位仓库根。

Office Python资源相对目录、插件隐藏App声明资源位置及Worker模块解析保持原语义。构建仍有既有Electron renderer配置与Web大chunk提示，未借此扩大修改范围。

## 浏览器

显式设置MY_PI_HARNESS_OFFICE_PYTHON为本仓库.cache/office-venv/bin/python，执行：

```sh
pnpm exec playwright test tests/e2e/plugin-connection.spec.ts tests/e2e/connection-oauth-launch.spec.ts tests/e2e/skills-plugins.spec.ts tests/e2e/mcp-expansion.spec.ts tests/e2e/office-artifact.spec.ts --output=output/playwright/backend-governance-20261027
```

5文件20项全部通过，耗时50.1秒，2个worker。使用真实新构建Web/daemon、独立临时profile和动态端口；覆盖插件/高级账户两种授权、取消/失败/关窗/弹窗拦截、主子开关、独立MCP配置，以及GitHub授权→开启App→重启→普通中文输入→搜索自动加载→官方SDK调用与日志。Office场景实际启动Python Worker、审批创建DOCX并下载，下载字节与磁盘输出相同，未因缺环境跳过。

供应商授权及模型服务由合成上游隔离，没有访问真实账户或产生模型费用。没有重新执行真实GitHub仓库读取、Google同意/API、本地语义模型下载、DOCX页面视觉、新Electron安装包、签名、公证或Windows验收。上述产品验收仍沿用M4原缺口，本轮Pass仅表示目录/职责治理的AC1–AC5及UC1–UC4在已述工程范围通过。

## 错误归属与重复逻辑二次复查

用户指出integrations根errors.ts后，复查确认首轮保留理由不足：共享网络及插件OAuth使用McpError，体现的是消费者错域。现将McpError归mcp/errors，网络独立使用NetworkError，插件声明/安装/授权使用PluginError，PluginOAuthError不再继承SkillError；真正Skill读取/解析错误保留。MCP传输与OAuth显式保留NetworkError，宿主目录/草稿测试识别原安全错误码；不在全局HTTP处理器公开所有网络错误，不改变高级Connections的既有失败/撤销语义。

进一步清理：SkillScope、SkillResource、SkillResourceContent等公开类型复用protocol，FrozenSkill只排除宿主后续附加的gatewayUrl；独立Connections声明直接读取对应App文件，不再依赖整个市场catalog。共享OAuth启动票据归http，使用独立固定OAuthLaunchError；独立MCP的两条launch路由归mcp，插件路由仅拥有插件逻辑。RuntimeError跨整个runtime及宿主能力端口承担公共失败约定，保留包级位置并补充说明。

附件、Skills、工作状态压缩和MCP探测/发现复用requestOperation，删除重复监听与清理包装。新增封闭ResponseClosePolicy保留原有差异：附件always、Skills/MCP按writableFinished、压缩按writableEnded；这些调用显式null保留操作所有者deadline，原默认30秒和Office artifact/preClose不变。

定向回归分组有交集，不累加为唯一总数：integrations7文件86项、daemon插件7文件61项、最终App/五服务映射15项、网络与目录/草稿3文件43项、票据生命周期7项均通过；取消辅助及相关API6文件54项通过，最后helper兼容测试fixture修正后8项再次通过。相关文件ESLint及格式通过。

根另实际执行以下补充用例，3文件29项通过：

```sh
pnpm exec vitest run packages/integrations/test/remote-oauth.test.ts apps/daemon/test/connections.test.ts apps/daemon/test/mcp-catalog-lifecycle.test.ts --maxWorkers=2
```

二次全仓pnpm lint与pnpm typecheck通过；随后取消辅助变更另通过所属文件ESLint及最终daemon类型面。清理integrations和daemon旧dist后pnpm build通过（8项任务，5项复用缓存，两个已清理宿主/集成任务实际编译），pnpm test:artifact再次2文件6项通过。旧根errors和插件目录launch-tickets产物残留为0。

最终使用显式Office Python重跑上述5个浏览器文件，输出目录为output/playwright/backend-governance-errors-20261027：20项全部通过，44.8秒。包含错误提示、弹窗/票据、独立MCP、Skill创建与真实Office Worker下载链路。没有重跑无需变化的其他源码测试，也未扩大真实账号和平台验收声明。

最终230个源码文件相对导入扫描无缺失、无包内根入口反向导入及相对值导入环；根层剩8个TS文件，集成包仅index。文档/格式/空白在本次追加后另检查，未暂存、提交或推送。

## 模块声明组织

查阅Google TypeScript指南的source-file-structure与TypeScript typeof类型查询说明；官方资料未规定类型和常量的唯一先后，本项目选择imports→纯类型→常量/schema→模块状态→实现及启动。统一规则由[源码声明组织](../../05_CONSTRAINTS/source-layout.md)拥有，前端、后端与测试约束链接引用。

最终扫描578个手写TS/TSX源码文件、634个模块类型声明，分组违规0；生成version.ts不参与。57个文件机械重排时逐文件核对顶层语句正文集合不变；其他必要调整为抽取共享strictObjectSchema、完整构造网络BlockList及整理Renderer启动和lazy加载。局部变量、ambient声明作用域、Worker与SQL字符串未做排序，未新增依赖。

独立复核对比protocol的17个模块初始化器token与相对顺序，未见运行时变化；两个网络文件各3组20条子网规则的地址、前缀、地址族与顺序保持一致。schema辅助构造器保留泛型推导；Renderer保持root检查、nonce、OAuth票据清理和render顺序，模型页仍按需导入。

新增AST规则接入既有源码gate，覆盖晚置类型、非函数const、模块状态和直接函数初始化器；纯规则及实际文件gate合计85项通过。检查仅判断模块语法分组，不推断memo/lazy返回值或证明副作用时序；语义复核和行为测试单独提供证据。

本轮实际执行pnpm lint（749个导入检查、809个源码规范文件、174个文档）、pnpm typecheck（8项workspace任务）及pnpm test，均通过。源码测试155文件通过、1文件跳过；1559项通过、2项跳过，56.76秒。pnpm build的8项全部实际构建通过，无缓存恢复；pnpm test:artifact为2文件6项通过。既有构建提示不扩大处理范围。

显式提供本仓库Office Python，执行同上5个Playwright文件，输出目录为output/playwright/backend-declarations-20261027：20项全部通过，45.8秒。覆盖新Renderer入口、授权中转与ticket清理、插件/Skill/MCP及真实Office Worker产物下载；仍使用合成OAuth及模型上游，不声明真实账号或桌面平台验收。AC6与UC5在上述范围通过。

另执行pnpm exec playwright test tests/e2e/settings.spec.ts -g '设置内容加载中保留弹窗' --output=output/playwright/backend-declarations-settings-20261027，1项通过、6.2秒；真实阻塞lazy资源后观察设置loading、关闭/重开、加载完成的模型厂商界面、草稿和焦点，补充模型设置惰性导入证据。最终pnpm format:check通过，追加验证说明后另检查文档格式、文档链接及git diff --check，未暂存或提交。
