# M1统一验证

日期：2026-10-14。本页记录M1首次交付时的结果；后续模型设置、无Key模式和规范整改以[M1.6验证](../202610140900_feature_model-settings/verify.md)为准。M1.1至M1.5已连续设计、实现和自测，本次交付整个M1供用户验收，未做Git提交或推送。环境为macOS 26.5.1 / arm64、Node 24.20.0、pnpm 10.34.6、Electron 43.7.9。Windows和真实供应商账号的结果没有执行，不写成通过。

## 已交付

- 20个Pi原生Provider及三个自定义协议；独立账户/端点、模型限制与兼容选项、API Key、OAuth交互/取消/退出、旋转凭据保存、可选GitHub应用PKCE与Device Flow。
- Session/Run、版本化追加事件、同事务seq与投影、SQLite迁移、OS自动释放profile所有权、已提交上下文恢复；系统凭据与数据库分别管理。
- 配对和桌面私有启动授权、HttpOnly Cookie、严格Host/Origin、CSRF、受保护HTTP/SSE、有限openAuth桥。
- 流式文字/推理、停止、持久跟进/引导、队列增改删与显式恢复、编辑新分支、分支历史、会话设置与归档；浏览器与Electron共享页面和服务事实。

实现位置和字段以[架构](../../01_ARCHITECTURE/overview.md)、[协议](../../03_API/model-session.md)及源代码为准，操作见[使用指南](../../07_USER_GUIDE/model-session.md)。

## 已执行证据

| 检查                                      | 结果与实际范围                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| pnpm install --frozen-lockfile            | PASS；strict peers，Pi core/ai均1.1.0                                                                                          |
| 无dist与Turbo缓存的pnpm check             | PASS；format、全仓ESLint/a11y、依赖/源码/文档/版本门禁、所有TS程序、322项源码测试；2项明确skip                                 |
| 最终pnpm test                             | PASS；325项源码测试、2项明确skip；包含新增平台目录用例                                                                         |
| 最终PC目录与配置检查                      | PASS；新增3项macOS/Windows路径行为，桌面25项、配置/路径17项局部回归及desktop typecheck                                         |
| pnpm build                                | PASS；源码检查后重新构建protocol、storage、agent-runtime、daemon、Web、main/preload                                            |
| pnpm test:artifact                        | PASS；4项真实构建产物测试，正常IPC/退出及SIGKILL恢复                                                                           |
| pnpm test:e2e                             | PASS；Chromium 7项，兼容API配置/密钥清空/真实Pi HTTP/流式对话/刷新/分支/停止/队列/引导以及M0连接回归                           |
| Playwright CLI人工自动交互                | PASS；配对、配置、连接测试、聊天、编辑/切回分支、刷新、退出；浅深布局实际查看                                                  |
| pnpm package:desktop + pnpm smoke:desktop | PASS；最终macOS arm64 .app，从源码之外的临时目录启动；随包Node 24.20.0、原生SQLite与凭据模块、20工厂、私有授权、桥与权限、退出 |
| macOS native Keychain独立检查             | PASS；显式临时profile命名空间，真实write/read/list/delete，删除后缺项；没有接触现有用户凭据                                    |
| pnpm audit --prod --json                  | 0条生产告警                                                                                                                    |
| pnpm audit --json                         | 1条moderate，既有electron-builder链的sprintf-js；无可用修复，不宣称全依赖无告警                                                |

最后PC目录变更只改变Windows默认路径及无效目录拒绝；macOS数据仍位于隔离userData。该变更之后重新构建、打包并执行桌面smoke；最后补HTTP页面防嵌入header后，daemon相关10项检查与typecheck通过，并再次构建、打包、桌面smoke和浏览器回归。源码全量无产物检查之后的局部回归单独记录，不冒充同一次全量结果。

两项skip分别为Windows专用宿主检查和显式真实Provider检查；普通源码套件不读取 `.env`、用户 `~/.pi` 或供应商环境Key。真实API入口 `pnpm test:provider` 只读取专用 `MY_PI_HARNESS_TEST_API_KEY`、`MY_PI_HARNESS_TEST_BASE_URL` 和 `MY_PI_HARNESS_TEST_MODEL`，本轮没有提供这些凭据或产生真实供应商计费。

## 关键行为

运行测试使用真实Pi Agent和SQLite。本机HTTP合成服务验证三个协议各自路径/headers、两账户凭据隔离、上下文输入不重复、Provider失败与SDK取消；模型服务是受控fixture，未以它冒充真实供应商验收。SDK认证协调验证URL、device code、secret/select/manual prompt、取消、注销和刷新后的Token旋转。

真实独立daemon用例提交输入与部分流式输出后强杀，另一个进程接管同profile；遗留Run变interrupted，部分消息保存，seq恰递增一次。SSE从指定seq到高水位连续、不含private codec或Key；凭据重新写入不触发模型，显式resume后队列消费且回复完成；旧requestId重试没有额外模型请求或新seq。所有子进程、监听器、临时profile与测试凭据均清理。

已修正并验证：运行接受后初始化失败导致残留、普通新消息恢复旧暂停队列、旧Run释放新Run所有权、队列跨分支混入、Provider在resolve期间被替换、OAuth取消后仍在旋转Token的关闭竞争、存储损坏被错误返回422。持久化失败停用会话并返回503，保留已提交事实待重启恢复，不写假完成。

## 未验证与当前限制

| 项目                                             | 状态                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| Windows真实运行、凭据库、打包/安装和退出         | Not verified；仅路径单测与既有CI矩阵，不能据此证明目标平台通过           |
| 真实DeepSeek/OpenAI及其他供应商API               | Not verified；三协议和原生工厂已受控测试，账号/区域/厂商服务仍需实际检查 |
| 真实Provider OAuth与GitHub应用注册               | Not verified；SDK协调及PKCE/device协议fixture已通过，没有真实账户登录    |
| 签名、公证、正式安装器与自动更新                 | 本次未实现；产物为未签名应用目录                                         |
| 本机工具、附件、MCP、子Agent、记忆、Computer Use | 属于后续里程碑                                                           |

M1读取完整当前分支快照并虚拟滚动，尚无历史分页界面；SSE单记录上限8MiB，极长历史的分页和增量传输需后续完善。会话删除为归档，不能声称隐私擦除。M1首次交付时自定义Provider要求显式保存Key；M1.6已新增明确的无Key模式，其实现和验证见上述增量记录。可选GitHub身份只保存在当前daemon生命周期，不作为长期账号系统。

## 用户整体验收

1. 运行 `pnpm dev:desktop`，或打开macOS应用目录 `release/mac-arm64/My Pi Harness.app`；也可 `pnpm dev` 后用终端码配对浏览器。
2. 配置自己的OpenAI兼容API，保存Key，选模型测试，再创建会话并发送文字。
3. 检查流式回复、停止/队列修改与恢复、编辑分支和切回历史、刷新重新打开会话以及正常退出后重启。
4. 按需要补真实OAuth/GitHub账号及Windows验收；其结果单独加入此记录。

操作截图在本地 `output/playwright/m1-chat-light.png`、`m1-chat-dark.png`，桌面产物smoke截图为 `output/playwright/desktop.png`。这些临时验证产物不提交源码仓库。
