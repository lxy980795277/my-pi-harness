# 共享规则与状态归属治理验证

2026-11-09于macOS arm64执行，Node v24.20.0、pnpm 10.34.6。产品0.19.0、公开协议25、SQLite10保持；未修改会话格式、清理实际数据或提交代码。本轮属于M0和既有M1–M5维护，M6及原有外部验收缺口保持。

## 结果

本机工程与下列六条浏览器链路通过。真实第三方OAuth、真实模型请求、Windows/Linux、正式安装及Office页面版式未验证；浏览器模型/授权上游使用隔离fixture，Office链路实际执行现有测试Python环境。

| 范围        | 结果与证据                                                                                                                                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 / UC-1 | Pass：高级账户测试在未安装任何插件时读取官方endpoint Token；插件精确组件/Server归属、身份与授权代次回归保持。                                                                                                                                                                                         |
| AC-2 / UC-2 | Pass：本地/远端身份撤销后旧只读grant不再被目录和候选接受；绑定及调用复用当前规则，并拒绝缺少冻结控制revision或参数hash不符的调用。                                                                                                                                                                    |
| AC-3 / UC-3 | Pass：首个凭据删除失败后仍尝试其他引用；配置保持已提交，新凭据保持引用。覆盖OAuth客户端秘密替换/删除；发现失败清空旧目录、刷新成功恢复、在途共享、单方取消及撤销后的迟到结果。                                                                                                                        |
| AC-4 / UC-4 | Pass：schema唯一定义，存储写入、回放和读取继续校验；缺字段、字符串绑定、未知字段及被外部改坏的SQLite私有列拒绝。真实队列编辑/重建和运行时续作回归通过。                                                                                                                                               |
| AC-5 / UC-5 | Pass：详情在源文件随后变化时保持同次快照的描述/hash/正文；禁用高优先级来源后，低优先级Skill有效且单次冻结只发现一次。源变化及当前授权复核继续拒绝失效冻结。                                                                                                                                           |
| AC-6 / UC-6 | Pass：DNS双栈全结果验证、取消及迟到响应、固定单/多地址lookup，以及Web/远端认证发送前拒绝回归通过；保留网关和精确fixture例外的所属策略。                                                                                                                                                               |
| AC-7 / UC-7 | Pass：模型OAuth挑战、关闭取消、空文本响应以及日志失败重试/下载/卸载取消通过浏览器验证；主子任务产物实际下载通过。Blob URL计时释放、重复点击及失败清理有聚焦测试。附件格式、MIME、大小及非法内容保留宿主拒绝。相同下载目标重渲染的资源归属由明确owner依赖和代码复审确认，SSR测试不作为Effect运行证据。 |
| AC-8        | Pass：RuntimeStore移除无运行时消费者的恢复方法；恢复仍由宿主启动调用具体存储API。静态、类型、源码、构建及隔离部署结果如下。                                                                                                                                                                           |

## 实际命令

以下命令均在仓库根目录执行，PATH前置`.cache/node/node-v24.20.0-darwin-arm64/bin`。长源码回归通过`caffeinate -i`防止闲置休眠，不改变worker、时限或断言。

| 命令                                                                                                                                                                                                                                                                                                                                                 | 结果                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `caffeinate -i pnpm test`                                                                                                                                                                                                                                                                                                                            | 216文件通过、1文件跳过；2142项通过、2项条件跳过，81.69秒。                                                     |
| `pnpm typecheck`                                                                                                                                                                                                                                                                                                                                     | 根程序、E2E编译面与10个有检查入口的workspace均通过。                                                           |
| `pnpm lint`                                                                                                                                                                                                                                                                                                                                          | ESLint、a11y、导入/源码规则、文档及版本检查通过。末次目录诊断命名与附件PDF上限选择调整另由下面的聚焦检查覆盖。 |
| `pnpm build`                                                                                                                                                                                                                                                                                                                                         | Web及Electron main/preload构建通过；末次构建已包含下载owner归属调整。保留既有renderer配置及大chunk提示。       |
| `pnpm test:artifact`                                                                                                                                                                                                                                                                                                                                 | 3文件、7项隔离生产部署/启动/恢复/退出检查通过，14.36秒。                                                       |
| `pnpm exec vitest run packages/storage/test/storage.test.ts packages/storage/test/capability-loading.test.ts packages/agent-runtime/test/capabilities.test.ts packages/agent-runtime/test/session-runtime.test.ts packages/tools/test/skills/catalog.test.ts apps/daemon/test/skills-plugins.test.ts --maxWorkers=1`                                 | 6文件、104项通过。                                                                                             |
| `pnpm exec vitest run packages/sandbox/test/socket-address.test.ts packages/sandbox/test/public-address.test.ts packages/tools/test/web-request.test.ts packages/tools/test/web.test.ts packages/integrations/test/network-request.test.ts packages/integrations/test/remote.test.ts packages/integrations/test/remote-oauth.test.ts --maxWorkers=1` | 7文件、150项通过。                                                                                             |
| `pnpm exec vitest run apps/web/test/attachment-input.test.ts apps/daemon/test/plugin-mcp-credentials.test.ts --maxWorkers=1`                                                                                                                                                                                                                         | 全量通过后的末次小调整：2文件、19项通过，3.71秒。                                                              |
| `pnpm exec eslint apps/daemon/src/mcp/remote-options.ts apps/daemon/src/mcp/remote-service.ts apps/daemon/src/application/services.ts apps/daemon/test/plugin-mcp-credentials.test.ts apps/web/src/features/attachments/utils/attachment-upload.ts tests/e2e/session-log.spec.ts`                                                                    | 通过，覆盖末次命名、PDF独立上限及旧fixture修正。                                                               |

MCP与前端实施期间还执行了所属聚焦回归：MCP六文件84项、追加目录/本地清理两文件31项、最终远端配置16项；前端六文件23项及下载三项。它们已包含在上述全仓2142项结果中，不重复相加。

最终`pnpm format:check`、`node scripts/check-docs.mjs`和`git diff --check`通过；文档检查覆盖263份文件。没有绕过失败hook或规则，也未自动提交、推送。

## 浏览器

运行仓库现有Playwright/Chromium用例，独占临时profile、动态端口、合成身份与模型，使用实际Web构建及源码daemon。

首轮命令：`pnpm exec playwright test tests/e2e/settings.spec.ts tests/e2e/session-log.spec.ts tests/e2e/office-artifact.spec.ts --grep 'Provider OAuth|JSONL|离开会话|加载文档 Skill|子任务继承' --workers=1`。结果为3项通过、1项失败、2项环境跳过。

- Provider OAuth秘密挑战、关闭取消及空文本响应：Pass。
- 运行中下载固定JSONL前缀，完成后再次下载：Pass。
- 离开会话取消在途下载，迟到数据不触发保存：Pass。
- 日志失败重试用例的旧fixture只含message，不满足现有ApiError必需code字段，实际正确显示HTTP兜底错误。补齐fixture的code，未放宽产品解析。
- Office用例需要显式MY_PI_HARNESS_PYTHON。检查仓库已有`.cache/office-venv/bin/python`及docx/openpyxl/pptx/pypdf导入可用后，显式选择该测试环境重跑。

补测命令：`MY_PI_HARNESS_PYTHON="$PWD/.cache/office-venv/bin/python" pnpm exec playwright test tests/e2e/session-log.spec.ts tests/e2e/office-artifact.spec.ts --grep '全宽展示|加载文档 Skill|子任务继承' --workers=1`。3项通过，25.9秒：日志失败重试和完整字节下载、主任务加载Skill执行脚本并下载注册产物、子任务继承Skill并在主/子界面下载。六条唯一链路最终全部通过，不把首轮失败或跳过当作通过。

## 实施与复审

初期类型检查指出运行时可执行TypeBox参数与落盘JSON参数类型不同，保留了局部明确的hydrated MCP字段类型，其余队列字段从共享schema派生。测试补齐方法接收者类型并保留受限unbound-method说明；两处测试Promise改为显式Promise.resolve，最终类型和lint通过。

交叉复审补齐OAuth客户端秘密双引用清理及冻结控制revision判断，检查旧模型OAuth路径、旧队列schema和后台专用诊断命名已无消费者。网络和队列/Skill变更分别经过独立只读复审；没有将少量hash计算、不同OAuth拥有者、附件/产物存储或运行时/持久会话模块合并。没有新增package、跨请求Skill缓存或通用下载管理器。

## 提交收口

用户于2026-11-09后续授权本地提交，提交版本为0.19.1。前述工程和浏览器证据对应0.19.0候选实现；本次仅同步根产品版本、APP_VERSION、发布记录及相关文档，不重新构建应用目录或执行真实账号/其他平台验收。公开协议25、SQLite10和会话格式保持，提交仍执行仓库既有钩子。
