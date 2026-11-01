# M1–M5真实任务验收记录

2026-10-30在macOS arm64实际Electron窗口执行[Spec](spec.md)的八项主任务与横向检查，最后于21:17完成隔离应用及临时凭据清理。结论为部分通过：基础对话、受控文件修复、附件事实提取、插件读取及任务控制可用；复杂任务和办公交付仍需要人工审查。此次验收不表示M1–M5全部能力、M7或正式发布通过，M6仍仅规划。

## 环境与证据

基线提交524d59b，产品0.14.0、公开协议22、SQLite9。实际从源码重建未签名My Pi Harness.app；复制修复与工具结果读取修复后分别重新打包并复测。主模型为DeepSeek V4.1 Flash/deepseek-flash，推理off、text/image、默认上下文1M；每请求输出、任务数/深度/并发/轮数/时限限制保留，没有累计token上限。

主验收使用独立userData/profile、合成应用登录、专用Keychain namespace、动态回环端口和五个合成工作区。原模型配置/凭据只读选择，秘密未写入证据；T6真实GitHub使用原5174服务的有效授权及单独新会话，不复制插件凭据。办公室补测显式使用已有office-venv，没有现场安装依赖。压缩专项另建16K上下文/4K输出配置，仅指向同一真实模型及临时凭据，不改原默认模型。

证据根目录为仓库忽略路径`output/m1-m5-acceptance-20261030/`，以下相对路径均相对于该目录。`fixtures/`是模型任务材料及实际产物，`audit/`是模型不可见的oracle、独立计算、审查和原生Office副本。控制器位于`.cache/m1-m5-desktop-acceptance.mjs`，只做准备、只读观测、精确故障注入和清理；所有主任务输入、审批、问题回答、计划审核、下载及正常退出均通过实际界面完成。

原始证据和截图保留本机忽略目录，不将账户、原始对话或测试凭据提交仓库。主会话9个，另有原授权服务的GitHub验收会话979db490；最终完整快照为`final-all-settled.json`。

## 八项主任务

判定严格保留首轮与辅助重试；“核心结果可用”不代表所有报告、引用或指令都正确。Failed-model表示实际工具可执行，但模型遗漏或错误；Blocked-external不算原成功任务通过。

| 任务              | 首轮与后续结果                                                                                                                                                                                  | 最终判定与实际证据                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 基础多轮       | 流式表格/代码、多轮、历史编辑分支和日志下载完成；初次复制被Electron拒绝，修复重包后回答及代码均实际粘贴成功                                                                                     | 功能Pass（修复后）；整项Failed-model/字数口径保留。首答175汉字但277个非空白字符，不把未预先约定的仅汉字计数当作初答严格达标；追问明确要求90个汉字以内，实际62汉字通过。刷新回到新对话，侧栏可恢复分支历史；初次Failed-product保留。`audit/t1-review.json`、`audit/t1-download-check.json`、`t1-copy-failure.png`、`t1-copy-fixed-pasted.png`、`t1-code-copy-fixed-pasted.png` |
| T2 只读工程调查   | 找出BigInt折扣截断、真实原测试9过1败，原六文件hash不变；部分行号、错误类型及覆盖率说法不准确                                                                                                    | Failed-model（引用/报告偏差）；核心调查可用。命令尾随echo使外层退出0，不当作Shell非零验收。`audit/t2-review.json`                                                                                                                                                                                                                                                             |
| T3 修复与测试     | 原命令直接退出1；批准修复与新增9测试，原10项和新增9项全部通过；独立9订单/120舍入计算通过、总7613分                                                                                              | Failed-model（用例边界描述和行号错误）；实际代码修复与受控修改范围通过。拒绝写入仅尝试一次，标记不存在。`audit/t3-review.json`                                                                                                                                                                                                                                                |
| T4 附件与人工交互 | 实际上传CSV/PDF/PNG，问题草稿重开保留，同Run完成澄清与两次计划审核；最终5,900→8,400、+42.37%、三区3,150/2,750/2,500及图片代码正确                                                               | Failed-model。首轮选项金额错误后纠正；曾cd父仓库枚举目录，违反任务指令。原五材料hash不变；full-access没有OS沙箱，不能将模型违规说成沙箱突破。`audit/t4-review.json`                                                                                                                                                                                                           |
| T5 官方网页       | 原4次web_fetch均HTTP200，持久正文有目标，中段却被模型上下文裁剪，六项未答；补分页工具后以同主题提示重试                                                                                         | Pass（修复后辅助复测）。0新web_fetch，5检索/13分页，六项Python csv/json事实及链接全部正确；附带“只有两个hook可改变解码”的排他表述过强，不据此声称整答每句无误。原首轮Failed-product保留；不是相同初始提示的盲测。`audit/t5-review.json`、`t5-retested-facts.png`                                                                                                              |
| T6 GitHub/MCP     | 真实Skill加载、工具发现、get_me及只读网关取得账户/仓库/README/Issue；第五条提交被裁剪，人工要求补读page5后完整。受控stdio MCP发现3工具，echo/add正确，真实拒绝未派发，断连一次后unknown且无重试 | Failed-model（工具重载恢复、个别报告说法）；授权复用、远端读取和受控MCP操作断言通过。不能将受控MCP当OAuth验证，也未重新走真实应用登录。`audit/t6-github-review.json`、`audit/t6-mcp-runtime.json`、`t6-mcp-unknown.json`                                                                                                                                                      |
| T7 四格式办公交付 | 首轮默认Python缺DOCX/XLSX/PDF依赖；显式venv后四格式生成下载。PPTX纵向越界连续失败5次，坐标提示后才成功；v2四格式再生成、下载及打开                                                              | Failed-model，并保留首轮Blocked-external。初版Excel公式实际算错；v2当前数值正确，仍有通用最高区域公式错误、XLSX标题遗漏、Word约一页要求实际两页、无依据的日期过期提示。`audit/t7-initial-review.json`、`audit/t7-pptx-failure-review.json`、`audit/t7-downloads-review.json`、`audit/t7-v2-review.json`                                                                       |
| T8 综合委派       | 并行三城调查、嵌套审查、人工提问及写入分工均实际发生；首轮父/写角色16轮限制导致交付不全。显式续作后CSV/SVG/简报形成，北京/上海4项事实正确，深圳两项缺失                                         | Failed-model + Blocked-external；不完整成功。深圳4次历史工具仅报Web request failed；后来独立标准Node诊断复现TLS错误而curl成功，不能确认4次历史报错逐次皆为该原因；SVG实际图像仍有标题重叠，另有额外文件及状态误述。`audit/t8-first-run-review.json`、`audit/t8-continuation-review.json`、`audit/t8-network-tls-review.json`、`audit/t8-svg-offline-render.png`               |

八项均已执行；按全部必要断言、不事后放宽字数口径的严格判定，指定必要断言Pass为1/8（T5修复后辅助复测；附带表述偏差另列），其余7/8有模型偏差或未无歧义达标的要求，其中T7/T8同时有外部阻塞。T1仅汉字计数能通过，但总字符超出，不另造一个首轮成功率。这个小样本不估计产品总体可靠性；T1核心交互、T2调查和T3代码修复等实际可用结果，与整项严格判定分别报告。

## 耗时与已记录用量

下表来自唯一Run与消息去重，单位为秒/tok；墙钟包含工具和人工等待，不代表纯模型耗时，交错执行的时长也不能相加当实际总历时。具体ID、input/output/cache拆分和去重方法见`audit/final-outcome-review.json`。

| 任务                                    | 分段墙钟秒                     | 已记录totalTokens                                            |
| --------------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| T1 初答/原追问/历史编辑分支             | 三轮合计7.209                  | 13,792；不含后续队列专项                                     |
| T2                                      | 15.816                         | 39,471                                                       |
| T3 修复与Q1；拒绝专项                   | 76.894；16.464                 | 120,270；31,112。原修复Run内含队列Q1，不能等同单个回答footer |
| T4                                      | 151.378                        | 148,073                                                      |
| T5 首轮；辅助复测                       | 9.845；21.604                  | 21,425；282,697                                              |
| T6 GitHub首轮；第五提交补读             | 34.183；5.496                  | 96,729；48,463                                               |
| T6 受控MCP四Run                         | 47.919；2.424；14.566；40.504  | 22,985；13,825；22,897；16,278                               |
| T7 默认依赖首轮；venv继续；坐标提示；v2 | 50.624；71.379；15.271；56.856 | 451,052；870,136；229,103；821,731                           |
| T8 首轮；显式续作                       | 475.929；95.060                | 根228,058/树843,763；根331,573/树882,736                     |

八主任务210条有Usage回复合计4,976,538tok；队列、停止、压缩事实问答等横向专项另90,024tok/13回复，共5,066,562tok/223回复。两次压缩辅助模型调用没有完整合入该表，因此不是全费用或精确账单。totalTokens包含重复上下文及缓存读取，不是唯一文本大小；T8按唯一消息计树用量，不重复累加已经包含后代的Task.usage。

回答footer是该输入轮次的根会话用量；Task详情显示相应子树用量，两者含义不同。实测T8根/树差异不属于已经承诺的统一汇总错误。本轮没有测量“供应商最后token到浏览器最终绘制”的完整时延差，不能从Run墙钟推出渲染gap。

## 办公产物与综合报告审查

四格式初版及v2都从实际工具详情下载，位于`downloads/v1/`和`downloads/v2/`。文件字节、SHA256与工作区源文件及持久化产物元数据三方一致；修改前后版本分开保存，原CSV/PDF/PNG等五份输入未变。独立审查不替Agent改写任何交付文件。

Excel初版由Microsoft Excel重新计算审查副本，显示区域合并了两个月等公式错误。v2保留37条原公式，Excel重算37条均有缓存，三区3,150/2,750/2,500、合计8,400和差额0正确；但G15先命中North即返回，不能在其他区域更大时选最高，且统一标题未写入XLSX。原下载文件仍没有预计算缓存；仅另存的原生审查副本重算，不冒充产品已生成缓存。

Word两版均由Microsoft Word实际打开，内容、表格与原图可读，没有可见的字面Markdown星号；v2标题正确、实际两页，第二页主要是原图。更新字段前先确认XML唯一字段是页脚PAGE，实际第二页页脚2正确。约一页要求未达成。PDF v2独立渲染两页并逐页检查，符合原任务“两页左右”，不能误改为一页要求。PowerPoint两版三页均实际打开检查，v2表格/柱图无越界，标题正确，仍有无根据的“可能过期”注释。

原生证据在`audit/native-review-v1/`和`audit/native-review-v2/`，包括Excel计算副本及值表、Word两页、PPT三页截图；PDF页图为`audit/t7-v2-summary-page-1.png`与`page-2.png`。LibreOffice不存在，产品office_render没有完成；原生打开仅覆盖此次文件，不替代可复用导出渲染链路验收。

T8最终CSV有6个目标槽位，4个有来源事实、2个深圳字段留空，缺失未填0；GDP用亿元、人口用万人。续作后SVG为合法XML，72元素，源文件和简报都存在；但离线渲染PNG可见标题/副标题重叠，不能仅以XML有效判图表通过。浏览器file协议打开受策略拒绝后未换服务绕过；使用离线文件转换观察图像。源覆盖率4/6与结构完成分别记录。

## 横向检查与AC

| AC/专项                    | 结果             | 已执行的观察及证据                                                                                                                                                                                                                                                        |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 隔离、所有权、清理   | Pass（所选范围） | 独立profile/workspace/namespace；正常窗口退出，main37558/daemon37562和64856监听关闭；临时凭据删除且namespace为空、原模型元数据未变。原4311/5174监听仍在。`cleanup-2.json`、`audit/final-listeners.json`                                                                   |
| AC-02–09 主任务            | 部分通过         | 逐项见八任务表；不以文件存在、模型声称完成或工具成功取代答案/交付质量                                                                                                                                                                                                     |
| AC-10 Q2队列               | Pass             | 同一queue ID修订revision1→2、createdAt保留；停止后队列仍在且需明确继续，新Run消费同ID，仅输出QUEUE-EDITED-20261030。`audit/queue-q2-review.json`及before-edit/after-edit/stopped-paused/resumed快照                                                                       |
| AC-10 批准、拒绝、命令错误 | Pass             | T3原测试真实exit1后继续；拒绝文件写入不重试/不换工具，目录hash不变。T6拒绝MCP未到服务，断连派发一次后unknown无自动重试                                                                                                                                                    |
| AC-10 单停与整树           | Pass             | A/B实际都在ask_user等待；仅停A时B原Task/Run/问题仍等待，父仍运行；父Stop后全部收束，无活动后代。`audit/stop-tree-review.json`、`stop-child-a-only.png`                                                                                                                    |
| AC-10 实际进程终止         | Pass             | 唯一批准Shell启动Node24 PID2218，输出专用标记并等待60秒写合成文件；UI Stop后工具cancelled、PID消失、8文件hash不变、标记不存在。cancel到工具97ms/Run124ms，之后0新模型/工具/Run。`audit/process-stop-review.json`、`process-stop-ui.png`                                   |
| AC-11 压缩连续性           | Pass（事实保留） | 16K配置真实两次automatic compaction，摘要链及through正确；8/8虚构事实和已做/未做区分正确，0工具。第一次10224→10268略增，第二次10664→9179，不将摘要必定缩短作为已证结论。`audit/compaction-review.json`                                                                    |
| AC-11 刷新/退出/故障恢复   | Pass（所选场景） | 刷新后侧栏可恢复分支；正常退出重开保留历史。人工等待期核对owned实例后精确SIGKILL daemon，随后由真实daemon恢复，6会话/14Run身份与63个context.prepared保留，0新请求、无工具重放，等待工具显示interrupted。`audit/recovery-review.json`、`recovery-real-daemon-round-2.json` |
| AC-11 scope/秘密           | Pass（定向证据） | 子只读角色无Shell/写入，跨分支/task分页读取拒绝由回归证明；材料oracle未进入模型工作区。结果读取不返回privateData/binding/arguments，凭据不进入普通导出。未穷举所有profile攻击或full-access主Shell隔离，不据此作更强保证                                                   |
| AC-12 记录与判定           | Pass             | 首败、辅助重试、模型/产品/外部原因、具体产物和未验证项保留；阶段checkbox仅表示执行完成                                                                                                                                                                                    |

单停A的Run43ms/Task51ms、整树root停止到终态96ms等端点指标来自持久事件，不代表供应商全部网络取消的逐毫秒测量；具体定义由各audit文件记录。等待期中断已证明无重放，不代表在所有外部写入时刻故障都可确认结果。

## 本轮产品修复与回归

1. 复制：Electron权限check/request对可信自有主frame开放clipboard-sanitized-write；继续拒绝读、其他权限及非自有/非可信frame。13项安全测试及实际回答/代码复制粘贴通过，不提供绕过preload权限的后门。归[M1维护](../202610131100_feature_model-session/spec.md)。
2. 长工具结果：保留8192投影上限，检索返回位置、长度及工具ID，新增read_tool_result读取当前分支/task可见已结束结果，每页最多6000原文字符。原始web100K容量不变；不重复抓取、不携带私有字段。归[M3维护](../202610151655_feature_m3-context-interaction/spec.md)，M4网页/插件复用。
3. 参数转换：Pi prepareArguments先验证原始模型JSON，避免0.5被静默转为0；execute复用同一schema/大小验证覆盖直接入口，存储匹配不放宽。真实Pi反例证明非法参数不派发，下一轮仍能继续；无协议/schema/依赖版本变化。

最终只读代码审查未发现需保留的被替代旧实现或无效A/B改动。测试HTTP服务清理改为嵌套finally，确保fixture关闭报错仍回收监听；随后4项分页测试重新通过。源码之外未修改模型交付文件来获得通过。

## 实际工程检查

以下均已运行并通过；基于同一源码的检查不为收尾重复执行全仓套件。

- `pnpm package:desktop`：源码构建、桌面资源准备和macOS arm64应用目录包成功；修复后的日志`package-copy-fix.log`与`package-tool-read-fix.log`。不是正式安装器或签名验证。
- `pnpm exec vitest run apps/desktop/test/security.test.ts`：13项安全测试通过。
- `pnpm exec vitest run`指定11文件：`tool-runtime`、`tool-result-reading`、`task-work`、`work-runtime`、`task-toolset`、`run-toolset-pipeline`、`context-pipeline`、`context-review-regressions`、`external-tools`、`connection-runtime`及Web的`tool-presentation`，合计75项通过。
- `pnpm --filter @my-pi-harness/agent-runtime typecheck`通过；桌面定向typecheck及typed ESLint通过，实际打包也执行Web typecheck。
- 变更运行时/工具/上下文、对应测试及Web工具展示文件的typed ESLint、Prettier通过；`node scripts/check-source-conventions.mjs`检查937文件通过。
- 最后仅调整测试清理后，`pnpm exec vitest run packages/agent-runtime/test/tool-result-reading.test.ts`4项再次通过（21:16:57，2.41秒）；不重复计入独立测试总数。
- 最终变更文件Prettier通过；`node scripts/check-docs.mjs`检查214文件、`node scripts/check-source-conventions.mjs`检查937文件、`git diff --check`均通过；未运行全仓test/coverage、Windows或真实完整平台矩阵。

定向Vitest、typecheck及typed ESLint使用仓库已有Node24.20.0。实际GUI主任务独立于这些自动化测试，不以75项单测代替八项产品验收。

## 实用性与保留项

可以用于需要人工复核的日常对话、读取工程、受控修复、资料分析和已授权GitHub只读任务。提问、计划审核、审批、排队、任务等待、停止及恢复都有实测证据。复杂交付还不宜作为无需审查的自动执行：Office公式与格式检查、长任务轮数耗尽后的收尾、工具恢复和来源可达性需要继续治理。

任务树默认16轮在实际研究中形成了瓶颈：独立root原32轮，一旦有后代使用任务树限制；首次T8请求准备到17次时由AGENT_TURN_LIMIT阻断，未改大限制掩盖失败。后续可独立设计“预留收尾/更清晰限制与续作反馈”，本轮不未经设计改执行语义。模型报告中Task与Run状态混淆、只声称做过审查而无实际命令也需要证据约束。

Windows、正式安装器/签名/更新、真实应用登录、Google等其余服务、所有模型、完整导入导出、所有外部写入未知窗口、LibreOffice及产品自动渲染仍为Not verified或既有未实现项。M4原平台/账户缺口不因本轮GitHub只读和原生Office副本检查全部关闭；M6不在本轮实现范围。

## 本地提交范围（2026-11-01）

按用户要求将既有三项修复与本轮验收证据文档整理为0.14.1，同步根版本和APP_VERSION；公开协议22、SQLite9不变，不清理用户数据。未新增评测模块、未进入M6，不重新执行真实模型任务或生成0.14.1桌面包。既有75项运行时/展示测试与13项桌面安全测试、定向lint/typecheck、实际打包及界面证据复用；提交钩子按配置执行lint-staged、pnpm lint、pnpm typecheck、pnpm test，其实际结果以提交输出记录。不由版本号变更推断新的平台或安装验证。
