# 对话渲染与交互验证

日期：2026-10-19至2026-10-20。环境：macOS、仓库固定Node 24.20.0、pnpm 10.34.6、Playwright Chromium。按[Spec](spec.md)执行；自动化测试使用隔离临时目录、合成登录身份及受控模型，未调用真实供应商或读取用户凭据。开发实例的后续排查与重启单独记录如下。

## 结果

R1–R6基础体验已获用户认可，工具展示、回答统计、输入尺寸、行首loading与全宽header/JSONL下载均已实现并完成定向验证。R11/R13完成抖动复现与定位，R14/R15普通文档流及R16性能诊断作为阶段证据保留；按用户最新决定，R17/R18已恢复虚拟列表并完成13项定向浏览器回归。R20–R22完成整数px排版、公开用法核对及官方CJK强调解析；R23/R24完成输入框常驻统计与整答末尾操作，最新20个浏览器场景经首轮与定向补跑覆盖。采用Streamdown公开依赖与现有shadcn/Tailwind，保留原始消息事实；纳入0.6.0本地提交，未推送或对外发布，M4继续暂缓。

| 验收项               | 实际证据                                                                                                                             | 结果                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| AC-01 消息增量       | 230KB真实已登录SSE基线、正文/思考追加、准确终态、重连/分支基线；重复/缺口/错误所属与迟到HTTP回归                                     | 通过                               |
| AC-02 Markdown       | 标题、强调、列表、混合任务列表、引用、表格、代码、链接；实际未闭围栏、完成与刷新一致；不执行模型HTML、危险链接无导航、远程图片无请求 | 通过                               |
| AC-03 代码与复用     | 真实Shiki token、未闭/未知/超长降级；浏览器复制代码与整条Markdown原文；实际阻断高亮chunk后仍可读和复制                               | 通过                               |
| AC-04 UI与状态       | 896px阅读列、用户气泡/助手正文、工具详情与审批；50段回答上滑保持位置、回到最新恢复；编辑分支、停止/队列和M3交互回归                  | 通过                               |
| AC-05 工程与桌面桥   | 根lint/typecheck/build、桌面来源/参数/协议/回收测试；明暗主题与900px窗口截图观察，无页面横向溢出或CSP violation                      | 通过，平台限制见下文               |
| AC-06 等待与服务版本 | 默认主页拒绝不兼容协议并可重连恢复；首响应前等待、刷新恢复、正文接替、停止与实际请求取消；缺失基线超时和清理单测                     | 通过                               |
| AC-07 轻量工具行     | 14种工具的名称/摘要映射；真实写文件审批、hover同槽切换图标、点击与Enter展开/收起、参数/结果与实际Diff                                | 通过                               |
| AC-08 回答统计       | 供应商1248tok直达完成/刷新；工具两轮1100+230=1330tok；主对话事实重放、部分/缺失用量、队列输入分开、分支及工具期间终止计时            | 通过                               |
| AC-09 尺寸与视觉     | 浏览器实测896px输入宽度且整体高度低于145px；明暗工具详情/统计与900px窗口截图、原有滚动/审批/停止回归                                 | 通过                               |
| AC-10 行首loading    | 真实ask_user循环验证行首spinner、hover箭头、展开参数、完成后恢复图标；忙态文字仅供读屏使用                                           | 通过                               |
| AC-11 抖动诊断       | 三组浏览器逐帧几何及滚动采样，区分结构重排、测高/贴底延迟和完成时视口变化                                                            | 诊断完成，端点与视觉边界见AC-18–20 |
| AC-12 header与下载   | 全宽标题栏、旧控件移除；原日志字节、全部分支、运行中前缀、鉴权/失败重试、切换取消与真实桌面保存                                      | 通过                               |
| AC-13 普通逐行诊断   | 用户视频逐帧位置与无表格样例；实际新增行先推下尾栏、测高和贴底次帧复位，生成中无高度/滚动回退                                        | 诊断完成，端点与视觉边界见AC-18–20 |
| AC-14 普通列表       | 逐小块流、真实wheel、回最新、resize与16个消息DOM；旧产物失败、新产物≤1px；既有Markdown/工具/发送11项回归                             | 历史阶段通过，现由AC-16/17替代     |
| AC-15 性能诊断       | 相近历史、相同受控输出的两种布局首末文本、SSE、DOM与渲染后任务时序；逐层延迟和采样限制                                               | 诊断完成，真实环境待采样           |
| AC-16 虚拟DOM        | 24轮48条消息的DOM保持有界；顶部历史和最新回答往返可读，滚动总高超过10视口                                                            | 通过                               |
| AC-17 动态高度与交互 | 恢复后逐行波动≤1px、上滑不抢位、回最新/resize继续跟随；Markdown、高亮、工具展开/审批、停止/队列与编辑分支回归                        | 通过                               |
| AC-18 细微摆动诊断   | 第二段视频解码、337个生成帧及444个旧样本取整核对；录像像素、CSS几何与呈现阶段分别说明                                                | 诊断完成，真实视觉待确认           |
| AC-19 简化与整数排版 | 原虚拟测高/贴底恢复、整数计算样式、安全默认插件、松散列表与13项浏览器回归                                                            | 通过                               |
| AC-20 端点精度       | 41个settled端点gap32、范围0CSSpx，按≤0.1CSSpx检查；原始中间值与失败记录保留                                                          | 端点通过，不等于全帧无抖动         |
| AC-21 中文强调       | 截图原句在修改前复现失败；官方CJK插件后25项源码及流式/完成/刷新浏览器通过                                                            | 通过                               |
| AC-22 固定统计       | 未知与0%区别、继承分支计数、未消费队列不增次数；上下文详情、停止和M3交互                                                             | 通过                               |
| AC-23 统一回答操作   | 33项回答/时间线测试及真实两次工具、三段正文整答复制/刷新；同Run多输入隔离                                                            | 通过                               |

## 执行的检查

以下命令均从仓库根运行，并在进程PATH前加入`.cache/node/node-v24.20.0-darwin-arm64/bin`。

- `pnpm lint`：通过，包含ESLint、Oxlint a11y、导入/源码约定、文档与版本检查。
- `pnpm typecheck`：根工具/E2E与所有workspace编译面通过。
- `pnpm build`：protocol、daemon、Web及Electron main/preload等实际构建通过。
- 定向Vitest：14文件、96项通过，命令如下。

```sh
pnpm exec vitest run \
  apps/web/test/markdown.test.ts \
  apps/web/test/external-links.test.ts \
  apps/web/test/projection.test.ts \
  apps/web/test/session-stream.test.ts \
  apps/web/test/live-session.test.ts \
  apps/web/test/timeline-entries.test.ts \
  apps/web/test/composer-keyboard.test.ts \
  apps/web/test/tool-decision.test.ts \
  apps/web/test/approval-options.test.ts \
  apps/desktop/test/security.test.ts \
  apps/desktop/test/preload.test.ts \
  apps/daemon/test/session-stream-update.test.ts \
  apps/daemon/test/session-stream-api.test.ts \
  apps/daemon/test/session-stream-connection.test.ts
```

浏览器最终回归18项通过，使用构建后的daemon/Web和真实Pi，合成模型HTTP/SSE回复：

```sh
pnpm exec playwright test \
  tests/e2e/conversation-rendering.spec.ts \
  tests/e2e/m1.spec.ts \
  tests/e2e/m2-completion.spec.ts \
  tests/e2e/m3.spec.ts \
  tests/e2e/runtime.spec.ts
```

产物恢复专项2项通过，涵盖停止队列/被杀Run恢复、JSONL事实、冻结附件、任务及恢复分支：

```sh
pnpm --filter @my-pi-harness/daemon exec vitest run \
  --config vitest.built.config.ts test/recovery.built.test.ts
```

## 视觉与联调修复

实际检查浅色、深色、代码/表格与900×760窗口截图。用户原文气泡、助手标题/正文、代码高亮和操作、局部表格滚动均可辨认；普通/task混合列表保留各自marker。截图为受控测试内容，保留在本机忽略目录`output/playwright/conversation-{light,dark,code,narrow}.png`。

- 修复普通/task混合列表整组隐藏marker及Streamdown默认li padding与自有间距叠加。
- 代码高亮以语义CSS类展示，去掉默认表格内联对齐样式；正式CSP下未观察到违规。
- 230KB基线暴露原先将write背压当作立即失败的问题，改为排空后追赶最新投影；5秒未恢复、撤销、停服和异常立即取消订阅/计时器并销毁连接。慢连接生命周期有独立可控时钟回归。
- 模型HTML不会执行；危险URL不能导航，图片引用不会触发隐式下载。高亮加载失败只影响着色，不阻断代码显示和复制。
- 同步修正文档中旧JSONL公开镜像/SQLite反向补日志描述，按当前日志事实源与投影恢复实现说明。

## 发送后无反馈的回归修复

实际开发桌面实例的健康接口仍报告appVersion 0.4.0、protocolVersion 9，热更新页面已经使用协议10。只读检查运行状态、消息状态及正文长度，确认截图中的回答已完成并保存；新订阅不读取旧版事件名，导致页面停留在HTTP接受输入时的运行态。

- 已登录工作台挂载前校验健康响应，协议版本进入Query key；不兼容时提示重启服务并提供重连。
- SSE打开后限时等待有效基线，超时显示同步错误并重连；计时器随有效数据、断线和卸载清理。
- 首响应前和工具完成后的间隙显示临时等待行，由activeRunId派生，不写持久助手消息。生成、工具/审批及终态接替等待。
- 确认没有活动Run后，向本项目所属开发监督进程发送正常关闭信号并重新启动`pnpm dev:desktop`。健康接口已报告0.5.0/协议10；实际Electron窗口可见原问题的已保存回复及用户随后发起的新回复。本次没有代用户发送真实模型请求。

补充检查均通过：

```sh
pnpm exec vitest run apps/web/test/live-session.test.ts apps/web/test/timeline-entries.test.ts
pnpm --filter @my-pi-harness/web build
pnpm exec tsc -p tests/e2e/tsconfig.json --noEmit
pnpm lint:a11y
pnpm exec playwright test tests/e2e/conversation-rendering.spec.ts tests/e2e/runtime.spec.ts
```

Vitest为21项。浏览器10个独立场景中，首轮9项通过；停止场景原断言要求助手条目为0，但真实Pi会持久化并显示“已取消”消息，已改为校验该终态和上游连接关闭后单独复跑通过。延迟首响应场景为观察等待截图再次通过。修改文件的定向ESLint、源码/导入gate和文档检查通过。

## 工具行、回答统计与输入尺寸细化

工具默认无外框，以专属图标、中文名和单行目标摘要呈现，完成状态不附徽标。hover和键盘焦点在同一槽切换展开箭头；展开后显示轻量原文面板，待审批参数与决策持续可见。已有Diff在工具完成后展示。键盘焦点使用轻微背景，避免整行光圈形成强视觉容器；思考行采用相同的轻量折叠方式。

真实Pi供应商usage经过HTTP流解析后记录到消息完成事实；Web按用户输入分组，累计主对话模型步骤，包含无正文的工具轮。测试精确核对1248tok及两轮1330tok，缓存计数没有再次加进total。新记录同时保存完成时间，缺失与部分用量有明确标记。当前分支最后回答按终态Run时间包含工具/审批尾部，较早排队回答及继承分支分别结算；取消/失败后有部分正文也保留可用统计。原日志保持不变，重放不补造历史usage。

本次执行并通过：

- `pnpm build`、`pnpm lint`、`pnpm typecheck`；尾部耗时和焦点样式微调后再次运行Web构建、修改文件ESLint。
- 后端5文件70项：`packages/agent-runtime/test/{message-usage,model-gateway,tool-runtime}.test.ts`、`packages/storage/test/{session-jsonl,storage}.test.ts`。
- 前端最终6文件56项，命令如下；另有工具呈现/审批帮助函数13项及初次统计/时间线25项通过，属于有交集的检查，不合并宣称总数。

```sh
pnpm exec vitest run \
  apps/web/test/answer-metadata.test.ts \
  apps/web/test/timeline-entries.test.ts \
  apps/web/test/tool-presentation.test.ts \
  apps/web/test/projection.test.ts \
  apps/web/test/session-stream.test.ts \
  apps/web/test/live-session.test.ts
pnpm exec playwright test \
  tests/e2e/conversation-rendering.spec.ts \
  tests/e2e/m2.spec.ts \
  tests/e2e/runtime.spec.ts
```

浏览器覆盖13个独立场景。首轮12项通过，审批用例新增的“执行前就有Diff”断言与已有宿主行为不符，校准为审批时参数可见、执行后Diff可见后，该场景单独通过。尾部耗时与焦点样式修正后，Markdown统计/刷新及工具审批/深色两项再次通过。构建后的daemon恢复专项2项也再次通过，涵盖JSONL恢复、停止队列与检查点分支。

实际观察浅色折叠工具、展开详情、深色工具、统计栏、Markdown与窄窗口截图；输入框整体明显调矮且对齐加宽内容列。受控截图保存于本机忽略目录`output/playwright/refined-{tool-row-collapsed,tool-row-expanded,tool-row-dark,conversation-light,conversation-dark,conversation-narrow}.png`。本机健康接口已报告0.5.0/协议11；更新服务前确认没有活动Run，保留原工作区和会话。

## 流式高度抖动诊断

用户要求先复现并说明原因，本次未修改生产Markdown渲染、虚拟测高或滚动策略。受控模型将文本、标题、列表、表格和代码逐段发送，经真实Pi、daemon SSE和构建后的Web呈现；逐帧记录文章/Markdown实际高度、虚拟列表高度、scrollTop、视口及输入容器几何。

明确复现的回弹来自未完成Markdown结构重分类：长表头暂按可换行段落展示时文章增高150.75px，补上分隔行后转为表格，文章缩短41.78px；自动贴底随之先前进151px，再回退42px。真实DOM变化与虚拟列表总高/滚动校准通常相差一帧，约14–24ms。普通文字、列表追加在本样例中只表现为正常增高，不把所有贴底上移归为异常。

流式期间输入容器恒140px、滚动视口恒395px，article与Markdown根各保留同一DOM节点。完成时“运行中输入”行消失，视口增加40px、scrollTop回退40px，属于收尾独立的一次变化；该样例完成时文章/Markdown高度不变，没有观察到高亮或static切换额外改变高度。

仅在诊断浏览器阻止程序化scrollTo后，内容仍增减高但scrollTop保持0；统一段落/标题等文本样式后，表格重分类仍缩高25.75px。两组A/B支持结构重排与测高/贴底跟随的归因，不能据此声称停用滚动就是修复方案。

诊断命令`pnpm exec playwright test tests/e2e/stream-layout.diagnostic.spec.ts --workers=1`实际3项通过，27.8秒；临时源码已清理。关键帧表、原始逐帧JSON和截图保存在忽略目录`output/diagnostics/stream-layout-{summary.md,summary.json,baseline.json,no-programmatic-scroll.json,plain-text-style.json}`。

同轮工具loading已移至行首，末尾忙态文字仅供读屏使用；审批与异常提示保留。`tool-presentation`、`tool-decision`、`approval-options`三个Vitest文件13项通过；Web构建及其三个类型面、修改文件ESLint、E2E类型检查通过。M3“无工作区等待用户回答”真实工具循环用例1项通过，覆盖行首spinner、hover箭头、展开参数及完成后恢复图标。本次只有前端与文档改动，开发页面通过热更新生效。

## 用户视频与普通逐行生成诊断

用户补充视频后，按原时间戳解码321帧并匹配“生成中”尾栏文字位置，确认普通列表新增内容也有单帧下移再复位：例如1.050秒处视频坐标y=1185，1.067秒回到1169。视频像素与浏览器CSS像素分别记录，不假设二者缩放相同。

独立浏览器样例仅使用普通文字软换行、分段与列表，不含表格或高亮。真实Web/daemon/Pi/SSE使用隔离身份、临时profile和受控模型，每150ms追加文字，逐帧记录457组几何及scrollTo调用。普通换行时文章增高27.75px、尾栏向下27.75px，该帧虚拟总高与scrollTop仍是旧值；约16–17ms后总高及scrollTop增加27/28px，尾栏复位。列表新增项先增高32.55px，次帧增加滚动量32/33px，同样可见下挤/上移。共捕捉16次明确增行/增项，生成期间文章高度和scrollTop均未回退，视口保持395px。

这次逐行现象来自正文提交、虚拟测高和自动贴底不同步：Streamdown内部更新blocks可以晚于父级layout effect；绝对定位消息行已增高，`--list-height`仍取旧测量，ResizeObserver触发React更新后才同步总高并再次贴底。时间线实际`overflow-anchor:none`，排除浏览器默认锚定争抢。此解释与长表头转表格时真实高度缩小不同；结束时视口增加40px仍是独立变化。后续修复应验证测高、总高和贴底在同次绘制前完成，同时保留上滑阅读位置，本次未改生产渲染/滚动逻辑。

实际运行`pnpm exec playwright test tests/e2e/newline-jitter.diagnostic.spec.ts --workers=1`：1项通过，12.6秒；使用此前构建以隔离header变化，未重新构建或重启用户服务。临时测试源码已移出执行目录，可复用源码、逐帧数据、视频位置表、抽帧和报告保留在本机忽略目录`output/diagnostics/newline-video/`。

## 全宽标题栏与JSONL下载

会话header与主界面等宽，左侧标题截断、右侧“对话日志”按钮。移除顶部SessionSettings、历史分支选择、删除和确认区域，以及对应无用组件、Hook、类型和前端服务包装；输入框的模型设置、编辑新分支与检查点恢复保留。M1/M3用例通过公开API验证历史分支，M2通过归档API验证旧请求不会复活。

真实HTTP下载与磁盘原日志逐字节一致，包含全部分支、工具和私有恢复数据。storage以当前已提交游标固定字节范围，描述符校验拒绝越界ID、符号链接和外部篡改，后续追加不改变已开始的读取。401、403、非法参数、未知/归档会话和失败冻结有实际拒绝证据。配置/凭据假值哨兵未出现在文件中。

浏览器验证了实际保存文件、全宽header、旧控件移除、503重试、Blob URL释放、切换会话取消；运行中下载的文件仅含已提交前缀，回答完成后旧文件不变，再次下载才包含后续内容，两份文件有严格字节前缀关系。错误媒体类型会取消尚未读完的响应体，下载401沿用统一登录失效处理。

实际执行并通过：

- `pnpm exec vitest run packages/storage/test/session-jsonl.test.ts`：32项。
- `pnpm exec vitest run apps/daemon/test/session-log-api.test.ts`：1项真实HTTP集成。
- `pnpm exec vitest run apps/web/test/session-log.test.ts apps/web/test/application-login.test.ts apps/web/test/work-service.test.ts`：3文件26项；取消错误媒体类型响应后下载文件4项再次通过。
- storage/daemon类型检查、Web三个类型面及E2E类型检查、修改文件ESLint/Prettier通过。
- `pnpm exec turbo run build '--filter=@my-pi-harness/daemon...' '--filter=@my-pi-harness/web...'`通过；错误响应体清理调整后再次执行`pnpm --filter @my-pi-harness/web build`通过。
- 源码约定、导入检查与`pnpm lint:a11y`通过。

浏览器执行如下，覆盖7个独立场景。首轮6项中5项通过，M3用例在API切换分支后立即打开工作状态弹窗，SSE稍后同步导致旧WorkPanel卸载，断言超时。改为等待对应分支的实际UI任务数更新，再打开弹窗；未增加sleep或超时。修正后的M3与新增运行中下载两项单独执行通过。

```sh
pnpm exec playwright test \
  tests/e2e/session-log.spec.ts tests/e2e/m1.spec.ts tests/e2e/m2.spec.ts \
  tests/e2e/m3.spec.ts tests/e2e/conversation-rendering.spec.ts \
  --grep '会话标题栏|离开会话|配置兼容 API|响应丢失和跨页|计划反馈与批准|Markdown流式'
pnpm exec playwright test tests/e2e/session-log.spec.ts tests/e2e/m3.spec.ts \
  --grep '运行中下载固定|计划反馈与批准'
```

浅色header截图保留在`output/playwright/conversation-header.png`。确认开发profile没有活动Run后正常重启本项目`pnpm dev:desktop`，健康接口恢复0.5.0/协议11。实际Electron窗口已显示新header，通过系统保存窗口下载一份11,303,384字节、8565行完整批记录的已有会话日志，SHA-256与原文件一致；临时导出副本核对后清理，原日志保留，未发起真实模型调用。

## 普通文档流与逐行稳定性

按用户最新决定移除会话虚拟列表。当前分支的消息、工具和等待行全部在普通文档流中渲染，删除估算行高、虚拟总高、绝对定位、逐行测量ref与TimelineRow类型，并从Web依赖、catalog和锁文件移除react-virtual及独占virtual-core。稳定消息memo、Streamdown块复用与SSE增量合批保留；很长历史的DOM/内存开销增加，未宣称无限历史或完成分页。

滚动Hook只拥有真实滚动容器、内容容器和跟随意图。layout effect初次贴底并处理条目提交；同一ResizeObserver观察内容与视口，Markdown异步换行、工具展开和视口变化时直接读scrollHeight并写scrollTop，记录浏览器实际接受的位置，不再经React状态传递测量值。手动离底暂停，回到底部或点击“回到最新消息”恢复，卸载disconnect。自己的延迟scroll事件不会仅因正文再次增高而误判为用户离底。

新增永久浏览器用例`tests/e2e/conversation-scroll.spec.ts`，使用隔离profile、合成登录和loopback模型，经真实Pi/daemon/SSE逐次发送30个小片段与5个列表项。旧虚拟列表产物定向执行第一例按预期失败，尾栏底边波动8.9375px，证明断言能够捕捉旧问题。新文档流第一例最终通过，绘制阶段后的任务采样波动0.9375px，属于≤1px的取整范围；真实滚轮上滑后连续新增3项，32帧scrollTop均为702px。明确回最新和调整窗口后继续追加，各自尾部波动0.453125px。rAF发生在ResizeObserver之前，仍会读到中间布局，原始rAF与后续任务采样均保留，不把rAF读数误称为已绘制抖动。

第二例通过8轮真实受控回答验证16个article同时保留在DOM，顶部与尾部均能阅读。首次测试自有provider的8192预算触发压缩辅助请求，导致fixture按请求计数的回答编号偏移；将本例contextWindow明确设置为65536，聚焦完整DOM而保持压缩专项原有职责后，定向重跑通过。未改生产预算或放宽布局断言。

实际检查：

- `pnpm install --lockfile-only --ignore-scripts --offline`：锁文件更新成功，无下载。
- `pnpm --filter @my-pi-harness/web build`：三个类型面及Vite构建通过，既有主chunk体积提示仍保留。
- 修改文件ESLint、E2E类型检查、源码约定、导入检查与`pnpm lint:a11y`通过。
- `pnpm exec playwright test tests/e2e/conversation-scroll.spec.ts --workers=1`先验证旧产物失败，再验证新产物；修正fixture与记录phase后两例分别定向通过，最终耗时15.9秒、7.0秒。
- `pnpm exec playwright test tests/e2e/conversation-rendering.spec.ts tests/e2e/m1.spec.ts tests/e2e/m2.spec.ts --output=output/playwright/plain-timeline-existing`：11项通过，31.0秒。覆盖延迟首响应/停止、Markdown完成/刷新/复制/安全与高亮降级、长回答上滑、编辑分支、回车/输入法、队列/引导和两种策略下的真实工具审批/展开/差异/结果。

旧/新逐帧数据和对比说明保留在本机忽略目录`output/diagnostics/plain-timeline/`。本轮只改Renderer、测试、依赖和文档，开发页面由热更新生效，未重启daemon或发起真实模型请求。

## 首字至末字性能诊断

用户明确要求比较首字至末字的速度，并测量输出结束到页面完整呈现的延迟。本次只做诊断，没有修改生产渲染、滚动、合批策略或依赖，没有重启用户开发服务，也没有调用真实供应商。已有滚动稳定性回归不作为速度证据。

在忽略目录复制同一份Web源码，仅替换时间线Hook与JSX，分别构建当前普通文档流和此前虚拟列表。真实Pi、daemon、持久事实及SSE接收本地受控OpenAI流；隔离身份、内存假凭据、临时profile和回环服务与用户数据分离。历史为20轮、11,430字符、40个已完成工具，包含段落、列表和GFM表格；当前回答分别为2,336与20,064字符，64段、目标间隔50ms。记录实际发送时间，不把目标间隔或字符数换算为供应商token吞吐量。

Node和浏览器使用高精度epoch时间，CDP记录SSE接收，MutationObserver记录正文提交。正文首尾和每段共66个标记全部配对，最终DOM与预期正文的全部非空白字符/标点相等；Markdown块生成的空白差异另留原文核对。DOM更新后的rAF再投递MessageChannel任务，用于观察经过一次渲染步骤后的时间；该采样不是物理屏幕扫描或精确文字paint时间。模型终止帧、停止按钮消失和统计栏出现不计入正文首末跨度。

| 当前正文 | 布局           | 受控输出首末ms | DOM首末ms | 末段输出至完整DOM ms | 末段输出至渲染后任务ms |
| -------- | -------------- | -------------: | --------: | -------------------: | ---------------------: |
| 2.3K字符 | 原虚拟列表     |         3193.3 |    3171.2 |                 90.0 |                   97.3 |
| 2.3K字符 | 当前普通文档流 |         3169.8 |    3168.0 |                 91.2 |                  103.0 |
| 20K字符  | 原虚拟列表     |         3197.7 |    3204.7 |                 92.1 |                   99.2 |
| 20K字符  | 当前普通文档流 |         3205.3 |    3214.6 |                 92.4 |                  108.7 |

四组有效流式样本未观察到超过50ms的Long Task，最大rAF间隔约16.8ms。尾部拆分为受控输出至SSE约46–50ms、SSE至DOM约40–46ms、DOM至后续任务约7–16ms；前两段包含已有后端/前端各32ms合批及其余链路工作，不把端到端尾差全部归为Markdown计算。模型与页面并行，DOM跨度减去输出跨度等于尾部延迟减首部延迟，允许为负，不能作为串行渲染总成本。

这四个单次有效样本没有复现首字至末字明显变慢或随当前正文增长形成秒级积压；不足以证明用户体感不存在。2.3K与20K分两批采样，每个布局/大小仅一个有效样本，不作统计显著结论。生产Headless Chromium与Electron/Vite开发态不同，受控模型不包含真实供应商推理、网络波动、突发输出及用户其他主机负载；当前回答也未穷尽长表格、未闭合语法和代码等内容。

另有布局辅助样本：40/160/400条有正文消息，分别配20/80/200个工具。普通文档流DOM元素约1,630/5,875/14,365，虚拟列表约422；首次打开累计Layout约6.7/13.5/29.5ms，对照约5–6ms。大历史首次挂载和布局成本确实增加，但接近当前规模时流式Script/Layout没有更高，不能仅由DOM增长认定生成变慢。该辅助流经runtime.record直接提交事实，不经过Pi模型，不用于首末模型时间结论。

源码与局部函数审查确认，旧消息及工具有memo、Query保留相等引用，不是每段都重解析所有历史。当前回答的Streamdown仍对累计全文做未闭合语法修补和分块，稳定块只复用后续工作；长文本与特定语法仍有性能边界。局部函数合成结果保存在`output/diagnostics/timeline-performance-functions.json`，不将100K特殊截断样本的开销套用到用户约2K的回答。

实际执行了两份隔离前端目录的`node_modules/.bin/vite build`，均成功；`node output/diagnostics/timeline-perf-ab/run.mjs`保存9个有效辅助样本，最终因60秒测试登录到期返回exit 1，一组已污染记录明确排除，未称整条命令通过。核心脚本`run.mjs`与`seed.mjs`的`node --check`通过；使用固定Node24执行`node output/diagnostics/timeline-pi-performance/run.mjs`，每case重新签发测试登录。首次全文比较因HTML块换行差异拒绝，保留差异后仅规范化空白；随后两组2.3K有效。一次20K等待末标记超时未保存足以归因的现场，以`PERF_ONLY_LARGE=1 node output/diagnostics/timeline-pi-performance/run.mjs`仅补跑两组20K通过；该失败保留为未解释的诊断失败，不推断为fixture错误或20秒渲染延迟。

辅助及核心临时浏览器、服务和profile已关闭/删除，正式源码和用户进程未切换回虚拟化。可复用脚本、隔离构建、源哈希、正文核对及原始时间保存在本机忽略目录`output/diagnostics/timeline-perf-ab/`和`output/diagnostics/timeline-pi-performance/`；核心normal/large结果分别保留，合并报告说明口径与限制。

## 恢复会话虚拟列表

2026-10-20按用户最新决定恢复虚拟列表。沿用pi-harness的公开库路线，独立适配TanStack React Virtual 3.14.19及core 3.19.4：稳定业务ID作为key，overscan 5，按内容估高并在挂载后测量实际行高。容器注册containerRef、绝对定位行注册measureElement，开启directDomUpdates及anchorTo:end，由库直接更新数值height/transform。删除应用自己维护总高、CSS变量和行偏移的需求；JSX没有style，CSP保持原限制。

时间线Hook保留手动阅读意图。库处理行测高与锚定，Hook在条目提交和内容/视口ResizeObserver回调中，仅在跟随状态下以真实scrollHeight贴底，保存实际接受的scrollTop。原始消息、Markdown稳定块、轻量工具行、统计和SSE合批继续使用既有实现；虚拟化限制挂载DOM，不等同于只处理当前条目的服务器投影，也不承诺首末生成一定加快。

永久用例`tests/e2e/conversation-scroll.spec.ts`保留原逐行≤1px的断言，没有因恢复虚拟化放宽标准。30次小块追加和列表增项的444个渲染后任务样本，尾栏间距波动0.9375px；真实滚轮上滑后新增3项，30帧scrollTop均为702px。回到最新和窗口变化后继续追加，各自波动0.453125px。另将完整DOM用例改为24轮48条长消息，要求底部挂载article少于24且不随历史线性增长、滚动总高超过10视口；顶部第一条用户/助手内容与第24轮末段都实际进入视口，往返后仍保持有界DOM。

实际执行并通过：

```sh
pnpm install --offline --ignore-scripts
pnpm --filter @my-pi-harness/web build
pnpm exec playwright test tests/e2e/conversation-scroll.spec.ts \
  --workers=1 --output=output/playwright/restored-virtual
pnpm exec playwright test tests/e2e/conversation-rendering.spec.ts \
  tests/e2e/m1.spec.ts tests/e2e/m2.spec.ts \
  --output=output/playwright/restored-virtual-existing
```

依赖安装成功、无下载；Web三个编译面和Vite构建通过。浏览器分别2项通过（23.1秒）、11项通过（27.0秒），覆盖Markdown完成/刷新/复制/高亮降级、工具展开/审批/差异、等待/停止/队列、发送和编辑分支。修改文件ESLint、E2E类型检查、源码约定、导入检查和a11y通过；ESLint首次发现新增getScrollElement回调省略大括号，按仓库规范修正后通过。

实际查看本轮浅色Markdown、深色工具详情和900px窄窗口截图；正文、工具和输入列保持既有排版，无重叠消息行或页面横向溢出。原始几何与统计保存在`output/diagnostics/restored-virtual-timeline/`，截图在上述Playwright输出目录；此前plain-flow与性能对照证据没有覆盖。本轮未重启用户daemon，未调用真实供应商、清理用户会话或修改持久格式。

## 第二段录屏与细微像素摆动

2026-10-20用户提供`/Users/liuxinyu/Downloads/未命名2.mov`，再次反馈逐行生成时尾栏摆动。本次只诊断，未修改生产渲染、滚动、依赖或永久测试，未启动模型、读取用户会话日志或重启用户服务。

ffprobe/ffmpeg实际解码338帧，PTS为0至6.083333秒；容器另报352帧/6.883秒，逐帧分析使用真实解码与PTS。前337帧仍在生成，对“生成中”文字与非旋转复制图标逐帧模板匹配，尾栏文字模板顶边在录像坐标y=1318至1320之间；例如1.733333至1.766667秒向下2录像像素，2.016667至2.050000秒向上2录像像素。上下文模板y=1440恒定、输入框顶边patch y=1500恒定且匹配误差为0，说明这段视频有尾栏局部细微变位，没有把整帧裁剪移动或spinner旋转当作位移。未观察到旧视频约16像素的大脉冲，也没有凭此断言任意场景均无大幅抖动。未取得该录屏的实际DPR/缩放，录像像素不直接换算CSS像素。

诊断时Markdown默认根字号16px时，正文0.9375rem和line-height 1.85产生27.75CSSpx行高，列表间距及部分表格/标题也含小数几何。安装的virtual-core 3.19.4默认measureElement对ResizeObserver的borderBoxSize使用Math.round，无entry时读取整数offsetHeight；应用贴底另使用scrollHeight。这些测量与滚动值的精度不一致，新增一行时实际正文高度和被用于虚拟布局/贴底的整数高度增量可不同，尾栏跟在正文后面，便随舍入差值来回移动。

核对已有恢复虚拟化回归的444个following阶段后续任务样本，实际尾栏间距全部精确满足`32 + round(articleHeight + 24) - (articleHeight + 24)`，最大残差为0CSSpx。24为行底部padding，另有8px列表底部padding；实际高度952.75/980.5/1008.25时，尾部间距分别32.25/32.5/31.75CSSpx。整体范围31.5625至32.5，即0.9375CSSpx，支持小数几何与整数取整造成细微摆动的归因；它与新视频的现象量级一致，但不是对视频内DOM的直接测量。仅替换库的一个Math.round是否足够消除可见摆动尚未验证，不能忽略浏览器自身滚动/像素量化或承诺一个改动即可归零。

原回归允许≤1CSSpx变化，因此会放过该类问题；此前称为painted的数组实际只是rAF投递MessageChannel后再次读取几何，不是paint/compositor/presentation通知。同一批原始rAF还出现11次27至39px的中间失配，在约0.2ms中位的后续任务前恢复；这些数据既不能独立证明中间状态上屏，也不能证明屏幕从未闪动。新视频只有2录像像素的实拍证据，不能把旧中间值套到本次现象上。后续优化需同时核对实际像素、测高精度及贴底误差，而非仅以旧阈值通过宣布没有抖动。

关键帧、模板位置、解码时间戳和视频报告位于`output/diagnostics/newline-video-2/`；`rounding-correlation.json`保存444个旧受控样本的取整核对。生产代码与既有回归保持不变，本次未额外运行浏览器测试；文档和差异检查单独执行。

## Markdown整数像素排版与官方用法核对

2026-10-20按用户最新要求，撤回本轮自定义分数测高、几何贴底校准、额外行内包裹层和数值偏移变量，保留此前已恢复的TanStack Virtual、默认动态测量、有限overscan及scrollHeight贴底。未修改依赖源码或CSP，也未重启用户服务。

核对[Streamdown组件覆盖](https://streamdown.ai/docs/components)、[使用方式](https://streamdown.ai/docs/usage)、[安装配置](https://streamdown.ai/docs/getting-started)和[安全配置](https://streamdown.ai/docs/security)，并以安装的2.5.0公开接口为准。模块级COMPONENTS是官方支持的覆盖方式，链接、图片、代码和表格保留实际业务行为，纯排版继续交给CSS。生成使用streaming/isAnimating，完成使用static；未启用animated，无需动画样式。补齐Tailwind的Streamdown source扫描；此前部分通用类已由其他组件引入，缺失的是库内独占类，不能描述成所有默认样式都未生效。移除空rehypePlugins配置，改为仅排除raw并保留默认sanitize/harden，继续skipHtml、受限HTTP(S)与图片引用策略。

Markdown样式按阅读层级重新选取整数CSSpx，不将原rem/em值机械换算成小数px。正文16/28，H1–H4分别28/40、24/36、20/32、18/28，H5/H6为16/28，表格与代码14/24；段落、列表、表格和代码内外间距使用整数像素。根space-y-0明确由本地CSS管理块间距，first/last边缘归零；松散列表内p保持block，避免补source后库默认inline改变独立段落。此选择属于本产品排版，不是Streamdown要求禁用rem；整数CSSpx也不能保证任意缩放比例的物理像素都取整。

执行Markdown源码测试19项通过；Web三个TypeScript编译面及Vite构建通过；Markdown/滚动修改文件ESLint、E2E类型检查、源码约定、导入检查及a11y通过。既有Markdown/M1/M2浏览器11项通过，包含生成中的真实计算样式检查：标题、段落、列表、引用、表格及代码的字号、行高和垂直间距均为整数；松散列表段落为block。完成、刷新、原文复制、高亮降级、HTML/图片策略、审批和编辑分支回归通过，实际查看浅色与窄窗口深色截图，未见重叠或页面横向溢出。

逐行回归保留完整rAF与后续task几何，painted改名postTask，不将MessageChannel当成呈现通知。早期一次严格全task断言捕获列表新增时单条gap从32变为0、约14ms后恢复32：React提交发生在rAF与后续task之间，虚拟测高和贴底尚未完成；该记录没有实际像素帧，不能判定已上屏，也不能被整数排版结果排除。按本轮范围，精度断言改为每个受控增量等待渲染/测量后的端点，独立保留全部中间样本；没有新增位置补偿或靠放宽精度阈值掩盖该记录。

最终逐行与有界DOM两项回归通过（25.0秒），与上述11项合计13项。30个正文软换行、5个列表增量、4个表格增量及回最新/resize共41个测量结算后的跟随端点均为gap32，端点范围0CSSpx，通过≤0.1CSSpx精度断言；上滑阅读的33个完整后续task样本scrollTop恒定。最终原始后续task仍在列表阶段记录-8至32px的中间范围，rAF也有测量前中间状态；全量raw、分阶段统计和早期失败记录保留在output/diagnostics/integer-markdown-timeline/，未删除样本。受控端点与样式检查不等同于所有实际呈现帧无抖动，原视频场景仍需用户体验确认；桌面中键外链、依赖对嵌套未闭合围栏和复杂未完成链接的解析边界另记Spec，不扩大本轮为自有解析器开发。

本轮主要命令：

```sh
pnpm exec vitest run apps/web/test/markdown.test.ts
pnpm --filter @my-pi-harness/web build
pnpm exec playwright test tests/e2e/conversation-rendering.spec.ts \
  tests/e2e/m1.spec.ts tests/e2e/m2.spec.ts \
  --output=output/playwright/integer-markdown-existing
pnpm exec playwright test tests/e2e/conversation-scroll.spec.ts \
  --workers=1 --output=output/playwright/integer-markdown-settled-final
```

## 中文引号相邻的强调解析

2026-10-20用户反馈“你说的\*\*“test”确实出现过两次\*\*”仍展示星号。使用截图原句添加静态/流式两条回归，修改前两条均失败、其余19条通过，确认是默认CommonMark/GFM强调分隔符遇到中文与引号的边界规则，不是strong组件或CSS漏样式。[官方CJK文档](https://streamdown.ai/docs/plugins/cjk)描述了同类限制及推荐接入。

catalog固定@streamdown/cjk 1.0.4，通过模块级稳定plugins配置交给Streamdown协调CJK/GFM的顺序；保留现有components、默认remark行为及安全限制，补对应Tailwind source。未增加文本替换或正则预处理，不改写历史原文。单测覆盖截图原句、中文标点相邻强调、裸URL中文边界，以及行内/围栏代码和转义星号的字面内容，流式和静态共25项通过。Web三个TypeScript面与Vite构建、修改文件ESLint、E2E类型及导入检查通过。

定向浏览器用例在真实隔离Pi/daemon/SSE链路中检查同一句的strong节点，在生成中、完成和刷新恢复后均通过，并保留复制、安全与整数排版断言；1项通过（6.9秒）。运行命令：

```sh
pnpm exec vitest run apps/web/test/markdown.test.ts
pnpm --filter @my-pi-harness/web build
pnpm exec playwright test tests/e2e/conversation-rendering.spec.ts \
  --grep 'Markdown流式、完成与刷新一致' \
  --output=output/playwright/cjk-emphasis
```

本次使用合成回复与临时profile，未调用真实供应商或重启用户服务。此前虚拟列表的中间几何及真实录屏视觉边界保持原记录，不将CJK解析修正当作滚动修复。

## 输入框常驻统计与统一回答操作

2026-10-20将上下文占比移到输入框下方的常驻信息栏，仅显示“上下文占比 | 总对话次数”。新会话与上下文未记录时显示“上下文 —”，真实0%仍显示0%。次数统计当前分支已进入对话的user消息，包含继承历史，排除助手/工具步骤及未消费队列；点击上下文文字保留工作Dialog入口。移除旧上方上下文/Plan/Todo摘要及运行中输入策略选择，运行中发送默认follow-up排队；停止、队列编辑恢复、人工提问和计划审核保留。不确定提交重试沿用原请求，不重写已接受请求的mode。

截图中的中间复制按钮源于逐条MessageCard复制本模型步骤，而统计已经按用户输入聚合。现由buildAnswerFooters在同一次分组中派生完整正文和统计：遇到真正user消息切分回答，不按runId合并；非空助手正文依序以两个换行连接，保留Markdown，不混入thinking、工具结果或其他输入。操作栏锚定最后一条助手消息，包括隐藏空final，在该消息的全部工具之后插入独立虚拟条目，key为answer:inputId。生成/工具等待期间不提前出现最终操作栏；取消/失败/中断的部分正文也可统一复制。用户消息与代码块保留各自复制。

两份回答/时间线源码测试33项通过，保留用量、时间、历史分支、等待及终态覆盖，并增加整答复制、同Run多输入隔离、空final锚点和工具后无final的位置；工作状态/上下文版本/请求恢复三份源码测试10项通过，包含未知与0%区别及继承消息计数。Web三个TypeScript编译面与Vite构建、修改文件ESLint、E2E类型、源码约定、导入及a11y检查通过。

Markdown/工具与M2浏览器9项通过（23.1秒）。新增真实Pi/daemon/SSE链路用例产生工具前、中间、最终三段正文及两次history search，工具前正文没有复制按钮、整答操作栏仅一个且位于工具之后，剪贴板精确等于三段原文，刷新后保持相同结果；工具结果未混入复制。另核验空会话0次、运行中底部位于输入框之后且只有两项、原策略选择器不存在，以及明暗主题/窄窗口、Markdown、安全、审批和编辑分支。实际查看统一回答与窄窗口深色截图，信息栏与正文没有重叠。

M1/M3与滚动回归首轮10项通过，1项M3计划测试失败：通过API切分支后马上打开Dialog，旧的摘要数量同步条件被移除，分支组件随后重挂载使Dialog关闭。测试改为reload并重新打开测试自有会话后再检查持久分支计划，保持原timeout且没有sleep；仅修正该测试并补跑通过（7.9秒）。其余10项结果复用，合计11个场景；连同上述9项，本轮覆盖20个浏览器场景。计数序列实测为首发1、排队仍1、消费后2、新输入3、API引导输入4，并与实际user消息数量交叉核对；停止/恢复、同Run引导、附件、提问/计划/快照、上下文版本与虚拟列表阅读均已验证。首轮失败trace和补跑证据分别保存在footer-and-answer-regressions及footer-and-answer-plan-sync，未删除失败证据或把补跑称为首轮全绿。

主要命令：

```sh
pnpm exec vitest run apps/web/test/answer-metadata.test.ts apps/web/test/timeline-entries.test.ts
pnpm exec vitest run apps/web/test/context-versions.test.ts apps/web/test/context-work.test.ts apps/web/test/input-recovery.test.ts
pnpm --filter @my-pi-harness/web build
pnpm exec playwright test tests/e2e/conversation-rendering.spec.ts tests/e2e/m2.spec.ts \
  --output=output/playwright/conversation-footer-and-answer
pnpm exec playwright test tests/e2e/m1.spec.ts tests/e2e/m3.spec.ts tests/e2e/conversation-scroll.spec.ts \
  --workers=1 --output=output/playwright/footer-and-answer-regressions
pnpm exec playwright test tests/e2e/m3.spec.ts \
  --grep '计划反馈与批准保持同一次运行' --workers=1 \
  --output=output/playwright/footer-and-answer-plan-sync
```

本轮使用测试自有临时profile、身份和受控模型，未修改持久事件格式、调用真实供应商或重启用户服务；数据与既有虚拟列表继续使用原职责。

## 提交前复核

2026-10-20按提交规范并行审查Web/desktop、daemon/runtime/storage及文档/测试范围。变更仅包含本轮源码、配置、测试、文档与M4暂缓规划，没有纳入根.env、真实会话、JSONL/数据库、工作区文件、视频、诊断输出或构建产物。版本同步为0.6.0，通信协议为11，版本一致性及文档检查通过。

定向补跑既有登录HTTP回归时，`immediately closes private SSE on logout and retains another client login`真实失败，客户端收到`TypeError: terminated`。原因是新的SSE连接在正常注销时也直接销毁响应，未完成合法HTTP结束。修复将资源清理与传输结束区分：正常可写连接先清除订阅、授权观察和计时器，再end；背压、超时、异常及end失败仍destroy，避免慢连接延迟清理。初始化时已销毁的响应立即清理，已结束响应不加入live集合。原登录测试与EOF断言保持不变，没有吞掉连接异常。

新增生命周期测试覆盖正常结束、背压强制关闭、安装授权观察时同步撤销、已销毁响应初始化及end失败清理。以下检查实际通过：

```sh
pnpm exec vitest run apps/daemon/test/login-api.test.ts \
  apps/daemon/test/session-stream-connection.test.ts \
  apps/daemon/test/session-stream-update.test.ts \
  apps/daemon/test/session-stream-api.test.ts
pnpm exec turbo run build '--filter=@my-pi-harness/daemon...'
pnpm --filter @my-pi-harness/daemon exec vitest run \
  --config vitest.built.config.ts test/recovery.built.test.ts
```

源码4文件23项通过，daemon及依赖5个构建任务成功，构建后恢复1文件2项通过；修改的daemon文件ESLint与Prettier通过。没有启动或重启用户服务，没有新增真实供应商或平台验收。提交钩子另执行暂存格式、全仓lint、类型检查及源码测试，结果以实际提交输出为准。

## 提问操作悬停显示

2026-10-20将用户消息的复制和编辑操作默认设为透明且不接收鼠标点击，操作行与两个按钮继续挂载并保留原位置和28px最小行高。消息悬停或内部有键盘焦点时即时显示，不增加透明度过渡；助手状态及回答末尾操作保持原规则。保留用户已修改的消息纵向间距。键盘显示由focus-within保留，没有使用aria-hidden、visibility:hidden或移除Tab顺序。

复用并调整M1和日志下载用例，编辑前先悬停用户消息，均完成编辑与新分支回复。两个浏览器场景分别通过（6.9秒、7.4秒），没有新增样式镜像单测。实际查看M1截图，非悬停提问下的两个图标不可见，助手末尾操作仍展示。截图位于`output/playwright/question-action-hover/`，日志用例证据位于`output/playwright/question-action-hover-log/`。本次没有单独运行键盘或触屏端到端场景，焦点规则经代码审查。

实际执行Web三个类型面与生产构建、修改文件ESLint/Prettier、E2E类型、文档与diff检查，均通过；Vite原有大chunk警告保留。浏览器命令如下，均使用临时profile和受控模型，未重启用户服务：

```sh
pnpm exec playwright test tests/e2e/m1.spec.ts tests/e2e/session-log.spec.ts \
  --grep '配置兼容 API|header' --workers=1 \
  --output=output/playwright/question-action-hover
pnpm exec playwright test tests/e2e/session-log.spec.ts \
  --grep '会话标题栏全宽展示' --workers=1 \
  --output=output/playwright/question-action-hover-log
```

第一条命令实际只匹配M1的一个场景；第二条补跑日志场景，合计两个。本次增量纳入0.6.1本地提交，未推送或对外发布。

## 输入框再次收窄高度

2026-10-20仅调整共享ComposerSurface，将正文最小高度从64px降至48px并设rows=1，新对话和已有对话使用同一设置，整体约减少16px。基础Textarea、工具栏和字符限制未修改。原组件没有自动增高机制，多行内容继续在输入区内滚动。

Web三个类型面与生产构建、修改组件ESLint/Prettier、文档及diff检查通过。复用既有键盘浏览器场景，`pnpm exec playwright test tests/e2e/m1.spec.ts --grep '新对话与已有对话回车发送' --workers=1 --output=output/playwright/compact-composer-height`实际1项通过（6.2秒），覆盖两个入口的回车发送、Shift+Enter和输入法确认。使用临时profile与受控模型，没有重启用户服务；原有大chunk警告保留，增量纳入0.6.1本地提交，未推送或对外发布。

## 仅缩小对话Markdown字号

2026-10-20按用户明确范围先撤回上一轮全部22个文件的未提交改动，确认工作区恢复至e05d4bc，再仅修改Markdown CSS的10处font-size。正文16→14px，h1–h6为26/22/18/16/14/14px，行内代码、表格及代码正文14→12px，代码标题12→10px；原行高、间距和其他属性保留。全局样式、左侧工作区、输入框、工具栏及其他TSX均与HEAD一致；其余差异仅为既有字号断言及本Spec/verify。

固定Node24.20.0、pnpm10.34.6环境下，`pnpm --filter @my-pi-harness/web build`通过三个Web类型面与生产构建，修改文件Prettier、文档和diff检查通过。`pnpm exec playwright test tests/e2e/conversation-rendering.spec.ts --grep 'Markdown流式、完成与刷新一致' --workers=1 --output=output/playwright/markdown-font-only`实际1项通过（用例5.4秒），确认正文14px/28px及Markdown各元素整数几何，流式、完成、刷新、代码/回答复制和安全渲染正常。用例覆盖明暗主题及900px窗口，实际查看窄窗口深色截图，未见重叠或页面横向溢出。

验证使用隔离profile及受控模型，未操作用户5174服务或真实账号。未重新打包Electron或验收Windows，保留Vite既有大chunk提示及此前高度诊断边界。本增量纳入0.6.3本地提交，未推送或对外发布；提交钩子执行暂存格式、全仓lint、类型和源码测试，结果以本次commit输出为准。

## 已知边界

- daemon仍读取完整已提交投影后计算差异；完整SSE基线保留8MiB上限，超大历史分页后续迭代。不能据此宣称无限历史或只读取单条变化。
- Streamdown每次仍扫描累计文字，通过分块缓存减少重复渲染；本轮未实现自有增量AST、逐行增量高亮、数学、Mermaid或交互图表。
- 模型图片仅显示替代文字和安全链接；工作区文件打开与远程图片代理后置，已有附件预览保持原有路径。
- Vite仍报告主chunk超过500KB的体积提示；高亮引擎和语言已按需拆分，本轮未建立不同Markdown解析器的性能基准或包体积门槛。
- 已验证开发态Electron原生保存及日志字节，main/preload构建与桥的单测通过；发布安装包、Windows、真实供应商及新授权的真人登录流程未在本轮重新验证，不将开发态证据等同于发布包验收。

通信协议已升至11，本机开发服务已确认无活动Run后正常重启并通过健康检查。持久事件格式版本仍为1，消息完成事实新增可选usage/finishedAt字段；已有会话无需清理，未记录的用量不回填。
