# M5 子 Agent 与任务看板验证

日期：2026-10-29，北京时间。环境为macOS arm64、Node24.20.0、pnpm10.34.6、Chromium；产品保持0.12.0，公开协议19、SQLite schema9。M5.1–M5.5工程实现与本机自动化验证完成，尚未提交或推送。真实供应商、Electron和Windows实机不在本轮通过范围。

## 实现结果

主Agent具备spawn_agent、get_agent_status、wait_agents、send_agent_message和stop_agent。稳定Task表示委派任务，每次实际Pi执行仍由RunExecution拥有；不创建隐藏Session或第二套模型循环。新Task先写入JSONL，准备后子Run和初始输入同批接受，初始化失败保留明确终态。根会话、各Task的模型上下文、WorkState、交互和队列独立。

角色、模型及限制在接受时冻结，嵌套只可收窄父能力。只读角色剔除Shell和未知写工具，动态MCP/Skill仍经过原授权；写入拥有者由宿主在实际工具派发前检查。预算覆盖真实模型请求，包含自动摘要与独立AI审批，等待不占模型并发名额。树级唯一余额在请求前预留，缺少Usage时不声称精确费用。

通信与消费先持久化，实际输入关联唯一agentMessageId。SDK正文明确标为Agent任务资料，主聊天及对话计数不冒充用户提问；审批上下文仅从真实根用户输入取得授权依据。显式续作创建新Run，直接父Run收束后拒绝复活任务。停止等待真实执行结算，父终态先结算后代；unknown与持久化失败停止所属树。重启仅重建事实并中断在途执行，不重跑模型或外部副作用。

Web新增独立任务看板、会话固定任务入口、任务树、按需分页详情及角色设置。原提问、计划审核和工具审批复用原ID，待处理入口不藏在过程折叠中；关闭详情保留内存草稿。Query拥有服务端事实，Zustand仅保存展示及未提交输入。全局SSE忽略逐token变化，活跃详情单独刷新，主聊天不随子delta重建。

## AC 与 UseCase 证据

下表的通过指本机工程范围；AC-11的平台与真实供应商部分继续为Not verified。

| 验收项 / 场景     | 实际证据                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01、02 / UC-01 | agent-runtime.test.ts使用真实Pi、临时JSONL/SQLite及受控模型完成委派、子请求、等待及主汇总；断言根/子SDK会话亲和ID独立、根快照不含子转录。m5.spec.ts验证页面入口、结果和刷新后历史。                   |
| AC-03 / UC-02、03 | agent-runtime、agent-collaboration和agents-budget测试覆盖并行嵌套、并发1下的等待、祖先及跨树拒绝、通信和显式续作；等待绑定接受时Run，失败续作不回用旧成功答案。                                       |
| AC-04 / UC-04、05 | task-toolset、task-work及tool-ownership验证能力收窄；agent-effects实际写入临时文件，验证嵌套写入归还有效祖先，MCP未知结果停止根和兄弟执行且不自动重试。                                               |
| AC-05 / UC-06     | agents-budget、agents-failures和approval-review-guard验证原子预留、祖先上限、取消/释放、缺Usage、最后允许轮的正常完成、摘要及独立审批复用受限传输。                                                   |
| AC-06 / UC-03、09 | context-agent-message、agent-collaboration及storage agent-tasks验证持久来源、单次消费、幂等重试与续作；内部消息不能经编辑重发变为用户授权。m5.spec.ts验证通信到达父模型且主聊天不新增用户气泡或次数。 |
| AC-07 / UC-08     | 运行时测试覆盖准备阶段停止、流式停止、子树及全树结算、父提前结束、失败和慢清理；m5.spec.ts从任务详情停止实际模型流并观察父收到取消结果。                                                              |
| AC-08 / UC-07     | task-work与daemon agent-api验证原Task/Run问题、计划及审批来源和过期提交；approval-context排除Agent通信冒充用户授权。m5.spec.ts实际填写子问题、关闭重开保留草稿并提交原等待。                          |
| AC-09 / UC-08、09 | storage agent-tasks使用临时JSONL/SQLite重建与恢复，校验关系、分支锚点、通信消费及自底向上中断；agents-failures和agent-effects验证持久化/unknown失败后的真实清理。                                     |
| AC-10 / UC-10     | task-view、work-drafts、conversation-view及浏览器覆盖树/看板/详情一致、服务端筛选分页、原表单和会话计数；待批准工具跨消息页仍可见，AI reviewing不算人工待处理。                                       |
| AC-11 / UC-09、10 | agent-change-stream、session-stream-connection及agent-updates覆盖鉴权、释放、子delta过滤、重连和在途失效补刷；M5浏览器覆盖主题、600px窄屏、选择和刷新。桌面实机部分未运行。                           |

源码测试位于各所有者的test目录，浏览器场景位于tests/e2e/m5.spec.ts；不以受控模型替代真实供应商质量或延迟验收。

## 实际命令与结果

所有命令先将仓库.cache/node/node-v24.20.0-darwin-arm64/bin加入PATH。检查使用独立临时profile/目录、动态端口和合成认证，不读取真实.env、密钥或用户会话。

| 命令 / 范围                                                                                                                                                                                                                   | 结果与执行顺序                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm lint                                                                                                                                                                                                                     | 工程收尾前通过ESLint、Oxlint a11y、843源码文件导入、909文件源码约定、198文件文档和版本检查。随后Hook/测试的增量检查及文档收尾检查单独记录。  |
| pnpm typecheck                                                                                                                                                                                                                | 全workspace源码通过，8个任务成功；含根程序、E2E和Web独立测试编译面。                                                                         |
| pnpm test                                                                                                                                                                                                                     | 全量1735项通过、2项跳过，179文件，61.18秒；此轮早于最后SSE Hook修复。                                                                        |
| pnpm exec vitest run packages/agent-runtime/test/agent-runtime.test.ts apps/daemon/test/session-stream-connection.test.ts apps/daemon/test/approval-context.test.ts packages/agent-runtime/test/approval-review-guard.test.ts | 20项通过，覆盖后续SDK亲和隔离及授权来源收尾。                                                                                                |
| pnpm exec vitest run apps/web/test/task-view.test.ts                                                                                                                                                                          | 4项通过，包含准备续作期间的停止入口。                                                                                                        |
| pnpm exec vitest run apps/web/test/agent-updates.test.ts apps/web/test/async-event.test.ts                                                                                                                                    | 最后Hook修复后4项通过；模拟延迟查询期间的新通知、重连以及旧Effect结束后新订阅仍在工作。相关ESLint和Web typecheck通过。                       |
| pnpm build                                                                                                                                                                                                                    | 最终8个任务成功、7个缓存，13.305秒；重新构建包含最后Hook修复的Web。保留既有renderer config与大chunk提示。                                    |
| pnpm test:artifact                                                                                                                                                                                                            | 构建后daemon CLI、IPC、恢复及退出测试2文件6项通过，12.98秒；之后仅改Web Hook和测试fixture，daemon产物未变。                                  |
| pnpm exec playwright test tests/e2e/m3.spec.ts tests/e2e/m5.spec.ts tests/e2e/m1.spec.ts tests/e2e/approval.spec.ts tests/e2e/answer-process.spec.ts tests/e2e/mcp-expansion.spec.ts tests/e2e/skills-plugins.spec.ts         | 25个场景中21个当轮通过，4个计数/fixture问题修复后纳入下一行；覆盖发送/队列/分支、过程折叠与阅读位置、审批、上下文、远程MCP、Skill/插件及M5。 |
| pnpm exec playwright test tests/e2e/approval.spec.ts tests/e2e/m3.spec.ts tests/e2e/m5.spec.ts                                                                                                                                | 最终构建下15项全部通过，41.9秒；含上述4个失败的修正回归及最后Hook修复后的M5。与上一行重复场景不累计为新增通过数。                            |
| pnpm exec tsc -p tests/e2e/tsconfig.json --noEmit                                                                                                                                                                             | 最终fixture修复后通过；m3-model-server、m3.spec、approval-model和approval.spec的定向ESLint及格式检查通过。                                   |

全量测试的较早一次并行运行曾使既有ESLint冷启动用例超过10秒。该用例单独运行5.43秒通过，随后不与其他重型检查争用资源的全量运行通过；未延长超时、跳过断言或改为自跳过。

M3与审批浏览器回归暴露8K fixture更早自动摘要：M3假模型只看原user消息，漏读系统区明确保留的当前任务；审批假模型把摘要请求误当普通工具请求。已精确读取保留任务、返回合法结构化摘要，并分别核对主请求、AI复核和实际compactions，保留原8K窗口、超时及业务断言。

已查看output/playwright/m5-task-detail-light.png及m5-task-detail-dark-narrow.png：浅色详情与深色600px窄屏可读，原人工表单位于任务详情，不在主聊天复制子转录。截图为本地忽略输出，不提交。快速体验步骤见[用户指南](../../07_USER_GUIDE/子Agent与任务看板.md#快速体验)。

## 收尾与验证边界

收尾执行pnpm format:check与pnpm lint全部通过，包含ESLint、a11y、844源码文件导入、910文件源码约定、199文件文档和版本检查；git diff --check通过，暂存区为空。架构、协议、技术设计、用户指南、任务清单与roadmap已同步；产品版本和发布记录不提前变更。

截至上述工程轮次，Not verified包括真实模型供应商及费用/延迟、真实服务账户、M5在Electron窗口中的实际操作和安装包、Windows实机，以及用户体验验收。2026-10-30的真实模型及macOS应用目录补验见下节；完整Trace/费用、记忆和搜索仍分别属于M7/M6。

未清理真实会话或数据库，未启动或终止用户已有开发端口，未提交、推送或创建发布记录。未为本轮新增依赖，未预建M6接口。

## 审批继承与只读能力修复（2026-10-30）

AC-12 / UC-11在macOS、Node24.20.0、pnpm10.34.6及受控Pi/Chromium链路中通过，待用户体验。子Run继承父Run冻结的approvalMode；AgentRunHooks从已冻结角色提供只读能力，RunExecution合并既有会话只读上限，ToolRuntime在批准、写入仲裁与派发之前统一拒绝受限副作用，底层执行复用同一readOnly。写入拥有权只负责实际写入协调，不再兼任角色判断。

原问题先在真实浏览器复现：父输入栏为完全访问，调查子任务的网页GET仍等待批准，父汇总无法完成。修复后full-access自动批准、ask保留人工批准、auto经过独立模型复核；角色仍为read-only。POST、文件写、Shell和未具备有效只读授权的MCP均不派发，动态加载、嵌套与续作保持冻结约束，request_skill_tools的独立人工授权保留。

动态Skill回归另先复现RunToolset重建时指纹漂移及存储拒绝：构造器现在只从definition/source/external归一后计算指纹；advance直接复用该入口，调用方的重复清理和占位指纹删除。没有新协议字段、改写历史指纹或增加权限。

实际检查：

- `pnpm exec vitest run packages/agent-runtime/test apps/daemon/test/agent-api.test.ts apps/daemon/test/approval-context.test.ts apps/daemon/test/plugin-connection-api.test.ts`：37文件234项通过，22.24秒。此前新增审批策略、动态工具、授权失效、角色冻结和工具集重建回归也已定向验证，重叠结果不累加。
- `pnpm typecheck`：根/E2E及8项workspace类型任务通过；最终存储变更后storage独立typecheck、Web最终build中的三类类型面及纯类型整理后的Web测试tsc均通过。
- 最终后端`pnpm build`：8项成功、4项缓存，12.575秒，包含治理后的协议21与codec；Web最终单独build通过，产物index-BI_skznk.js包含迟到请求保护。构建保留既有Vite体积提示。
- `pnpm exec playwright test tests/e2e/m5.spec.ts --grep 'M5 只读角色保留|M5 真实委派隔离|M5 子任务补充响应丢失' --workers=1`：最终5项通过，26.8秒；三种审批策略、主委派和治理后的重试路径均使用真实临时daemon/Pi/HTTP。此前完整M5的7项浏览器回归通过，后续按新差异仅重跑上述5项。
- 最终普通`pnpm lint`通过，包含ESLint、a11y、864源码导入、932文件声明约定、当时202文件文档及版本检查。工具内存和治理补充的证据见[治理验证](../202610300028_refactor_m5-code-governance/verify.md)。

已查看output/playwright/m5-readonly-full-access-get.png，调查子任务的GET返回HTTP200且已完成，没有待批准按钮。请求目标为测试进程精确注册的本机网关路径，缺少网关令牌仍403；没有放宽生产公网地址限制、访问真实天气服务或调用用户模型。准备阶段故障、产物下载、查询及日志优化由同次[代码治理](../202610300028_refactor_m5-code-governance/spec.md)记录。本工程轮次未覆盖真实供应商、Electron/Windows实机及用户体验；后续实际补验见下节。修复需完整重启项目后重新发起子任务，已有等待不会被改写为自动批准。未提交。

## 真实模型与macOS桌面补验（2026-10-30）

本轮使用产品0.13.1、公开协议21、SQLite schema9，macOS arm64、Node24.20.0、pnpm10.34.6、Electron43.7.9，实际模型为原生DeepSeek Provider的DeepSeek V4.1 Flash，推理关闭。模型请求经过真实供应商；应用登录使用独立合成身份，不能记为真实GitHub登录或插件账号授权验收。

先执行`pnpm package:desktop`，8项构建成功、无缓存，14.053秒，随后`pnpm smoke:desktop`通过。产物为`release/mac-arm64/My Pi Harness.app`应用目录，使用捆绑Node启动实际daemon；不是DMG安装测试，也未签名或公证。保留既有renderer config、Vite chunk体积和pnpm deploy提示，打包与启动均成功。原桌面smoke覆盖资源、来源隔离、preload、工作区桥及真实退出，不将其计为模型或M5场景证据。

真实场景使用专属临时profile、日志根、合成工作区及动态端口。仅只读取得已有模型配置及凭据，在临时Keychain namespace使用，结束后已删除并复查为空；未改原账户、凭据、会话、数据库或工作区，用户的5174/4311服务保持运行。一次性控制器只负责隔离启动、测试登录、只读API快照及精确识别所属daemon后的故障注入；点击、输入、刷新、退出和截图来自实际Electron窗口。隔离准备时曾因路径未canonical而被真实路径校验拒绝，修正测试目录realpath后执行；没有修改生产路径策略。

### 实际用户链路

| 场景                       | 结果与证据                                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A / AC-01–03、10           | 两个调查任务并行，其中一个再委派审查任务；真实读取合成facts.json，主回答汇总600，三个子任务均完成。任务树可选择嵌套详情，看板工作区筛选后仍为三个终态。根专用标记仅在根的三次请求中出现，八次子请求均不含该标记；三次spawn参数也未转发。两直接子Run重叠4,224ms。主聊天保持一次用户提问，不混入子转录。 |
| B / AC-08、10              | 子任务真实ask_user，选择“分月”并填写未发送补充，关闭重开仍保留草稿。提交原问题后子任务继续读取并完成。父模型在一次60秒等待后提前给最终答复，进入收束时新补充被拒绝；这一负向边界单独记录，不冒充通信成功。                                                                                             |
| B2 / AC-06、08             | 父模型继续等待时，发送补充标记M5_COMM_OK_1030，再回答子任务原问题。任务通信、子最终答案及父最终汇总均含该标记；根仍只有一次用户提问。                                                                                                                                                                  |
| C / AC-07、09              | 停止一个子任务后，另一个仍等待；约13.8秒后根的新供应商请求失败，树清理取消剩余任务。保留失败原因及部分用量，不将此轮算作成功的整树手动停止。                                                                                                                                                           |
| C2 / AC-07、08             | 只点“停止此任务”时，手停甲取消、手停乙仍为waiting/user，根保持运行。再点主输入框停止，根及剩余子任务取消、活动Run和人工等待清空；断言与实际窗口一致。                                                                                                                                                  |
| 刷新与正常重启 / AC-09、11 | CmdR后可从侧栏重开历史及任务详情。CmdQ后对应daemon PID消失、原端口ECONNREFUSED；同profile重启的五个历史会话，其完整公开快照、任务列表及详情逐项相同，序号不增。                                                                                                                                        |
| D / AC-09、11              | 原人工问题待回答时，校验当前Electron实例、精确daemon命令及直接父子PID后，仅SIGKILL该daemon。窗口退出后同profile重启，根Run、子Run、Task及ask_user均interrupted，旧提交入口消失；只补恢复事实，不重放模型、工具或通信。其余五个历史会话保持不变。                                                       |

最终看板为10个已结束任务：5完成、4取消、1中断，待开始、进行中和待处理均为0。最终正常CmdQ再次验证owner requested shutdown、所属PID消失及端口拒绝连接；测试控制器及临时凭据已清理，合成历史保留作本机证据。

### 日志、用量与时间

只读审计六个唯一会话，共16个Run、403条事件、332个批次，checksum、连续seq及codec引用还原均通过。按sessionId、runId及context.prepared序号去重得到36次请求准备记录，其中35次有供应商Usage：根95,180 tok、子树84,880 tok，合计180,060 tok（输入26,085、输出5,623、缓存读取148,352）。C的一次失败请求缺Usage，因此这是部分已报告用量，不是精确账单；不再累加包含后代的Task聚合量，五条SDK合成空终止消息也不当作模型请求。

A全树11次请求报告55,232 tok，根自身17,785 tok；根Run墙钟10.432秒，界面显示10.4秒。人工等待计入Run时长，不能当作供应商生成时间；逐请求context.prepared至message.completed只代表宿主观测耗时，不能提供纯网络延迟或首token时间。请求时间重叠可证实宿主并发，不能证明供应商内部调度。

D重启前后请求准备记录均为4，Run、既有消息正文和已报告Usage不变；序号35至43只增加八条工具/WorkState/Run/Task恢复收束事实。故障注入发生在ask_user和wait_agents等待期，未覆盖供应商流式输出期间的强杀。

### 真实异常与验收限制

B中的父提前结束符合[已确定的收束策略](execution.md)：父Pi循环结束后等待子树结算，保留未汇总结果，但不会自动收费重调父模型；收束后也不再接受新通信或续作。原人工问题仍能回答并结算。本轮没有修改该策略；B2证明父保持等待时正常通信及汇总可完成。希望保证每次子任务结束后都补父汇总，需要另行设计，不能据本次验收宣称已有保证。

C的SDK错误文本包含503，但没有结构化HTTP状态字段；公开错误为“模型服务暂时不可用，请稍后重试”。根请求失败后清理整树，单子停止没有扩散。A中模型还曾将实际对象字段描述成数组，子任务通过文件纠正，且一个子结果出现错误比较符号，主汇总仍正确；真实供应商输出质量不等于宿主执行正确性。

强杀后、重启前的SSE提示仍为“任务事件正在连接，后台执行不受影响”。它只能表示客户端断线，不能证明daemon存活；此处文案存在歧义，未作为存活证据。重启后显示明确服务中断及任务终态。模型请求耗时、人工等待及进程退出分别记录，不将等待时间或任务树聚合Usage重复算作模型延迟/费用。

上述补验没有修改产品源码、协议或存储格式。Windows实机、正式安装器/签名/公证、真实GitHub及其他服务账号、其他真实模型和完整产品体验仍为Not verified；权限/预算/写入仲裁的恶意交错沿用前述受控工程验证，不声称本次只读供应商场景覆盖了全部安全路径。开发收口不将这些未验项标为通过。

本机忽略证据目录为`output/m5-real-desktop-20261030/`：A-completed、B-human-completed、B2-completed-C-started、C2-one-stopped、C2-all-stopped、D-before-crash、D-after-restart及final-state的JSON快照；summary、final-journal-audit、D-recovery-audit、normal-restart-assertions、C2-stop-assertions、A-journal-audit、B-policy-audit、C-policy-audit和lifecycle/recovery-lifecycle记录断言与退出事实。15张实际窗口截图涵盖并行汇总、嵌套、看板、草稿、通信、失败、停止、刷新及中断恢复。截图和原始合成会话不提交。

## 开发收口与技术沉淀（2026-10-30）

用户确认M5开发完成并授权本地提交。当前[技术方案](../../09_TECHNICAL/子Agent与任务看板设计.md)已按runtime、launch/run-hooks、budget、Task查询/恢复和Web订阅源码核对，补齐职责及源码链接、委派至汇总的时序、Task/Run与上下文、角色/审批/写入、请求调度、通信及收束恢复。技术专题维护当前机制，Spec/tasks/roadmap维护完成状态与剩余验收，未新建重复方案或改变产品执行策略。

本次增量为文档及产品版本元数据，根版本和APP_VERSION同步至0.13.2；公开协议21、SQLite schema9保持，未清理数据或新增依赖。实际桌面包和真实模型证据仍为上述0.13.1，不将版本生成当作新包验证。M5开发及本机验收正式收口，Windows、正式发布及完整产品体验沿既有后续统一验收范围跟踪，M4账户和Office视觉缺口保持原归属，M6尚未开始。

本轮已执行各修改文档的定向Prettier格式化、`node scripts/check-docs.mjs`（206份文档）、`pnpm version:sync`、`pnpm version:check`和`git diff --check`，均通过。复用上述真实模型与桌面证据，不为文档收口再次调用模型或重建应用目录；当前本地验收产物、一次性控制器和任何凭据均不纳入提交。
