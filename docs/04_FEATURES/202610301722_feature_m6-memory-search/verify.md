# M6 分阶段验证

2026-11-12直接保存与自动学习调整的当前证据见本页末尾。下文2026-11-11的建议/确认流程是原方案验证历史，已由本次直接模式替换。

2026-11-11。M6.1–M6.6已完成开发与下列本机验证；其他平台和外部真实账户范围单列，不代表正式发布。产品版本0.19.1保持，公开协议26、SQLite15；未提交、未清理真实数据。

## M6.1 固定记忆与派发

Pass：人工保存/编辑/启停/遗忘、user/workspace隔离、幂等及CAS、来源hash、独立事实重启/投影重建；请求草稿等待后复核，变更先释放再重备，取消/真实流结算，主子scope，额度与UTF-16范围，采用由当时prompt还原。

| 实际命令/检查                                                                                                                                                         | 结果与范围                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run packages/agent-runtime/test packages/storage/test apps/daemon/test/memory-api.test.ts apps/web/test/memory --maxWorkers=2`                      | 80文件、569项通过；运行/存储及Web memory较广回归，60.84秒                                                                                                                                     |
| `pnpm exec vitest run packages/memory/test tests/unit/boundaries.test.js apps/daemon/test/search-text.test.ts apps/daemon/test/search-ranking.test.ts --maxWorkers=2` | 8项memory codec、104项边界通过；首轮search-text一项错误假设Intl分词必然保留“数据库”为单词，已修为不按全部单字扩展的行为断言；新search纯函数另2文件5项通过（属于M6.2早期检查，不据此完成M6.2） |
| runtime负责人聚焦memory请求2文件                                                                                                                                      | 9项通过，含真实Pi根/子请求、派发更新、取消、名额及超限                                                                                                                                        |
| runtime负责人存储codec/context/journal 3文件                                                                                                                          | 44项通过，含实际system消息与范围引用不一致拒绝                                                                                                                                                |
| 数据负责人memory/storage新用例                                                                                                                                        | 8+7项通过；真实临时SQLite与重启、容量与作用域                                                                                                                                                 |
| Web负责人6个聚焦文件                                                                                                                                                  | 74项通过；来源、receipt、scope、使用状态及Query                                                                                                                                               |
| `pnpm typecheck`                                                                                                                                                      | 全workspace及根/e2e/Web各编译面通过                                                                                                                                                           |
| `pnpm --filter @my-pi-harness/web build`                                                                                                                              | 类型与Vite构建通过                                                                                                                                                                            |
| `pnpm --filter @my-pi-harness/daemon test:deployment`                                                                                                                 | 3文件、7项通过；新memory及snapshot叶在隔离生产deploy目录真实加载                                                                                                                              |
| 各拥有者聚焦ESLint、Web a11y                                                                                                                                          | 通过；未以全仓lint结果替代                                                                                                                                                                    |
| `node scripts/check-source-conventions.mjs`、`node scripts/check-boundaries.mjs`                                                                                      | 分别1099文件及1029源文件通过；后续阶段继续更新                                                                                                                                                |

所有命令在仓库Node24.20.0 PATH运行。新增测试使用临时profile、独立身份与随机端口，模型HTTP为本机合成Provider，经真实Pi请求，不消费外部Key。

## 浏览器实走

通过Playwright CLI与最新Web产物，独立临时daemon/profile执行：

1. 设置→记忆→添加，输入正文并保存；编辑后修订从1变2，停用/启用变3/4。
2. 配置本机合成Provider，真实发送；上下文面板显示长期记忆103估算tokens、采用修订4、准确正文及“与当前记忆一致”。截图位于本地`output/playwright/m6-1-adoption.png`，已查看。
3. 遗忘确认后列表为空；再次打开原请求采用记录，保留旧正文并标记“当前已忘记”。
4. hover用户消息→保存到长期记忆，人工编辑正文后保存，真实消息hash校验成功，再发起下一输入。
5. 对合成Provider捕获的两份实际请求断言：首份固定正文恰一次；第二份没有已忘记正文，包含新确认的消息记忆。两次请求均正常结束。

首次验证时服务器持有旧index，另一构建替换了动态chunk，导致Settings加载404；暂停构建并重启临时服务器后完整重测通过，未为此更改产品逻辑。

## M6.2 持久检索与本地资源

Pass：持久正文/成员关系与固定来源hash、FTS中文短词/标识符、独立语义候选与RRF、先过滤scope、忘记即时失效、代际CAS与启动向量复用；模型显式准备、本地专用加载、共享优先级队列、活动取消等待settled、服务关闭等待查询。

- `pnpm exec vitest run apps/daemon/test/search-api.test.ts apps/daemon/test/search-service-lifecycle.test.ts apps/daemon/test/search-indexer.test.ts apps/daemon/test/search-text.test.ts apps/daemon/test/search-ranking.test.ts apps/daemon/test/local-embedder.test.ts packages/storage/test/search.test.ts apps/web/test/search-resources.test.ts --maxWorkers=2`：8文件47项通过。
- `pnpm typecheck`：根、e2e及所有workspace编译面通过。
- 各拥有者聚焦ESLint、Web a11y、源码规范及Web构建通过。真实临时SQLite证明重启零重复embedding、新增一项只补算一项、词法到语义代际一致；旧语义缓存有界保留，忘记跨代际清除。
- 固定Xenova/multilingual-e5-small修订761b726dd34fb83930e26aab4e9ac3899aa1fa78，CPU/q8、384维、实际512 token检查。显式下载135392016 bytes；关闭后新建Worker、全局fetch强制抛错仍能本地生成归一化向量。
- `MY_PI_HARNESS_TEST_EMBEDDING_CACHE="$PWD/.cache/m6/local-model" pnpm exec vitest run apps/daemon/test/search-quality-real.test.ts --maxWorkers=1`：真实模型70条固定标注、28来源/片段。Apple M3 Pro、12核、macOS arm64、Node24.20.0；本轮索引1163ms、70查询658ms。校准集融合Recall@5=0.8548、MRR=0.7375，持出集0.9355/0.7551；词法持出0.3871，语义持出0.9355；记忆持出0.9286、消息0.9412、零词法重合0.875；4项显式scope冲突零违规。初次持出0.8387未达标，定位为默认具体workspace混入用户通用偏好；修正默认scope后使用原封不动的夹具重跑得到上述结果。
- 8条无关查询仍有人工搜索语义候选；本节结果不代表自动采用可靠，M6.3另测相关记忆自动选择及误采用率，不用人工候选数代替。
- Playwright CLI真实临时daemon与Web产物：未准备状态→点击准备→准备中→就绪，重建后索引就绪；没有假进度或自动下载。截图`output/playwright/m6-2-resources.png`已查看。本机测试缓存及profile独立，未使用真实授权凭据。

## M6.3 相关召回与主子范围

功能检查已通过：14项memory领域；storage四文件37项及task/codec/context三文件29项（包含重叠，不合计）；Web六文件29项；runtime输入/预算/工具聚焦20项、工具单文件2项及相关旧回归21项（有重叠）；额外3项真实Pi/SQLite/单并发名额等待测试覆盖forget、disable-use、edit，目标请求重备两次、只交出一次且只落一次prepared。root daemon三文件5项通过管理模式/分页/statuses、真实词法相关采用、hash与取消、遗忘和重启。

全仓`pnpm typecheck`通过；各拥有者局部ESLint/a11y、源码规范1142文件、导入边界1072源文件及Web build通过。Playwright CLI真实临时daemon种入45项，实走第1→2页、固定筛选重置首页且仅2项、编辑一项为相关后固定筛选仅1项；截图`output/playwright/m6-3-memory-modes.png`已查看。

自动质量初轮未通过，曾暂停后续阶段：只用0.90线时持出正例0/14；校准导出的0.86+0.04分离度为校准10/14、持出1/14；再用校准正负分布确定0.82+0.04得到12/14和1/14，8条无关均未采用。停止继续按持出调线，保留原题目与标签。

另以官方固定Xenova/multilingual-e5-base修订1ec9243030a27d1a115d5c340572074c125b58b2进行scratch对照，未替换产品模型：295731426 bytes，CPU/q8、768维、实际512 token；加载含下载72.83秒，28来源索引0.71秒，70暖查询0.91秒、P95 19.07ms；融合Recall@5校准/持出均0.91935、scope零违规，冻结规则自动采用11/14及1/14，无关0/8。更大的双编码器未解决采用分离度，不能凭检索平均分宣称自动采用可靠。当前继续验证本地相关性复核，未额外请求付费模型。

正式实现已通过：保留原small embedding，不用更大的base替换。新增官方cross-encoder/mmarco-mMiniLMv2-L12-H384-v1固定修订1427fd652930e4ba29e8149678df786c240d8825，实际官方qint8图model_qint8_arm64.onnx；读取选项fp32仅用于无文件后缀，不代表图精度。原small Top20合法候选以完整query/passage pair核验，sigmoid(logit)>=0.5，删除旧E5绝对/分差/强词法自动采用规则。未核验项不自动采用，原固定项、人工搜索及search_memories仍可使用。

- scratch显式下载135704003 bytes，246对输入max65tokens，复核批P95 31.51ms；此探针实际Node25.2.1，仅作模型诊断，未冒充生产Node24验证。
- 正式单owner/单Worker/双独立view在Node24.20.0重跑上述真实quality命令：检索cal/held融合Recall@5保持0.8548/0.9355，自动正确采用10/14及8/14，8无关查询零采用、额外错误和scope违规零；达到分组50%覆盖与<=5%无关采用门槛。报告是小型固定语料基线，不是大规模准确率保证。
- 正式资源在Node24以global.fetch始终抛错的Worker，embed384维归一化及rerank均通过；超512的pair仅自身null，同批合法项成功；close后新owner离线重开成功，实际Worker均已退出。
- Node24资源/相关回归6文件35项通过；root daemon4文件14项通过，补充新的reranker HTTP不可接受任意模型/取消未开始准备/GET与搜索不下载后API单文件另通过（重叠不合计）；全仓typecheck、相关ESLint及Web build通过。Web新增双状态/取消与observer测试共35项在Node25通过，Node24完成构建与根类型检查。
- Playwright CLI真实临时daemon：两模型初始未准备；仅准备语义后语义就绪、复核仍未准备，45/45片段已索引；点击复核准备后两者独立就绪，截图`output/playwright/m6-3-dual-models.png`已查看。准备所用文件为前述公开固定cache，未读取真实profile或凭据。

## M6.4 建议、学习与画像

Pass：普通建议默认关闭；精确学习动作沿真实输入/排队消费生效；工具只能产生候选，人工改稿确认后才写入事实。来源、目标revision、工具真实调用、消费先后、一次动作与遗忘抑制均由宿主复核，不以full-access替代确认。

- 数据侧最终提案18项在默认Node25.2.1通过；此前storage29文件287项通过，后续来源账本/迟到意图修复分别运行focused三文件40项及35项（有重叠不相加，数据侧此前未切换Node24，最终交付另以Node24复验）。确认更新将事实来源改为新消息，遗忘以不含正文的来源指纹账本阻止旧A/新B来源复活；独立人工保存仍允许。旧assistant工具意图不能借用之后消费的steer或学习动作。
- Runtime最终学习三文件10项、相关上下文四文件26项、目录/召回七文件32项、storage队列/codec三文件81项、tools两文件4项通过（有重叠）。原始来源由宿主生成有界可见引用；幂等接受优先返回，消费和Provider交接前再次复核，不增加隐藏付费任务。
- Web相关11文件66项在Node24通过，三编译面、ESLint/a11y、Web build通过。最终全仓`pnpm typecheck`根、e2e及11个workspace通过。e2e辅助代码最初用了超出既有lib目标的findLastIndex，改为显式倒序查找后通过，没有扩大编译目标。
- `pnpm exec vitest run apps/daemon/test/memory-proposals-api.test.ts --maxWorkers=1`在M6.4阶段schema14及来源时序修复后通过。临时daemon、真实Pi与本机OpenAI SSE替身证明：未确认零事实，人工改稿后下一实际Provider请求正文恰一次，遗忘后下一请求不含正文，旧确认/输入重试不会复活或新增模型请求；归档清空pending正文。相关memory-api也通过。
- Playwright CLI真实Web产物与独立临时profile实走：普通建议保持关闭且full-access；从持久用户消息点击学习→真实tool_search/propose_memory→设置审阅→改稿确认→画像分类直接显示原事实→从另一精确消息发起学习并拒绝。全过程输入框草稿保留，浏览器控制台零错误/警告。截图`output/playwright/m6-4-review.png`、`m6-4-portrait.png`、`m6-4-rejected.png`已查看。

## M6.5 历史搜索、只读定位与引用

Pass：统一搜索覆盖workspace、时间、历史分支、归档及Task显式过滤；来源按ID/hash/精确成员定位，原始上下文只读有界读取。模型默认仅当前workspace其他可见Root；人类引用只授予精确选区，不扩大工作区权限。

- Node24数据侧5文件56项与后续交界2文件26项通过（重叠不合计），补Unicode文本分页后窗口8项通过；memory/protocol/storage类型及局部lint通过。这些正式Node24回归同时覆盖此前M6.4的数据验证。窗口测试包含2M目标、有界前后消息页、历史Task恢复、同文不同ID、错hash/target、surrogate边界和无snapshot/branch写。
- Runtime/tools最终引用三文件22项通过，包含真实Pi多loop只保留一份引用正文、输入接受/队列消费/交接复核、跨Run/Task隔离、quote优先、取消与变更。storage能力队列29项及tools三文件6项通过。含引用的输入不作为ordinary memory proposal来源；显式学习仍沿独立确认流程。SessionRuntime的引用解析抽至InputReferenceResolver，保留编排职责。
- Web相关11文件74项、通信定位负例2文件6项、来源标签7项通过（重叠不合计）；三编译面、ESLint/a11y、source conventions及Node24 Web build通过。最终全仓`pnpm typecheck`根/e2e/11workspace通过。
- daemon搜索/来源/生命周期三文件9项通过；补closed先于profile读取的生命周期7项通过。最终运行时交接后再跑source与proposal真实API两文件2项通过。跨workspace同文/同hash仍按不同ID区分，人工精确引用可用而模型默认搜索/精读拒绝跨范围；来源读取不改变snapshotSeq或活动Run。显式搜索到归档workspace记忆后可打开，修正了先前memory读取漏includeArchived的问题。
- Playwright CLI与独立临时profile、本机SSE模型替身：61轮、127片段，从第60轮尾部搜索第1轮过程中的UI_PROCESS_SOURCE_54并定位，自动展开过程、目标进入可视区，页面仍只有14个article，草稿不变。没有查找未挂载行或全量渲染。截图`output/playwright/m6-5-process-seek.png`已查看。
- 实页打开归档会话准确原文，引用命中片段到草稿后实际发送；引用ack清掉本次refs。另发慢速回答，在搜索窗口打开期间停止按钮仍存在，SSE正常完成并更新仍挂载的主对话，关闭窗口后新草稿保留。截图`m6-5-archived-reader.png`、`m6-5-live-draft.png`已查看，控制台零错误/警告。
- 最新metadata产物再起独立fixture，结果与Reader均显示workspace来源，Root角色标签去重；截图`m6-5-source-metadata.png`已查看。长正文翻页使用宿主textOffset切片，避免客户端猜测未知emoji边界。

## M6.6 综合验收与治理

以下验收均在Node24.20.0执行，不复用此前Node25的阶段证据。各组包含前述聚焦用例，不按重复次数累计测试总数。

- `pnpm exec vitest run packages/storage/test --maxWorkers=2`：30文件301项通过。`pnpm exec vitest run packages/memory/test --maxWorkers=2`：3文件17项通过。`pnpm exec vitest run tests/unit/boundaries.test.js --maxWorkers=2`：104项通过。最终精确候选去重另跑两文件20项通过；已确认提案保留最小receipt，人工改稿后同候选不重新产生卡片，forget来源抑制优先，新来源仍可提案。
- Runtime/tools相关完整回归72文件480项通过。Web完整回归63文件378项通过；accepted提案的收据fixture随后按收紧的业务联合补齐，最终类型与聚焦检查继续验证。
- `pnpm exec vitest run apps/daemon/test apps/desktop/test --exclude '**/provider-real.test.ts' --exclude '**/search-performance-real.test.ts' --exclude '**/search-quality-real.test.ts' --maxWorkers=2`：59文件461项通过，52.69秒；覆盖应用登录、MCP/插件、会话/SSE/队列、工作状态、记忆/搜索API和桌面宿主。普通源码配置继续单独排除bootstrap/deployment；真实外部Provider明确排除，未使用实际Key。
- 最终`pnpm typecheck`：根、e2e及11个workspace通过，17.402秒；包括accepted业务联合、Web收据fixture、无spy性能观察器及删除internal无消费者字段后的完整消费者。`pnpm lint`通过ESLint、a11y、1159源文件导入边界、1230文件源码约定、269文件文档和版本检查；后续小范围去冗余另以owned lint/type覆盖。
- 真实模型70条固定查询最终复跑同一quality命令通过：28来源/片段，Node24/M3Pro，索引1067ms、70次检索592ms；融合Recall@5校准0.8548、持出0.9355，MRR0.7375/0.7551，持出记忆0.9286、消息0.9412、零词法重合0.875。自动采用仍为10/14和8/14，8条无关零采用、额外错误采用及4项scope冲突均零。人工候选中的相似项不当作自动采用，样本规模不代表所有实际查询准确率。
- daemon生产部署3文件7项通过，覆盖源码CLI、恢复、随包memory/snapshot纯叶出口、真实transformers、同一模型owner的双视图local-only加载与退出。部署探针使用随包Node24+tsx和无后缀TS导入，不引用仓库外依赖，不触发模型下载。
- 新构建macOS arm64 unsigned应用0.19.1，Electron43.7.9、随包Node24.20.0，执行`pnpm smoke:desktop`通过。独立临时profile及随机daemon端口实走记忆创建、停用/启用、编辑/忘记，双模型独立unprepared状态，关键词检索、只读原文及引用待发且草稿保留；退出观察所属daemon PID消失和health连接拒绝。截图`output/playwright/desktop-memory.png`、`desktop-search.png`已查看。
- 桌面首轮将HOME也隔离时，原生Keychain返回缺少默认钥匙串；独立随机namespace探针定位为smoke环境问题。保留宿主HOME、仅查询临时profile派生的新namespace后通过，环境白名单仍移除模型/OAuth秘密，没有添加产品凭据降级。搜索等待改为真实lexicalReady、chunkCount与pendingSources，不用仅代表事实数量的sourceCount冒充索引完成。失败窗口和daemon均已finally回收。
- 治理删除无生产消费者的MemoryService.prepare和旧自动采用语义分数字段，排序候选不再保留已用完的向量数组；四个原生入口各自单文件，旧首次查询下载Worker入口已删除。同步架构、能力/记忆/搜索协议、技术专题、使用指南和测试规范，修正原运行时文档的旧32轮上限描述。
- 进一步删除SearchVectorPage.total和每512页重复的全量COUNT：唯一生产分页消费者只需要items/next。storage三文件31项验证真实完整翻页、前置scope、时间/exclude及原有archive/task/forget/失败负例；相关五文件lint/格式和protocol/storage类型通过。没有按未验证执行计划推测增加索引或改写可见性规则。
- 首次规模探针因Vitest spy保留所有分页向量结果而产生额外内存占用，被主动停止并作废，没有取得可用P95。观察器改为只累计标量和source ID、finally恢复真实方法；完整临时profile及所属进程已清理，保留本地invalid-observer日志，再用相同模型/语料/门槛重测。
- 修正观察器后的第一轮正式规模基线未达标：1400来源/10400真实向量，seed715ms、已有磁盘缓存冷Worker560ms、首次索引213896ms；30次词法P95=407.32ms，高于300ms。混合阶段尚未完成时于625.93秒主动停止，因此没有混合P95、重建或重开结果，不把取消记为通过。保留本地`search-performance-before-sql.log`，所属进程及临时目录已精确回收，进入同语料分段SQL诊断；不降低原门槛。
- SQL诊断使用同1400事实、10400个确定性384维向量，仅定位SQL/JS成本，不冒充真实模型验收。平均385.03ms的词法请求中，两次全status为332.47ms，scope水位41.50ms、FTS8.21ms、命中复核2.77ms。向量首/中/末页曾分别需要数秒并随剩余候选下降；执行计划出现游标不匹配的索引和临时ORDER排序。等价事实直连及(generation,id)索引组合把完整21页降至约948ms，30次诊断词法P95降到93.64ms。最终计划仍不能宣称f自动索引包含source_id，未按猜测记录。
- 实现queryReadiness与activeGeneration窄读取，完整状态仍由status提供；复用原水位/pending/FTS/错误/重建完整性逻辑。需要语义覆盖时用实际缺向量EXISTS，诊断完整/缺最后向量约1.88/1.47ms。COUNT的相同文本不能机械统一连接：同库实测直连后由约82–88ms恶化为1083–1099ms，故保持原统计SQL。schema15通过正常0015迁移添加游标索引，14→15真实重开保留消息、独立记忆和向量。
- 最终数据侧三文件33项通过，包含升级、完整分页与scope、缺FTS表/行、旧水位、building/error、缺向量和错误模型签名；owned lint/格式通过。daemon六文件24项通过，覆盖跨await换代/原文变更拒绝、稳态索引不重复UI统计/embedding、旧FTS修复和实际Pi/API；全仓类型11workspace通过，10.616秒。两个新增交错用例最初因fixture更新缺必要字段及重建签名不一致失败，纠正构造后再通过，没有放宽产品校验。
- schema15最终生产复验：Web两个receipt文件8项、daemon deployment三文件7项通过；显式合成ClientID重新准备资源和unsigned mac-arm64应用，完整`pnpm smoke:desktop`通过。随包源码实际包含0015及SCHEMA_VERSION15；没有重建未变化的Web/main/preload。桌面同名截图已覆盖前次证据并查看，临时窗口、daemon与profile均回收。最终源码规范1231文件、导入边界1160源文件及root query/indexer四文件ESLint通过。
- SQL修复后真实70条quality再复跑通过，4.63秒；原模型、样本、标签和门槛不变，融合cal/held Recall@5仍0.8548/0.9355，自动正确采用10/14及8/14，8条无关零采用，scope零违规。随后串行启动完整真实模型规模验收，不与本仓其他构建/测试并行，未关闭宿主用户其他应用或清空OS文件缓存。

### 最终真实规模结果

`MY_PI_HARNESS_TEST_SEARCH_PERFORMANCE_CACHE="$PWD/.cache/m6/local-model" pnpm exec vitest run apps/daemon/test/search-performance-real.test.ts --maxWorkers=1`通过，327.20秒。Apple M3 Pro、12核、macOS arm64、Node24.20.0，CPU/q8；1400个真实持久来源，包括1000条各4800 UTF-16字符的Root消息和400条相关记忆，共10400片段及10400个真实模型向量。测试不下载，使用已准备的磁盘文件，未清空OS文件缓存。

| 场景                 | 样本和实际工作                                | P95 / 耗时                   | 结果                                                 |
| -------------------- | --------------------------------------------- | ---------------------------- | ---------------------------------------------------- |
| 关键词查询           | 30查询，零向量扫描                            | P95 83.35ms，最大83.83ms     | 低于300ms门槛，准确来源Top5为30/30                   |
| 稳态暖混合           | 30查询，每次完整10400向量、21页，共312000向量 | P95 1135.74ms，最大1155.65ms | 低于1500ms门槛，准确来源Top5为30/30                  |
| 后台代际重建并发     | 30查询全部在building期间完成，共312000向量    | P95 1503.91ms，最大1580.08ms | Top5为30/30，零重试；约高于稳态门槛4ms，单列压力结果 |
| 已有磁盘缓存冷Worker | 实际新Worker、tokenizer及首次embedding        | 469ms                        | 本地加载成功                                         |
| 首次后台索引         | 实际推理10400片段                             | 206398ms                     | 全部追平                                             |
| 并发重建             | 复用既有真实向量、generation切到2             | 65996ms                      | 零passage重算                                        |
| 重开索引             | 新store/Worker复核1400来源，保留10400向量     | 11743ms                      | 零passage、零tokenCount重算                          |
| 重开后首个冷混合请求 | 实际重新加载模型并全量扫描                    | 1695ms                       | 准确来源命中                                         |

工作区正/负例共检查602个候选，零scope违规。所有暖混合返回truncated=true是语义Top100候选限额的保守标记；每次实际扫描全部10400向量，没有为达标减少语料或扫描量。后台重建复制现有向量，并非同时重算10400向量；索引推理、稳态检索与重建压力数据分别报告。

完整JSON和逐查询样本保存在本地`.cache/m6/search-performance-real.log`，质量最终日志为`search-quality-final-sql.log`；旧无效观察器和失败部分基线分别保留，不混入通过数据。两性能文件最终ESLint/Prettier/diff检查通过，正常finally执行真实close再删除临时profile，所有测量进程已退出，临时性能目录剩余零。

## 完成范围与后续

M6.1–M6.6开发与本机验收已完成，门槛及对应证据见本页各阶段。代码未提交、产品仍为0.19.1，公开协议26、SQLite15；本轮未清理真实数据库或会话。

Windows/Linux桌面、签名公证和安装器、真实外部供应商/账号未验证，它们保留原平台或发布阶段归属。M7继续拥有完整Trace/费用、文件撤销、完整导入导出及正式发布，Computer Use等专项不属于本轮。

## 对话直接保存与自动学习调整（2026-11-12）

本节替换原M6.4提案/确认方案，不删除其历史验证记录。产品仍为0.19.1，公开协议27、SQLite16；没有提交、读取实际凭据或清理真实数据库/会话。新迁移保留独立记忆及来源抑制，移除提案表并转换设置。

Pass：默认使用及学习都开启；明确保存/纠正直接写入，普通对话的稳定偏好通过正常learn工具保存。自动学习执行事务再次复核两个开关，当前开关随同一次快照进入实际system；零条目和关闭时同样明确呈现。删除继续遵守普通审批与完全访问策略。五个记忆工具默认提供，主子及scope限制保持，没有终态后额外提取模型请求。

删除pending候选、确认/拒绝接口、单消息学习Action/Grant/TTL、学习队列字段及专属动态卸载；移除原审阅UI与无效测试。真实toolCallId幂等、来源/工具意图先后、CAS、精确重复、遗忘抑制继续由原事实事务拥有。重复条目若已停用或mode不一致明确冲突，不假称已启用或已固定。

### 实际命令与结果

所有命令在本机Node24.20.0运行；下列完整与聚焦测试有重叠，不累计项数。

- `pnpm exec vitest run packages/agent-runtime/test packages/tools/test --maxWorkers=2`：70文件477项通过。补充当前policy后，memory-budget、memory-mutations、memory-context、memory-request-dispatch四文件25项再次通过；最终去掉无消费者的冻结requestId副本后，输入引用及mutation相关12项通过。
- 分别执行`pnpm exec vitest run --config packages/storage/vitest.config.ts --maxWorkers=2`与`pnpm exec vitest run --config packages/memory/vitest.config.ts --maxWorkers=2`：storage30文件295项、memory3文件24项通过。测试fixture整理后执行`pnpm exec vitest run --config packages/storage/vitest.config.ts packages/storage/test/memory-writes.test.ts --maxWorkers=2`，11项再次通过。覆盖15→16、14→16保留事实，设置执行复核、无工作区/跨范围/子任务、来源hash与消费先后、引用负例、重复冲突、A→B及多来源遗忘、Run结束/遗忘/重启后的幂等结果。
- `pnpm exec vitest run apps/daemon/test/memory-writes-api.test.ts apps/daemon/test/memory-api.test.ts apps/daemon/test/memory-retrieval.test.ts apps/daemon/test/search-sources-api.test.ts --maxWorkers=1`：4文件8项通过。使用临时SQLite/JSONL、实际Pi循环与本机合成SSE Provider；验证默认学习落库、新会话只含一份采用正文、学习关闭仍可明确保存/纠正、revision冲突、使用关闭阻断学习、ask删除审批及full-access直接删除、旧路由404及旧输入字段400。加入实际policy提示词断言后，直接写API单项再次通过。
- `pnpm exec vitest run apps/web/test --maxWorkers=2`：60文件376项通过。真实原生写工具成功才刷新当前事实，失败/MCP同名/重复/卸载迟到不制造保存成功，历史采用正文保持原快照；画像、编辑、搜索引用和虚拟定位回归保留。
- `pnpm --filter @my-pi-harness/web build`：三Web类型面及正式Web产物通过。`pnpm typecheck`：全仓11个workspace检查通过；最终policy与fixture调整后再次通过。
- `pnpm lint`：ESLint、a11y、导入边界、源码约定、269篇文档及版本检查通过。最终`pnpm format:check`、导入边界1139源文件、源码约定1210文件、269篇文档和`git diff --check`通过。
- `pnpm --filter @my-pi-harness/daemon test:deployment --maxWorkers=2`：3文件7项通过，验证隔离生产资源与源码运行依赖。

首轮真实Pi测试发现prepare中遗留了已删除的assertLearningSource调用，请求在Provider前失败；移除后整条直接写链通过，没有放宽断言或改变通用错误映射。独立审查进一步补齐停用/不同mode重复不返回假成功，以及模型可见当前学习开关。

### 浏览器与证据范围

Playwright CLI使用本次Web构建、独立临时profile及合成Provider，实际点击和发送：请求批准模式下明确记住→普通折叠工具行→已保存条目直接可见；两个开关默认开启，无待审阅面板；关闭学习后同一普通偏好没有新增条目，重新开启后直接学习并显示第二条。浏览器控制台0错误、0警告；临时浏览器、daemon、模型服务及profile已回收。已查看截图：`output/playwright/m6-direct-save.png`、`m6-direct-memory-settings.png`、`m6-direct-learned.png`。浏览器验证交互；最后policy可见文本由真实Pi/HTTP测试验证。

没有调用真实付费供应商验证模型是否主动选择学习；该选择仍由模型负责，工具成功才代表持久事实。本次未重跑未变化的真实检索质量/一万片段基准，复用前节证据；未重新打包或运行macOS桌面产物，原桌面证据不代替新版本桌面验收。Windows/Linux、签名与真实外部账号仍保持原未验状态。
