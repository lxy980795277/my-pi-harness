# M4工程实现与本机联调验证

日期：2026-10-22。应用版本0.6.4，协议13，SQLite schema 6，JSONL批次格式2。环境：macOS arm64、Node24.20.0、pnpm10.34.6；办公测试显式使用独立Python3.12环境 `.cache/office-venv`。

M4.1–M4.9的工程实现与macOS本机自动化联调已完成，可交用户review；整个M4尚未完成必要环境与平台验收。真实第三方账号、Office必要视觉检查及Windows执行适配不能由本机fixture代替，剩余工作见[实施任务](tasks.md#待完成的必要验收)。本记录补充[历史M4.1验证](verify.md)，不覆盖其原始证据。

## 实现与验收对应

| 范围      | 本机结果                                                                                                 | 详细证据                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| M4.1–M4.3 | Pass：受监管stdio、SDK HTTP/SSE、独立OAuth、目录/工具策略、配置交换、真实Pi动态加载与unknown停止         | [本地MCP](verify.md)、[MCP扩展](mcp-expansion-verify.md)                      |
| M4.4–M4.6 | Pass：冻结Skill正文/资源、压缩连续性、输入与队列、授权/撤销、创建/安装管理、九插件装配与所属资源清理     | [运行时设计](runtime-extensions.md)、[Skills与插件](skills-plugins-verify.md) |
| M4.7      | Pass：五服务族及Google五App目录、受控OAuth/Token账户核实、固定REST操作、有限Run授权、MCP账户共享及失效   | [外部连接](connections-verify.md)；真实供应商另验                             |
| M4.8      | Pass：四格式真实创建/受控修改、结构检查、PDF页图、受监管进程与浏览器下载；Office必要视觉检查Not verified | [办公执行](office-verify.md)、[下载界面](office-ui-verify.md)                 |
| M4.9      | Pass：本机源码、HTTP/JSONL、浏览器M1–M4、构建daemon及独立macOS应用启动；其他平台和正式发布未验收         | 下列实际检查及限制                                                            |

## 实际检查

以下检查使用临时profile、随机端口、独立工作区、测试身份及明确假凭据；没有读取用户根 `.env`、真实文档或第三方账号，也没有执行付费模型请求。

| 命令                                                                                                                                        | 实际结果                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run --maxWorkers=2`                                                                                                       | 117个文件通过、1个跳过；1,217项通过、2项跳过。跳过为未配置的真实Provider和非当前平台用例。               |
| `pnpm exec vitest run apps/daemon/test/connections.test.ts`                                                                                 | 全量源码检查后的最后一次大响应投影调整，17项通过；与上行重叠，不累加。                                   |
| `pnpm typecheck`                                                                                                                            | 根配置、E2E、8个workspace任务及Web独立编译面全部通过。                                                   |
| `pnpm lint`                                                                                                                                 | ESLint、a11y、依赖方向、源码约定、文档及版本检查通过；末尾测试调整另做定向ESLint，文档变更另做文档检查。 |
| `MY_PI_HARNESS_OFFICE_PYTHON="$PWD/.cache/office-venv/bin/python" pnpm test:e2e --output=output/playwright/m4-completion`                   | 61个Chromium场景全部通过，2.7分钟；包含真实办公执行与下载。                                              |
| `pnpm test:artifact`                                                                                                                        | 构建后的daemon CLI/IPC、恢复及退出：2个文件、6项通过。                                                   |
| `MY_PI_HARNESS_GITHUB_CLIENT_ID=desktop-m4-fixture pnpm package:desktop`                                                                    | 全部8个构建任务和mac-arm64应用目录打包通过，扩展与Office资源随包部署。                                   |
| `pnpm smoke:desktop`                                                                                                                        | 实际启动独立应用通过：app0.6.4、随包Node24.20.0、隔离、有限桥、扩展资源与退出。                          |
| `pnpm format:check`                                                                                                                         | 全仓格式通过。                                                                                           |
| `pnpm exec eslint tests/e2e/approval.spec.ts tests/e2e/conversation-rendering.spec.ts tests/e2e/m2-completion.spec.ts tests/e2e/m3.spec.ts` | 最后调整的浏览器用例静态检查通过。                                                                       |
| `node scripts/check-docs.mjs`                                                                                                               | 147份文档检查通过。                                                                                      |
| `git diff --check`                                                                                                                          | 通过。                                                                                                   |

最终浏览器输出保留在未追踪的 `output/playwright/m4-completion/`。实际查看模块截图及PDF页图，设置/选择/插件/连接和下载入口可用；截图不等同真实账号或Office桌面应用验收。办公副本和报告位于 `output/m4-office-validation/`，不提交测试产物。

## 关键异常与回归

- 真实Pi与临时JSONL/SQLite覆盖：候选摘要检索、下一请求工具版本、同assistant提前调用拒绝、审计提交失败、定义/授权伪造拒绝、冻结Skill资源、自动压缩保留指令、批准/拒绝以及队列撤销。
- 交叉审查发现并修复两处授权竞态：动态Skill加载提交前先验证并持有资源；异步外部检查完成后、模型派发前再同步核实授权。预期撤销停止Run，不伪报存储损坏；提交失败仍阻止后续派发。
- 外部连接测试证明派发屏障失败时网络发送为零；写请求断线只发送一次并记unknown。超大且包含大量转义字符的已知JSON响应被有界投影，保留HTTP状态和父工具关联，不因截断变成unknown。
- 首次源码全量有两个资源争用失败；隔离复跑Markdown/静态规则65项及后续2-worker全量通过，没有为通过测试改动Markdown产品逻辑。
- 首次浏览器组合回归发现旧fixture耦合：8K窗口因新增工具定义触发压缩，消耗顺序模型步骤，图片场景则明确超预算。仅对长工具链、UI状态和图片场景显式设置32K测试窗口，保留专门8K预算/压缩测试、精确请求次数和真实文件断言。审批审计断言先展开详情，保持产品默认折叠交互。
- 同时运行的独立Playwright命令曾清理共享输出目录，导致两处trace收尾ENOENT；最终使用单一整套运行及独立输出目录，61项全部通过。

## 开发桌面旧数据启动复核

用户运行 `pnpm run dev:desktop` 时，daemon在SessionJournal.decode拒绝旧数据，随后开发进程管理器联动关闭Vite。只读检查确认桌面profile对应的4份日志全部为批次v1，而当前读取器要求v2；这不是Vite启动失败。此前临时profile与独立应用验证未覆盖该用户的既有开发会话。

按开发期不做旧格式兼容、允许清理旧数据的既有授权，持有该profile的独占owner锁，通过SQLite备份API保存一致性快照，将整个旧会话目录移至仓库 `.my-pi-harness/backups/20261022152925_pre-m4-session-reset/`，再事务清理会话投影。保留全部非会话配置表，并逐表比较内容摘要：6个Provider配置、2个工作区、应用登录及MCP/插件/外部连接配置均未被清理；不删除profile、owner.sqlite、系统凭据或工作区文件。备份与清理清单留在运行数据目录，不进入Git。

随后从源码实际打开同一个profile成功，会话数0、Provider数6、工作区数2；再执行用户的原命令 `pnpm run dev:desktop`，Electron成功启动，daemon监听4311，桌面应用的auth/status、health、sessions、providers、settings与workspaces请求均返回200。没有发送模型问题。验证后以Ctrl+C关闭本次启动的进程，子进程收到SIGTERM属于主动关闭；不保留占用用户开发端口的验证实例。本次不添加兼容读取或启动时自动删数据逻辑。

## 未完成的验收与实现边界

- GitHub、Google、Vercel、Notion、Supabase真实OAuth客户端、scope审核、账号配额、REST/MCP互通和真实GitHub Skill下载：Not verified。供应商可能限制客户端或预览权限；协议fixture不能证明供应商已向此应用开放。
- LibreOffice未安装，DOCX/XLSX/PPTX页面转换与Word/Excel/PowerPoint视觉质量：Not verified。公式/域没有计算时明确报告；PDF页图已检查，区域覆盖不宣称安全脱敏。必要视觉验收尚未完成，不能将M4.8完整验收标为Pass。
- Windows stdio/Office本地执行适配未完成，当前明确拒绝；Windows实机、Linux与其他目标平台：Not verified。既有M2 Windows Shell暂缓状态不转成M4跨平台通过。
- 桌面验证是mac-arm64未签名应用目录，打包用合成GitHub Client ID；不代表正式OAuth发布配置、安装器、签名、公证或用户真实登录已验收。Skill目录桥拒绝非法/不存在ID已验证，真实用户Skill目录的系统打开体验仍待review。
- 没有创建分支、提交或推送。产品版本保持0.6.4，等待用户review及明确提交指令；M5不在本轮开发范围。

## 提交前复核（2026-10-26）

用户要求提交M4累计迭代，产品版本更新为0.7.0，通信协议14、SQLite schema 6、JSONL批次2；以上10-22记录保留其原版本与验收范围。最新MCP编辑器与连接测试的检查及共享fixture归属修正见[MCP扩展验证](mcp-expansion-verify.md#提交检查修正2026-10-26)。

提交钩子的全仓lint和根/E2E/8个workspace类型检查通过；首次源码测试119个文件通过、1个失败、1个跳过，1,241项通过、1项失败、2项跳过。唯一失败为进程生命周期测试将stdout echo到达误当成stderr也已到达，立即读取的诊断为空；生产进程的两个管道不保证到达顺序。

该用例现有界等待stderr中出现脱敏标记，再断言秘密未泄露，保留duplex、重复关闭、真实closed及PID退出断言，不修改生产行为或进程超时。修正后 `pnpm exec vitest run packages/execution/test/persistent-process.test.ts` 的13项通过；该文件ESLint、execution类型及格式检查通过。完整提交钩子结果以本次提交实际输出为准；没有补做真实账号、最新浏览器或桌面包验收。
