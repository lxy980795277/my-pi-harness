# M7 阶段验证记录

本记录按实际阶段追加，范围见[Spec](spec.md)。M7.1–M7.5功能实现、治理、本机工程检查及真实任务执行已收口。AC-14内容质量和AC-15平台发布条件未全部通过，整个M7完整验收及正式发布尚未完成。

## M7.1 执行追踪 · 2026-11-14

基线191192d后的工作树，产品0.21.0、公开协议30、SQLite17、Pi1.4、Node24.20.0，macOS arm64。临时profile、日志根、工作区与动态监听独立，模型为本机合成OpenAI兼容服务。未使用真实模型Key或修改用户数据。

| 检查           | 结果与证据                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 统一请求观察   | Pass，主子、审批、自动/人工压缩、输入消费、终态错误、取消结算及持久失败回归通过                                                    |
| 持久读取       | Pass，真实SQLite/JSONL覆盖版本化watermark、重启、直接定位、Unicode续读、单图、canonical工具正文及人工审批                          |
| HTTP           | Pass，2项真实监听检查，覆盖已提交快照、终态不污染旧分页、私有字段不返回、错误参数与登录/锚点拒绝                                   |
| 类型与静态     | Pass，protocol、storage、agent-runtime、daemon、Web类型检查，相关文件ESLint、Web Oxlint及源码约定门禁                              |
| Web行为        | Pass，7文件33项，涉及Query/导航、客户端清理、流更新、正文/图片和本机渲染计时                                                       |
| 生产Web构建    | Pass，实际Vite构建3563模块；保留既有大chunk提示，不把构建当作桌面安装验收                                                          |
| 桌面宽屏浏览器 | Pass，真实页面打开轨迹、选择请求、读取原始内容，状态筛选返回空结果并清除旧详情，关闭回到对话                                       |
| 正文与图片     | Pass，63000字符级用户输入经字符58386继续读取至REQUEST-END-MARKER；图片点击后同源读取，浏览器complete为true、naturalWidth/Height为1 |
| 窄屏           | Pass，390×844下详情可读、返回事件及关闭入口可达，子任务范围有窄屏选择器                                                            |
| 同端计时       | Pass，第二轮真实Pi/HTTP流触发seq21观测，可见列表提交37ms、下一帧标记38ms；仅为该次本机观察，不代表整体性能分位或屏幕呈现完成       |

浏览器截图保存在本地output/playwright/m7/trace-list.png和trace-mobile.png；CLI快照、合成授权状态与临时harness位于同一被Git忽略的目录，授权材料不纳入提交。真实供应商、目标平台安装与签名属于M7.5。

### 大日志实测

显式运行默认重型数据，10000次请求、100003条事实，目标正文268435456字节，实际JSONL296843768字节。生成约90.80秒；暖态50行摘要查询P95为9.002ms，最大摘要响应11200字节，末次请求详情1.798ms，低于规划查询200ms门槛。生成与查询期间堆增长119786760字节，该值包含fixture生成，不据此声称所有生产内存场景已通过。前端无限浏览的长期内存验证在M7.5继续执行。

### 实际检查命令

以下在仓库根目录使用缓存Node24 PATH执行，局部Vitest限制单worker。

```sh
pnpm exec vitest run packages/agent-runtime/test/request-observer-auxiliary.test.ts packages/agent-runtime/test/request-observer.test.ts packages/agent-runtime/test/approval-review-guard.test.ts packages/agent-runtime/test/memory-request-dispatch.test.ts packages/agent-runtime/test/agent-request-usage.test.ts packages/agent-runtime/test/memory-recall-inputs.test.ts packages/agent-runtime/test/context-pipeline.test.ts packages/agent-runtime/test/context-review-regressions.test.ts packages/agent-runtime/test/memory-delegated-dispatch.test.ts --maxWorkers=1
pnpm exec vitest run packages/agent-runtime/test/request-observer-auxiliary.test.ts packages/agent-runtime/test/approval-review-guard.test.ts packages/agent-runtime/test/request-observer.test.ts --maxWorkers=1
pnpm exec vitest run packages/storage/test/trace.test.ts packages/storage/test/journal-codec.test.ts packages/storage/test/context-work.test.ts packages/storage/test/tools.test.ts --maxWorkers=1
pnpm exec vitest run packages/storage/test/search.test.ts packages/storage/test/memory-writes.test.ts --maxWorkers=1
pnpm exec vitest run apps/daemon/test/trace-api.test.ts --maxWorkers=1
pnpm exec vitest run apps/web/test/render-diagnostics.test.ts apps/web/test/trace-state.test.ts apps/web/test/client-state-lifecycle.test.ts apps/web/test/live-session.test.ts apps/web/test/session-stream.test.ts apps/web/test/trace-service.test.ts
pnpm exec vitest run apps/web/test/trace-content-item.test.ts
MY_PI_HARNESS_TEST_TRACE_PERFORMANCE=1 pnpm exec vitest run packages/storage/test/trace-performance.test.ts --maxWorkers=1
pnpm --filter @my-pi-harness/protocol typecheck
pnpm --filter @my-pi-harness/storage typecheck
pnpm --filter @my-pi-harness/agent-runtime typecheck
pnpm --filter @my-pi-harness/daemon typecheck
pnpm --filter @my-pi-harness/web typecheck
pnpm --filter @my-pi-harness/web build
node scripts/check-source-conventions.mjs
```

上述runtime两组分别38项及最后受影响14项，storage两组58项和28项，Web两组31项和2项。相关ESLint按各拥有者改动文件执行，Web轨迹同时执行Oxlint；浏览器通过Playwright CLI操作本机临时应用并观察截图。

初次HTTP fixture误用了非.my-pi-harness的日志根而失败，改正测试配置后2项通过。接入中暴露的Drizzle原生client类型与动态schema联合推导已修复后通过类型检查；M6伪降级fixture补清理新增派生表后28项通过。未在产品迁移中加入忽略冲突的回退。

## M7.2 统一用量与估算 · 2026-11-14

产品0.21.0工作树、公开协议30、SQLite18、Pi1.4、Node24.20.0、macOS26.5.1 arm64。延续隔离资源，生产Web重建后重新启动临时服务，保证HTML入口及资源属于同一产物。

| 检查       | 结果与证据                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 请求与定价 | Pass，冻结目录/完整tiers，Pi结算含cacheWrite1h，自定义占位价与缺Usage保持未知，价格更新不重算历史                              |
| 回答归属   | Pass，同Run跨输入、旧child迟完成、新问题触发续作及通信来源均冻结；任务摘要与界面共用唯一请求集                                 |
| 计时       | Pass，Run活动区间并集、并发去重、人工/工具等待、单调模型与排队计时；回拨后工具/人工区间持续未知，模型单调时长仍准确            |
| 用量存储   | Pass，全storage32文件312项通过，重型性能测试1项按配置跳过；201服务省略计数与拒绝零外部执行有精确oracle                         |
| HTTP       | Pass，3项真实HTTP检查，含已报Token、未终态/未知费用、筛选和权限拒绝；daemon类型检查通过                                        |
| Web        | Pass，整包67文件407项，继承分支修复后2文件10项重新通过，类型、相关ESLint/Oxlint和源码门禁通过                                  |
| 浏览器用量 | Pass，真实Pi/合成HTTP上报prompt1200、cached200、completion48，footer与统计页均显示总1248，缓存没有重复计入；custom费用显示未知 |
| 继承分支   | Pass，发送第二轮后编辑第二轮创建分支，继承的第一轮与新回答都保留各自1248 Token，未按当前阅读分支误过滤                         |
| UI与资源   | Pass，观察统计页截图及返回操作；临时浏览器、服务、模型和profile已关闭清理，未使用实际Key                                       |

合成价格与数学oracle不能代替供应商真实账单。大基准M7.1证据保留，统计基准入口已补独立回答查询，完整候选重测留M7.5。本地截图为output/playwright/m7/usage-panel.png与usage-inherited-branch.png，不纳入Git。

### 实际检查命令

```sh
pnpm exec vitest run packages/agent-runtime/test/agent-request-usage.test.ts packages/agent-runtime/test/request-answer-ownership.test.ts packages/agent-runtime/test/request-pricing.test.ts packages/agent-runtime/test/request-observer.test.ts packages/agent-runtime/test/request-observer-auxiliary.test.ts packages/agent-runtime/test/approval-review-guard.test.ts packages/agent-runtime/test/agent-collaboration.test.ts packages/agent-runtime/test/model-gateway.test.ts packages/agent-runtime/test/memory-recall-inputs.test.ts --maxWorkers=1
pnpm exec vitest run packages/agent-runtime/test/request-observer.test.ts packages/agent-runtime/test/request-pricing.test.ts packages/agent-runtime/test/memory-request-dispatch.test.ts --maxWorkers=1
pnpm exec vitest run packages/storage/test --maxWorkers=1
pnpm exec vitest run apps/daemon/test/trace-api.test.ts --maxWorkers=1
pnpm exec vitest run apps/web/test
pnpm exec vitest run apps/web/test/answer-usage-scope.test.ts apps/web/test/answer-metadata.test.ts
pnpm --filter @my-pi-harness/protocol typecheck
pnpm --filter @my-pi-harness/storage typecheck
pnpm --filter @my-pi-harness/agent-runtime typecheck
pnpm --filter @my-pi-harness/daemon typecheck
pnpm --filter @my-pi-harness/web typecheck
pnpm --filter @my-pi-harness/web build
node scripts/check-source-conventions.mjs
node scripts/check-docs.mjs
```

runtime两组分别47项与20项，后者覆盖最后的队列计时和上游ID投影修复。静态检查另覆盖各拥有者的实际修改文件。联调发现的继承分支误过滤已删除无用branchId传递并补实际GET回归；未知和零值的旧断言按新请求事实口径调整。

## M7.3 本机阶段验证（2026-11-14）

原生write/edit已统一宿主用例，文件原语位于sandbox。SQLite为19，公开协议仍为本轮30。目标按canonical路径及父目录身份关联，root身份单独校验，嵌套工作区访问同一物理文件共享修改链。

- sandbox/tools/runtime主回归7文件76项通过，覆盖稳定原始字节、目录sync失败unknown、原生ledger屏障与审批；后续文档读取及Runtime协作3文件20项通过。
- storage整包33文件324项通过，另性能1项按开关跳过；新增故障及观察器测试后，file-changes.test.ts局部17项通过。覆盖全局修改链重建、GC、空文件/BOM/CRLF、幂等和提交失败。
- daemon真实文件测试11项通过，包含0600新文件、原权限保留、同文件多次正逆恢复、嵌套工作区共享链、跨Session过期hash拒绝、预检后外部变化、取消未开始项、发布后缺终态与批次进度故障恢复。
- daemon真实模型HTTP工具测试1项通过：Pi请求write_file后生成文件，再由受权API撤销/重做；未知字段、越界分页、越权读取拒绝。含Trace API的此前3文件13项回归通过，后补两个文件场景已在11项局部运行覆盖。
- Web首轮72文件422项中2项既有错误预期因保留ApiError.code需更新；更新后受影响6文件27项通过，另迟到accepted响应覆盖终态的2文件10项回归通过。Web typecheck、相关ESLint/Oxlint及生产build通过，构建3586模块，已有大chunk提示保留。
- 三个核心包及daemon类型检查、sandbox/tools lint、root新增后端ESLint、源码规范1328文件和diff检查通过。

Playwright CLI运行真实应用与隔离合成Provider：Header进入变更、读取差异、撤销创建后文件确实消失、重做恢复22字节原文；随后在临时工作区外部改写，撤销回执显示冲突，外部内容保留。查看操作历史能找回三条批次，390×844窄屏详情和Escape关闭正常。截图位于忽略目录output/playwright/m7/file-changes-conflict.png及file-changes-mobile.png。浏览器、模型服务、动态端口和临时profile均已关闭清理。

跨任意外部进程的严格CAS仍不作保证；未触碰真实用户工作区或凭据。本节通过后进入M7.4，完整归档和平台发布尚未验收。

## M7.4 本机阶段验证（2026-11-14）

公开协议30、SQLite20。完整归档使用tar-stream3.2.2和gzip，manifest与日志codec分开校验；daemon拥有有界传输及临时资源，storage拥有资源闭包、发布清单、导入回执及重启恢复。导入默认只读，继续前显式选择当前Provider/model/thinking/workspace，批准方式从请求批准开始。

| 检查           | 实际结果                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 存储闭包与发布 | Pass，最后5文件40项；包含活动提交前缀、全分支/任务资源、图片、长正文、文件前后像、冻结Skill和独立profile再导出                           |
| 持久故障       | Pass，plan fsync后及日志发布后SQL失败均能启动收口，seal唯一；取消只在发布前生效，同ID并发合并，跨域ID冲突和真实目标quota在发布前拒绝     |
| 恶意/损坏输入  | Pass，10项格式测试覆盖路径穿越、链接、重复/遗漏条目、坏hash、未知版本、尺寸与压缩限制、截断和取消；storage另核对codec/checksum与资源引用 |
| 真实HTTP       | Pass，独立应用/profile完成导出、上传预检、取消、确认、重启查回执、当前绑定及继续；4文件17项通过，旧Trace/file/import执行守卫3文件9项通过 |
| 生命周期       | Pass，实际慢Readable取消、4下载fd上限及关闭、清理失败由拥有者收口、持久成功后迟到异常不改写为失败；临时下载租约释放才回收旧文件          |
| Web            | Pass，整包76文件436项通过；推理能力绑定修正后3文件11项通过，类型/相关lint和生产构建通过                                                  |
| 工程检查       | Pass，protocol/storage/runtime/daemon/Web类型及相关ESLint；边界1308源码文件、后续源码约定1383文件与diff检查通过                          |

Playwright CLI直接操作两套真实应用：源会话由Pi/合成HTTP模型执行write_file生成22字节created.txt，并上传1×1 PNG；从header日志菜单实际下载13656字节归档，3个资源条目逐hash一致。归档未包含凭据/OAuth/env/SQLite文件，但自由正文仍按私有历史处理。目标profile在确认前Session数为0且模型请求数保持2；确认后能读原正文和图片、查看文件diff，Composer及撤销/重做均不可用。绑定目标当前模型、有效思考等级和工作区后仍没有新请求，发送新消息才产生第3次请求；目标工作区始终没有被旧write_file写入。

刷新后可在操作历史找到原导入ID；390×844下归档面板358px，面板自身不溢出，Escape关闭后可重开。既有工作台body最小宽680px，本轮不将局部面板验证表述成全站移动适配。实际截图、归档hash及脱敏观测在output/playwright/m7-archives/；所有临时CLI窗口、应用、动态端口和profile已清理。

导入不会迁移Provider Key、插件Token、登录会话或记忆库。目标缺依赖仍可阅读；旧Skill字节只是历史资料，既有批准、队列及文件记录不获得新主机执行资格。孤立的历史Skill版本保留，不在本轮新增自动删除机制。

实际新增检查包括archive-format.test.ts、session-archives-api.test.ts、archive-lifecycle.test.ts、import-execution-routes.test.ts，以及storage的archives.test.ts、archive-closure.test.ts、attachment-blobs.test.ts、committed-events.test.ts、file-changes.test.ts。受影响Trace/Usage/Artifacts/M6迁移此前10文件88项通过；完整候选工程与真实服务继续由M7.5核对。

## M7.5 工程门槛与真实任务 · 2026-11-14

候选为191192d后的未提交工作树，产品0.21.0、公开协议30、SQLite20、Pi1.4、Node24.20.0，macOS26.5.1 arm64。1045个生产源码/配置文件的有序SHA-256清单冻结于output/m7.5/candidate-source.json，总指纹e711e1e2b608c2b665bdb0a00e69f4b8682c5cee857440e440626235146f2498；这是本机工作树指纹，不冒充提交ID。用户明确授权使用当前桌面profile、账号和已配置服务；真实任务使用DeepSeek V4.1 Flash（deepseek-flash）、推理关闭及现有完全访问策略。已有会话、工作区、授权均保留，新增M7标签会话及output/m7.5/fixtures内合成材料；独立oracle放在工作区外的audit目录，未交给模型。

### 工程检查与首轮失败

| 检查       | 实际结果                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全仓类型   | Pass，根TS、E2E TS与11/11 workspace任务通过；末尾包装shell误用zsh只读变量，实际typecheck本身成功，未伪报为类型失败或重复执行                                                          |
| 全量Vitest | 初轮306文件、2685项：300文件/2677项通过，2文件/3项失败，4文件/5项按条件跳过；保留首轮结果，不宣称一次完整全绿                                                                         |
| 失败修正   | 两个Web工具旧断言补齐文件发布回调；真实typed ESLint子目录继承测试的冷编译18.2秒超过10秒，局部限时改30秒，保留实际规则断言。相关57/57通过；matcher改unknown后工具14/14再次通过         |
| 全仓lint   | Pass，完整ESLint/Oxlint、1307文件导入边界、1383文件源码约定、288文档与版本一致性检查通过                                                                                              |
| E2E        | 初轮103项中89通过、14失败；修正旧界面选择器、需按需加载的fixture、失效登录竞态及规范化错误fixture后，14项复跑12通过，最后2项再跑通过。103项均有通过覆盖，未将定向补跑写成一次全量通过 |
| 治理       | 移除无消费者的listAnswerFileChangeIds/answerChangeIds遗留链；请求事实、Usage聚合、文件发布与归档发布各保留单一拥有者。storage类型与diff检查通过，不为行数机械增加文件                 |

工程日志在本地output/m7.5/gate-\*.log。普通测试使用隔离资源及显式测试环境，不读取真实账号Key；以下真实任务和安装证据分别记录。

### 大数据与界面内存

候选重测10000请求、100004事实、299098383字节JSONL，正文目标268435456字节，生成98.44秒。暖态50行摘要P95为13.504ms，回答用量查询P95为0.485ms，最大摘要11200字节，末次详情3.519ms。堆差值为-16058160字节，受GC影响，不能证明稳定内存；采样末段主机开始浏览器回归，未当作独占主机性能结果。

独立浏览器数据集2000请求、291659020字节日志：连续30次分页及大正文续读、切换system/messages，再打开/选择/关闭10次。210次请求均200（80列表、130详情），最大列表15897字节、正文62212字节，挂载行数始终12。强制GC后JS堆9.71MiB→30轮11.39MiB→关闭10.03MiB→10次重开后10.17MiB，结束元素197、对话框0；仅证明该脚本和采样范围，未测总RSS峰值或长期泄漏。证据在output/playwright/m7-performance/。只让活动主Run/子任务及第一页轮询，SSE最终失效刷新；历史watermark页保持静态。

### 实际安装与发布条件

新增原生DMG/NSIS目标、显式unsigned/signed模式及安装smoke，按当前host/arch构建，不自动发布。真实macOS arm64 DMG经验证/挂载、复制至含中文和空格路径后启动完整应用；独立Node、SQLite、tsx和Skill资源可用，无外部SESSION_LOG_ROOT时使用安装profile下.my-pi-harness。再次用同一候选替换应用，原Session仍可读；显式旧日志根可继续读取，移除应用不清除历史，退出后所属daemon和端口关闭。

最终安装记录在output/m7.5/final-installer-darwin-arm64.json，最新unsigned DMG为413466907字节，SHA-256为37b36455b9d0baee91c25c2f8b248f76617132a1dcf5cb55ce5bbe0442fe87e3。源码、prepare部署及.app资源中的storage关键文件hash一致，最后删除的无消费者方法已进入候选。初轮安装记录保留在output/m7.5/installer-darwin-arm64.json。此处只证明同候选重装保留数据，未冒充跨版本升级；新schema不承诺旧版本降级。当前机器无有效签名身份，产物为unsigned，未执行Developer ID签名/Apple公证或Windows代码签名。Windows实机安装、真实跨版本升级和签名发布条件均为Not verified，完整平台及正式发布验收保持未通过。

### 真实任务与资源恢复

实际A1–A8结果、首轮问题与人工辅助分别见[真实任务记录](real-task-verification.md)。11个验收会话共267个唯一模型请求均已结算；按当前账号执行的任务不等于普通测试允许读取用户Key。A3原生文件下载复核的4份文件均与工作区原件逐hash相同，原三份材料不变；两条工作区测试记忆经用户确认后已删除，新会话检索无记录，也没有重新学习。

真实A6归档265687字节、355条原事实、32次模型请求、6个子任务及1次手动压缩；独立profile导入只追加封存事实，重启后可读，无新执行或网络调用。真实A3归档4988549字节，87条目包括journal、3份已持久附件表示、45blob、38个冻结Skill资源文件；86个非journal资源共695365字节。附件恢复PNG原图7121字节、CSV正文185字节及输入PDF的336字节提取文本；原输入PDF二进制未在M3落盘，不声称归档恢复原文件。导入及重启后重导出的资源全部逐hash/长度一致，4个实际Office产物字节一致，40个native文件操作只作local:false历史，不能Undo/Redo。两次目标记忆库均为空，历史采纳审计只作历史；临时目标已清理。原下载归档在本机Downloads保留，不纳入Git，完整资源证据在output/m7.5/a8/actual-a3-verification.json。

A3生成发布、数值和资源迁移功能通过，但模型仍在Word/PDF/PPTX中错误声称Beta增长快于Alpha，并有图表标签、表头对比度和Word拆页问题。人工仅对审计副本执行Excel重算及Word原生导出，不能将这些补验算作模型首轮交付完成。内容质量没有通过的事实阻止完整办公任务验收结论。

### AC与平台总表

| 条目       | 判定                   | 实际证据与限制                                                                                |
| ---------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| AC-01      | Pass                   | 主/子、审批和压缩身份及调度回归；真实267请求唯一且已结算                                      |
| AC-02      | Pass                   | 最终输入逐字段回归、持久锚点复用、分页正文及图片按需读取                                      |
| AC-03      | Pass                   | 失败、取消、迟到结算与中断故障回归；真实子任务停止不影响存活任务                              |
| AC-04      | Pass                   | 权限/分页/定位、万请求索引及2000请求浏览器有界读取；不宣称全站移动适配                        |
| AC-05      | Pass                   | 回答/子树/续作归属、分支共享与重启逐叶聚合回归                                                |
| AC-06      | Pass                   | Usage未知、冻结Pi价格、custom零占位与部分估算回归；不是供应商真实账单验证                     |
| AC-07      | Pass                   | 并发墙钟/累计量与等待回归；客户端提交及下一帧只表示本机测量                                   |
| AC-08      | Pass                   | 受管文件字节/mode及幂等回归；真实Undo和重启Redo                                               |
| AC-09      | Pass                   | 路径身份/锁/多文件部分结果回归，真实外部marker冲突拒绝覆盖                                    |
| AC-10      | Pass                   | 发布前后故障注入和只读恢复分类；不自动重放磁盘写入                                            |
| AC-11      | Pass                   | 合成全分支/嵌套闭包，真实6子任务及A3附件/产物/Skill资源独立恢复                               |
| AC-12      | Pass                   | 真实预检/冲突和恶意格式回归，损坏不污染目标                                                   |
| AC-13      | Pass                   | 发布故障及重新绑定整链；两份真实归档均零自动执行、记忆库不迁移                                |
| AC-14      | 未全部通过             | 八组均已执行，A3仍有模型内容/版面失败；辅助结果和未验项单列                                   |
| AC-15      | Not verified           | macOS实际安装/重装/退出通过；Windows实机、跨版本升级、真实发布身份签名/公证未验               |
| 当前账号   | Pass（已授权范围）     | 真实模型、搜索、GitHub已有授权读取及工作区记忆流程通过；未重新执行完整OAuth登录/撤销/过期刷新 |
| 原生Office | 辅助后                 | Word原生2页和Excel49缓存复核来自人工审计副本；PPTX的Keynote4页及直接PDF1页实际可视检查        |
| 候选安装   | Pass（macOS unsigned） | 独立安装路径、实际生产资源、同候选替换及数据保留；合成安装账号与真实开发账号证据分开          |
| 发布身份   | Not verified           | 当前无有效Developer ID、Apple公证或Windows签名身份；取得凭据后另行执行signed产物检查          |

M7功能实现、治理和本机工程检查已完成；A3内容质量与AC-15平台发布条件仍未齐备，整个M7完整验收和正式发布不得标为通过。本轮收到用户提交授权，按项目流程整理为[0.22.0本地提交](../../06_RELEASES/0.22.0.md)，不推送。前述0.21.0候选的测试、指纹和安装证据保留原版本，本次只同步提交版本元数据与文档，不重新生成桌面包。

## 本轮代码治理

2026-11-14按用户要求再次执行[代码治理](governance.md)，修复归档会话文件恢复、导入历史批量操作资格、冻结Trace的SSE刷新、首响应计时竞态和安装验收对构建凭据的误依赖，删除Usage无职责转发和重复临时目录创建，并校正设计文档。分组回归覆盖26文件143项，全仓类型、lint、格式及Web生产构建通过，首轮失败和最终检查分别保留在治理记录。

本轮没有重新打包安装器或重跑真实服务、浏览器和平台验收；前述源码指纹、浏览器样本及DMG证据继续只对应当时的治理前候选，不能直接作为本轮新生产修改的验证。AC-14与AC-15缺口不变。
