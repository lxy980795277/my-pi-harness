# Testing 规范

测试描述用户或调用方能观察的行为，按改动风险选择检查。静态规则、源码测试、构建产物、浏览器、真实服务和目标平台分别提供证据；不因脚本存在、类型通过或全 mock 就声明功能已经验证。

## 命令与检查范围

| 命令                   | 证据范围                                                          |
| ---------------------- | ----------------------------------------------------------------- |
| `pnpm format:check`    | 格式                                                              |
| `pnpm lint`            | ESLint、Oxlint a11y、依赖、源码约定、文档与版本                   |
| `pnpm typecheck`       | 全 workspace 源码，包括 Web 独立 Bundler 测试面                   |
| `pnpm test`            | Vitest 源码行为，不依赖 dist                                      |
| `pnpm check`           | 上述四类，不包括 Playwright 或打包                                |
| `pnpm build`           | 真实构建与版本生成                                                |
| `pnpm test:artifact`   | 构建后的 daemon CLI、IPC、恢复及退出，先 build                    |
| `pnpm test:e2e`        | 构建 Web/daemon 的 Playwright 用户场景，先 build                  |
| `pnpm test:m2`         | 工作区/工具/目录桥/时间线源码与M2浏览器链路，先 build             |
| `pnpm test:m3`         | 上下文、附件、工作状态源码与M3浏览器链路，先 build                |
| `pnpm test:provider`   | 显式专用 TEST_API_KEY/BASE_URL/MODEL 的真实 Provider；缺配置 skip |
| `pnpm package:desktop` | 构建、资源准备与应用目录打包                                      |
| `pnpm smoke:desktop`   | 实际桌面产物启动、隔离、桥及退出；前提见脚本                      |

根 package.json 是可执行入口，命令变化同步本页。局部变更运行最小充分检查；里程碑整体验收可做工程范围检查。代码、环境及风险未变化时复用已有通过结果，不因 commit/push 重复全量。CI负责keyless全量和macOS/Windows矩阵，真实供应商与外部账户独立配置，不让普通测试依赖用户Key或产生费用。

## 机械规则与审查

- ESLint 对所有 TS/TSX/CTS/MTS 配置明确编译面，no-floating-promises/no-misused-promises 保持类型感知；JS/MJS/CJS 也执行实际规则。测试和构建配置不排除在检查外。
- Web 全禁三目、void 运算符和 then/catch/finally 调用；检查 TSX Service/Query 编排、裸交互控件、内联事件、组件声明、Hook 与 Store 选择器。唯一 use-async-event.ts 启动豁免由源码 gate 限定路径、单条说明和对应调用，不开放全局 Promise 例外。
- 源码 gate 检查命名、组件目录、helper 聚合、样式 import 顺序、1000 行上限，以及 Web 无后缀/Node 显式 .js。生成代码例外必须登记具体路径，不整片排除手写目录。
- 每个新增或调整的硬规则同时有合法与非法 fixture，必须执行规则并看到拒绝；只比对配置文本或错误字符串不算规则生效。配置覆盖测试检查每类真实文件适用实际规则。
- Oxlint a11y 检查 HTML/ARIA 基础约束；shadcn 仍需真实页面检查名称、键盘、焦点及 Dialog 状态。不能以可点击 div/span 规避裸控件门禁。
- 行数不能证明职责，静态检查不做完整别名或所有权证明。TSX 复杂度、是否值得抽 Hook、Store/Query 单一来源、取消责任和凭据不进入缓存由 review 与行为检查共同确认。

## 按风险设计用例

| 改动           | 单元/集成重点                        | 额外证据                            |
| -------------- | ------------------------------------ | ----------------------------------- |
| schema/配置    | 有效输入、未知字段、范围、默认值     | 真实 HTTP/IPC 解析及拒绝            |
| 状态/权限/工具 | 主路径、拒绝、取消、结果未知         | 实际副作用边界与用户结果            |
| 连接/子进程    | 分片、启动失败、重复关闭、所有者失联 | 构建 CLI 与所属进程退出             |
| 页面/交互      | 复杂纯逻辑、Hook 状态、秘密清理      | Playwright、键盘与视觉观察          |
| SQLite/迁移    | 旧版本、顺序、重复、事务失败、损坏   | 真实临时库与恢复                    |
| 桌面/发布      | 资源、来源和桥拒绝                   | 临时 cwd 启动、无源码依赖、目标平台 |

不机械为纯 DTO、转发函数或简单布局建镜像测试；修复 bug 建立可复现回归，重构优先沿用行为测试。存储使用真实临时 SQLite，HTTP/SSE/IPC/进程保留真实边界，不全 mock 后称集成通过。普通单测可替换模型和不确定网络，真实 Provider 独立测试且标明未配置原因。

测试位于所有者 app/package 的 test 目录和根 tests/unit、tests/e2e；源码用路径解析 src，产物测试先 build 并解析 exports，不混用旧 dist。mock只声明消费者需要的接口，通过参数或工厂注入；不使用双重 unknown 断言伪造完整服务，Vitest类型从vitest导入。

## 并发与清理

- 每个用例独占临时目录、动态端口和身份，不污染用户 profile、Keychain 或开发端口；不输出认证头和秘密。测试凭据用明确假值或独立临时 namespace。
- 源码Vitest最多4个worker，限制真实ESLint/TypeScript编译面与子进程测试的冷启动资源争用；平台超时仍是失败，不通过跳过断言或全局延长时限掩盖。
- 所有失败路径在 finally/afterEach 关闭请求、流、child、server、计时器与句柄，不仅清空变量。超时必须使测试失败，不能伪装自跳过。
- 等明确事件或有界状态轮询，不用任意 sleep 代替就绪。fetch 超时不能证明端口关闭，child.killed 不等于退出；观察所属 PID、真实控制关闭和连接拒绝，避免误测另一实例。
- process.env、cwd、全局 mock 和 process 属性修改用后恢复，相关测试避免同进程并发；worker仍隔离磁盘。并发缓存或竞态通过可控 gate 安排交错，不触碰真实共享下载缓存。
- 测试 UI 订阅、取消和清理时包含重复 setup/cleanup、关闭与在途返回、旧响应覆盖、重复点击等实际风险；不只验证成功结果。

## 交付证据

- 新功能先更新 Spec/UseCase/Tasks，按已授权范围连续实现；不重复索要许可，不擅自提交、推送、重写分支或覆盖用户改动。不绕过失败 hook、测试或安全检查。
- 实际验证后才写 verify，逐项记录命令、环境、结果、缺口及必要截图。失败先记录复现和修复，不提前生成“通过”，只报告运行过的命令。
- 浏览器、Electron实际启动、真实API/OAuth、Windows机器、安装、签名与公证分别说明；未运行标记 Not verified，自动测试不能冒充用户验收。
- 覆盖率用于找遗漏，不代替行为检查。本仓库尚无覆盖率门槛，新增需同时定义命令、排除项和CI；不复制参考仓库的百分比。
- 提交 hook 执行其实际配置的静态/源码检查，不代表 Playwright 或安装验收。产品版本、签名与发布范围由 [发布规范](../06_RELEASES/overview.md) 拥有。
