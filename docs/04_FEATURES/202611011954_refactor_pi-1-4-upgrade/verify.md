# Pi 1.4升级验证

日期：2026-11-01（Asia/Shanghai）。环境：macOS darwin/arm64，项目Node 24.20.0、pnpm 10.34.6。工程、构建与真实对话在升级后0.14.2候选版本执行；用户随后授权本地提交，产品版本与APP_VERSION同步为0.15.0，不重建桌面包。公开协议22、SQLite9保持不变。

## 结论

本次工程实现与本机自动化验证完成。正式Pi core/ai及传递telemetry解析为1.4.0，旧core→ai 1.1.0覆写移除；没有引入本地Pi仓库Unreleased实现或coding-agent等新运行层。不清理用户数据、重写凭据或自动替换模型；按用户授权整理本地提交，不推送。

源码全量最终为194个测试文件通过、1个文件跳过；1867项通过、2项跳过。相关浏览器30个独立场景的首轮26项通过，四个测试前置条件修复后复测5项全部通过（包含这四项及受helper调整影响的图片场景）。构建、6项daemon产物测试、macOS未签名应用目录打包和真实Electron隔离smoke通过。

后续按用户要求完成DeepSeek V4.1 Flash真实对话补测：4个会话、9轮主对话及2个只读子任务。文件操作、子任务汇总、等待停止和停止后恢复正常；发现一次模型原始算术错误及一次模型请求超时，不能据此声明回答质量或请求稳定性全部通过。具体证据见下节。

## AC与UC证据

| 范围             | 结果             | 实际证据                                                                                                                                                                 |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC1 / 依赖一致性 | Pass             | catalog、lock只解析core/ai 1.4.0；正式产物的私有消息编码标记1.4.0；格式、lint和全workspace类型检查通过                                                                   |
| AC2 / UC1、UC2   | Pass（受控服务） | 新Provider回归检查Kimi Completions及/coding/v1，旧显式失效型号/API和档位拒绝、自定义配置不改；既有三协议/keyless/认证隔离、取消和lease回归通过                           |
| AC3 / UC4        | Pass             | codec和storage按应用字段读取、SDK来源独立；坏来源/codec/argumentsError类型拒绝；签名和完整原始消息保留，真实HTTP请求过滤跨模型思考但不改日志                             |
| AC4 / UC3        | Pass             | 同一assistant中必填及空schema工具的坏JSON均在审批和执行前拒绝；有界原因进入下一模型请求，完整错误私有保留；复用调用ID的后续合法工具不串台；调用/结果成对落盘             |
| AC5 / UC5        | Pass（本机编排） | lease stream统一身份，真实Pi Agent默认身份不会覆盖应用UA；API Key和keyless的HTTP头验证通过。主子Run、摘要、审批均复用该lease路径，既有通信、请求调度、取消和审批测试通过 |
| AC6 / UC6        | Pass（本机范围） | 部署应用目录从临时cwd启动，实际Electron桥/登录隔离/资源/就绪和关闭smoke通过；包内独立Node在/tmp加载runtime、六个lazy Provider及新Kimi端点通过                            |

## 实际命令

以下工程检查在仓库根运行，Node通过`.cache/node/node-v24.20.0-darwin-arm64/bin`加入当前检查进程PATH。这些自动化检查未读取用户供应商Key；用户另行授权的真实对话补测单列于下节。

| 命令                                                                                                                                                                                                                 | 结果                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm install --ignore-scripts`                                                                                                                                                                                      | Pass，正式依赖与lock统一                                                                           |
| `pnpm check`                                                                                                                                                                                                         | 首轮格式通过，lint发现新测试嵌套matcher产生any；已改为文本投影断言并重查                           |
| `pnpm lint && pnpm typecheck && pnpm test`                                                                                                                                                                           | lint、边界/源码/文档/版本gate、全workspace类型通过；源码轮次1866通过、1项静态规则测试超时、2项跳过 |
| `pnpm test`                                                                                                                                                                                                          | 在其他重负载验证结束后单独执行：1867通过、2跳过；没有修改测试时限或放松静态规则断言                |
| `pnpm exec vitest run packages/agent-runtime/test/model-gateway.test.ts`                                                                                                                                             | 13项通过，含两条应用身份真实HTTP回归                                                               |
| `MY_PI_HARNESS_GITHUB_CLIENT_ID=synthetic-upgrade-client pnpm package:desktop`                                                                                                                                       | Pass，8个构建任务通过，生产deploy与macOS arm64未签名应用目录完成                                   |
| `pnpm test:artifact`                                                                                                                                                                                                 | 2文件、6项通过；独立daemon的启动/关闭/恢复通过                                                     |
| `pnpm smoke:desktop`                                                                                                                                                                                                 | Pass，真实打包Electron、临时profile/cwd、桥和退出检查通过                                          |
| 包内独立Node执行`/tmp/my-pi-upgrade-artifact.mjs`，传入包内daemon/package.json                                                                                                                                       | Pass，runtime实路径位于应用资源内，codec来源1.4.0，六个lazy Provider可加载，Kimi新协议/端点正确    |
| `pnpm exec playwright test tests/e2e/m1.spec.ts tests/e2e/m2.spec.ts tests/e2e/m3.spec.ts tests/e2e/m5.spec.ts tests/e2e/mcp-expansion.spec.ts tests/e2e/plugin-connection.spec.ts`                                  | 首轮26通过、4项fixture假设失败；M2、M5及MCP正常                                                    |
| `pnpm exec playwright test tests/e2e/m1.spec.ts tests/e2e/m3.spec.ts tests/e2e/plugin-connection.spec.ts --grep '新对话与已有对话回车\|计划反馈与批准\|上下文摘要版本\|GitHub 授权与应用目录跨重启\|图片可上传预览'` | 修复fixture后5项全部通过                                                                           |
| `pnpm exec eslint tests/e2e/m1.spec.ts tests/e2e/m3.spec.ts tests/e2e/plugin-connection.spec.ts && pnpm exec tsc -p tests/e2e/tsconfig.json --noEmit`                                                                | 最终测试配置lint及类型通过                                                                         |

局部codec、工具执行、storage、Provider与wire测试的结果由对应测试文件及全量源码终轮覆盖，不把早期未完成文件导致的中间失败当作最终结果。

## 真实对话补测

时间：2026-11-01 20:11–20:16（Asia/Shanghai）。使用构建后Pi core/ai 1.4.0、DeepSeek V4.1 Flash、原配置的关闭推理档位与100万上下文窗口。通过Playwright CLI操作真实页面发送全部输入，模型请求未经替换。只读原profile中的模型配置，并使用只读凭据适配访问既有API Key；登录使用隔离测试身份，不执行真实GitHub登录。临时profile、动态63134端口和合成工作区独立于用户4311/5174服务。

| 场景                   | 结果                 | Run耗时及实际证据                                                                                                                                                                                                |
| ---------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 普通问答与Markdown表格 | Pass                 | 0.907秒；两项小计58.50、68.00，优惠后116.50，零工具                                                                                                                                                              |
| 同会话修改商品数量     | 模型回答失败         | 1.142秒；应为184.50/增加68，模型却回复150.50/增加34。解码日志确认完整用户输入到达第二轮请求，SDK原始响应、公开消息和页面逐字一致，未发现适配或呈现污染                                                           |
| 追问纠错               | 数值恢复，说明不准确 | 2.301秒；更正为184.50/68，却声称本轮要求不调用工具，与实际输入相反。该会话未配置工作区，不以此例验收计算工具能力或认定存在可用工具却拒用                                                                         |
| CSV生成JSON            | 文件与工具链Pass     | 7.952秒；5次工具，独立核对小计3600/1700/1150、总额6450。CSV原文未改，目录只新增summary.json                                                                                                                      |
| 同会话续改CSV/JSON     | Pass                 | 11.243秒；8次工具，B数量改为4、小计3400、总额8150；重新读取两个文件，独立核对其他数据和文件未变                                                                                                                  |
| 两个只读子任务后汇总   | Pass                 | 主Run17.797秒；两个researcher子Run分别8.355、7.511秒，均completed；39/33/72正确。主Run没有read_file；子任务仅执行读取与搜索，未出现写入或审批等待                                                                |
| 提问等待后停止         | 重试后Pass           | 首次10.573秒失败，SDK原文为Request timed out，零已记录用量；同会话重试后ask_user进入pending。点击输入框停止后，Run、工具、问题均cancelled，提问卡片退出。重试Run22.303秒包含人工检查等待时间，不表示模型输出耗时 |
| 停止后续问及页面重载   | Pass                 | 0.863秒；同会话回复“可以继续对话”。页面重载并重新选择会话后，失败原因、已取消工具与后续答复均可恢复                                                                                                              |

9个主Run最终为7个completed、1个failed、1个按测试要求cancelled；2个子Run均completed。全程29次工具调用；结束时没有activeRun、排队输入、pending问题或非终态工具/任务。主子会话持久SDK来源均为1.4.0。总已记录用量176,328 tok，其中输入22,252、输出5,980、缓存读取148,096、缓存写入0；包含所有工具轮和子任务的重复上下文，不等于纯生成token或账单金额。超时请求的未返回用量未知。

回答质量另有两项观察：模型在CSV未指定货币时自行补充“美元”；子任务出现重复读取和额外资料读取，完成简单求和所需的调用和解释偏多。没有据单次样本修改产品提示词或归因于Pi版本升级，也未以运行completed替代内容正确性判断。

本轮执行隔离实例脚本、Playwright CLI的fill/press/click/snapshot/reload/close、只读API与解码日志审计，以及独立文件/终态断言；没有新增产品测试或重跑全量源码套件。一次UI等待命令误用heading定位实际generic标签而超时，改用真实页面快照检查。实例脚本首次收尾请求100000条公开事件，超过1000条分页上限；独立只读审计已完成，确认所有Run/Task终态后终止所属PID并显式删除临时登录状态。这两项测试脚本错误未计入产品故障。

原始证据位于忽略的`output/playwright/pi-14-real-conversations-20261101/`：`live-audit.json`包含主子快照、完整工具参数、请求消息及SDK原始回答；`file-first-run.json`和`file-followup.json`保存文件核对；`result.json`记录统计与终态断言；`cleanup.json`记录实例退出、认证状态删除与原模型配置相同。截图及页面快照位于其`.playwright-cli/`。隔离浏览器与实例已关闭，动态端口连接拒绝，临时浏览器登录状态删除；没有复制或新增模型凭据，用户原模型配置保持不变。

## 发现与修复

1. storage投影也固定校验SDK 1.1.0，实际改写1.4来源后拒绝工具事实并冻结会话。已与runtime codec同步去除SDK版本分支，仍严格校验应用codec及消息字段。
2. 原始参数schema校验先于Pi完整JSON错误反馈。通过当前SDK assistant批次的原始参数对象取argumentsError，在审批/副作用前返回有界错误；不增加另一份消息状态或放松严格类型校验。
3. 原生Provider仅修改model端点，目录刷新仍使用原端点。已让Provider元数据和模型采用同一显式地址，新增真正调用Pi refresh的回归。
4. 四项浏览器场景使用8192窗口，同时把辅助摘要计入固定主模型请求数或手动摘要版本。Trace明确记录估算超80%阈值及automatic摘要；为这些独立场景配置32768窗口，保留请求数量、下一轮工具可见性和版本父链的原断言，不修改产品压缩策略。
5. 并行源码/浏览器/产物检查时，一项实际TypeScript程序的ESLint规则测试超过既有10秒时限。其他重负载结束后完整源码套件通过，未修改时限、规则或断言。

## 未验证与范围

- Not verified：除本轮DeepSeek Flash API Key及关闭推理档位外的真实供应商/型号/推理档位、模型OAuth、真实GitHub/Google账户、Windows、正式安装器、签名和公证。工程自动化测试使用受控模型/授权服务；本轮真实对话不代替完整M1–M5验收，也未覆盖真实插件账户或自动压缩。
- 桌面smoke使用合成公开GitHub Client ID，仅验证装配和临时身份隔离，不代表真实GitHub登录可用的发布候选包。
- 浏览器截图/trace位于忽略的`test-results`；桌面smoke截图位于`output/playwright`。截图证明本机自动流程，不替代用户视觉确认。
- Pi 1.4的工具变化缓存收益仍受本应用system重建策略限制；未发布增量JSON解析、完整工具registry、遥测看板及摘要策略重构未纳入本迭代。M6保持规划。
