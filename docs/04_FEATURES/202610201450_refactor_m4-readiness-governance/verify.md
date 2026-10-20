# M4前代码治理验证

日期：2026-10-20。基线为0.6.1（38fd352），治理结果纳入0.6.2本地提交。本专项不实现M4能力，不删除开发数据，也不改变通信协议或持久化格式。

## 范围与结论

按[治理入口](../../10_GOVERNANCE/overview.md)检查Web、daemon、runtime、storage、execution、desktop、脚本与当前文档。静态规则覆盖工程入口，人工审查覆盖授权、会话队列、流式消息、附件、日志提交/恢复、工具执行与桌面生命周期等关键调用链；不宣称逐行证明全仓无缺陷。

确认高0项、中4项、低4项，8项均已修复、清理或修正文档。命名、领域类型、弃用API和空值表达式没有确认需要额外修改的问题；未将个人风格偏好计为缺陷。

| 编号 | 级别 | 位置                                                                                                   | 确认问题与处理                                                                                                    | 证据                                                                                              |
| ---- | ---- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| G-01 | 中   | scripts/smoke-desktop.mjs                                                                              | preload已公开5项，smoke仍断言4项；同步精确白名单，并验证危险URL和非可信窗口调用被拒绝                             | 0.6.2真实macOS应用目录smoke通过                                                                   |
| G-02 | 低   | apps/web/src/features/models/services/providers.ts                                                     | fetchProvider只有声明，无源码、测试、脚本或动态入口消费者；删除未使用包装，保留公开协议与宿主GET路由              | 引用核对、类型及构建检查                                                                          |
| G-03 | 低   | apps/web/src/features/auth/utils/private-cache.ts                                                      | 退出清理仍识别旧health查询，误删实际公共健康缓存；复用真实查询key，精确保留健康和授权状态                         | 使用实际key的回归先失败，修复后通过；私有runtime缓存仍被删除                                      |
| G-04 | 低   | scripts/desktop-oauth.mjs                                                                              | 显式Client ID存在时仍读取根.env；改为缺省时才读取文件，保留校验和文件错误                                         | 将.env置为目录的fixture验证显式配置不读文件、缺省仍报读取错误                                     |
| G-05 | 中   | apps/web/src/features/sessions/components/queue-panel/index.tsx、hooks/use-queue-item.ts               | revision变化触发重挂载，丢弃本页队列草稿；改用稳定ID，开始编辑时冻结text/revision，冲突保留草稿                   | 旧产物真实浏览器复现编辑器消失；修复后远端更新保留草稿，过期保存返回409，取消重开使用最新内容     |
| G-06 | 中   | apps/web/src/features/auth/hooks/use-authorization.ts、utils/authorization-status.ts、services/auth.ts | 退出或授权撤销后，在途状态响应可恢复旧UI授权状态；统一读取取消、代际、Query发布和显式恢复，阻止已取消读取安装CSRF | 真实QueryClient与deferred读取复现旧状态覆盖；修复后的注销、撤销、旧CSRF、过期恢复与新登录场景通过 |
| G-07 | 中   | docs/07_USER_GUIDE/model-session.md                                                                    | 指南仍将归档历史归因于SQLite事件；改为实际JSONL事实与原分支内容，并补充队列冲突交互                               | 核对当前存储/归档实现；保留历史验证记录                                                           |
| G-08 | 低   | apps/daemon/src/features/attachments/service.ts                                                        | 私有freeze调用均已有perform拥有的signal，可选参数及新controller兜底无实际需求；收紧私有参数直接透传               | 附件6项源码测试、daemon类型、产物附件路径通过；公开接口不变                                       |

G-05确认的是本页草稿丢失，没有将初步推测的静默覆盖远端修改当作已复现行为。G-06涉及Renderer状态及CSRF竞态，宿主仍校验Cookie，不是已确认的服务端鉴权绕过；受控并发单测与普通浏览器登录回归分别计证。

## 静态核对

- 引用扫描核对源码、测试、脚本、配置、CSS和动态资源消费者，只删除确认未使用的fetchProvider包装。pdfjs-dist和officeparser由worker通过import.meta.resolve使用，eslint-config从根index.js导出，均保留。
- types目录未发现冗余-view命名；其他目录的oauth-view、work-view和context-view承担实际转换职责。扫描到的并列空值字段未形成需要重写的多级默认，不机械替换所有??。
- 未新增Knip或硬性静态规则。不存在新增规则却缺少通过/拒绝fixture的问题；弃用调用继续由现有类型感知lint检查。
- check-source-conventions通过505个文件，check-boundaries通过458个源码文件，产品版本一致性检查通过0.6.2。Web三个类型面、daemon、E2E类型及修改文件ESLint/Prettier通过。

## 行为与产物验证

正式记录使用macOS arm64、Node24.20.0和pnpm10.34.6。命令前将仓库.cache中的固定Node目录加入PATH。

| 命令                                                                                                                                                                                                                | 结果                      | 覆盖                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------ |
| pnpm exec vitest run apps/web/test/application-login.test.ts apps/daemon/test/attachments.test.ts                                                                                                                   | 2文件30项通过             | 授权24项、附件6项                                |
| pnpm exec vitest run apps/desktop/test/security.test.ts apps/desktop/test/preload.test.ts tests/unit/desktop-oauth.test.js                                                                                          | 3文件22项通过             | 桌面来源/桥权限及构建Client ID配置               |
| pnpm exec turbo run build --filter=@my-pi-harness/daemon...                                                                                                                                                         | 5项构建任务通过           | daemon及依赖实际产物                             |
| pnpm test:artifact                                                                                                                                                                                                  | 2文件6项通过              | 构建后启动和恢复                                 |
| pnpm exec playwright test tests/e2e/login.spec.ts tests/e2e/m1.spec.ts tests/e2e/runtime.spec.ts tests/e2e/m3.spec.ts tests/e2e/conversation-rendering.spec.ts --workers=2 --output=output/playwright/m4-governance | 27项通过，约1分钟         | 登录7、M1 3、runtime 5、M3 6、会话渲染6          |
| MY_PI_HARNESS_GITHUB_CLIENT_ID=synthetic-governance-client-id TURBO_FORCE=true pnpm package:desktop                                                                                                                 | 7项构建任务实际执行并通过 | 0.6.2 macOS arm64应用目录，未使用构建缓存        |
| pnpm smoke:desktop                                                                                                                                                                                                  | 通过                      | 同一0.6.2应用目录、隔离profile、桥权限与进程退出 |

浏览器使用隔离数据和合成身份/供应商，运行真实Pi、HTTP和SSE。覆盖登录拒绝/重试/恢复/退出、CSRF保护、远端更新与队列409、审批、附件与继承上下文、问题表单、计划、检查点、摘要、版本门禁/重连，以及Markdown、复制、工具、等待/停止、滚动和高亮降级。它不替代真实GitHub或模型供应商验收。

桌面smoke实际检查隔离cwd/profile、登录门禁、RTF解析、设置、目录拖入、资源链接约束、CSP、精确5项桥能力、危险URL与非可信窗口的HTTPS请求拒绝，关闭后确认daemon PID消失且端口关闭。没有打开系统外部页面、读取真实.env、调用真实OAuth/模型，或操作用户profile及已有服务。

提交钩子执行暂存格式、全仓lint、全仓类型与源码测试；结果以本次commit输出为准，以上定向、浏览器和产物证据独立保留。

## 失败复现与验证修正

- 队列回归首次针对旧产物运行，远端更新后等待保存按钮超时；快照确认编辑器消失且显示远端内容，属于预期暴露的旧缺陷。记录保存在output/playwright/m4-governance-queue-before，未计为通过。最终用例等待完整权威会话更新后断言草稿与409，不依赖固定sleep。
- 授权回归以真实QueryClient和可控延迟重现已退出状态被旧authenticated结果覆盖；修复后同一行为检查及补充交错场景通过。
- 首次桌面打包误用主机默认Node25.2.1，虽成功但带engine警告，不计为固定运行时证据。随后使用Node24.20.0强制重建全链并smoke通过。
- 新增桌面拒绝检查首次因evaluate字符串中的函数未调用而失败；改为立即执行表达式后，在同一最终应用目录重跑通过。没有将验证脚本错误归因于产品权限漏洞。

## 文档与后续边界

同步登录技术文档、用户指南、功能Spec、Roadmap、M4计划当前状态、0.6.2版本及发布记录。通信协议仍为11，SQLite schema仍为2，JSONL批格式和私有codec仍为1，无迁移或数据清理。

本次桌面产物为未签名的macOS arm64应用目录，没有DMG/NSIS、签名、公证、Windows或升级验收。保留Vite主chunk约975kB警告、Electron单独构建Renderer提示、旧deploy及传递依赖弃用提示、默认图标和跳过签名提示；未将依赖提示当作自有代码deprecated调用。

既有Markdown细微高度变化、真实供应商输出与渲染耗时、Windows Shell、浏览器新增目录及真实账号边界不因本次治理视为已解决。下一步按既有M4模块拆分进入M4.1详细设计，再按Spec开发。
