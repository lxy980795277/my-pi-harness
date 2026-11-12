# 自动初始化本机客户端验证

2026-11-12，产品0.19.1，macOS arm64，Node24.20.0。公开协议因AuthStatus字段及接口变更升为28；SQLite与持久数据结构未改，不清理真实数据，不自动提交。

## 结果

| 用例           | 结果               | 证据                                                                                                                              |
| -------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| UC1 首次Web    | Pass               | 清空Cookie后真实页面自动POST初始化并进入登录页，无配对表单；人为注入一次503时显示重连错误，点击重新连接后恢复                     |
| UC2 恢复       | Pass               | 合成GitHub经真实daemon的state/nonce/PKCE流程完成登录；刷新保留身份、session及CSRF，刷新无初始化写入；显式重复初始化保留已登录状态 |
| UC3 失效与退出 | Pass               | HTTP覆盖过期、持久恢复、撤销和SSE；浏览器确认退出后保留客户端但业务返回401，再次登录草稿为空                                      |
| UC4 非法请求   | Pass               | HTTP拒绝缺失/错误/null Origin、错误Host、旧code字段；GET状态不签发Cookie，仅初始化无法读取业务数据，已登录访问旧配对端点404       |
| UC5 桌面       | Pass（源码与构建） | main私有bootstrap与流程归属回归、CLI启动和恢复通过，main/preload构建通过；本轮未重新打包或启动原生App                             |

## 实现复核

删除配对页面、表单Hook、菜单、状态、终端输出、挑战/尝试次数、两条旧接口及专属DTO。浏览器只在GET状态发现缺少客户端时POST `/api/auth/client`；取消或晚返回不能安装旧CSRF。有效客户端复用原token、CSRF和绝对有效期，应用登录仍单独验证。桌面main继续持有私有ownerSecret，Renderer没有新增任意授权能力。

现行架构、协议、指南、规范和包说明已同步；历史Feature/Release保留当时事实。生产源码无旧配对方法、状态字段或DTO引用，测试仅保留旧端点404与无配对UI的拒绝断言。

## 自动检查

命令均在仓库根使用Node24.20.0执行。

- `pnpm exec vitest run apps/daemon/test/login-api.test.ts apps/daemon/test/login-web.test.ts apps/daemon/test/m1-api.test.ts apps/daemon/test/session-log-api.test.ts apps/desktop/test/authorization.test.ts packages/storage/test/auth.test.ts --maxWorkers=2`：6文件62项通过。
- `pnpm --filter @my-pi-harness/daemon test:deployment test/recovery.deployment.test.ts test/bootstrap.test.ts --maxWorkers=2`：2文件6项通过。
- `pnpm exec vitest run apps/web/test/application-login.test.ts apps/web/test/plugin-authorization.test.ts apps/web/test/plugin-app-authorization.test.ts apps/web/test/client-state-lifecycle.test.ts --maxWorkers=2`：4文件48项通过。
- `pnpm typecheck`：根与e2e、11个workspace任务通过。
- `pnpm lint`：ESLint、a11y、1138源文件边界、1209文件源码约定、272篇当时文档及版本检查通过。新增本验证后的文档检查另行通过。
- `pnpm format:check`：通过。验证记录及最终索引调整另做定向格式检查。
- `pnpm --filter @my-pi-harness/web build`：三编译面与Vite产物通过，保留既有大chunk提示。
- `pnpm --filter @my-pi-harness/desktop build`：main/preload通过；独立Web构建沿用既有方式，未为既有renderer config提示添加无关配置。
- `git diff --check`：通过。

## 浏览器观察

使用Playwright CLI的独立`automatic-client`浏览器、动态端口daemon、临时profile和内存凭据库，未读取根.env或访问真实GitHub。页面使用本次Web产物；只替换GitHub上游与授权页面，daemon实际处理回调、兑换、身份验证与应用Cookie。

实际点击首次进入、失败重连、GitHub登录、批准合成授权、刷新、用户菜单确认退出和再次登录。请求记录显示失败重试为GET status→POST client（503）→GET status→POST client（200），未登录时无工作台业务请求。新临时实例的正常首次进入直接初始化，状态为clientInitialized=true、authenticated=false，业务请求401；登录后刷新不再POST client，身份/会话/CSRF保持，菜单无生成配对码按钮。

首个夹具把avatar_url写为null，既有GitHub身份校验正确拒绝；修正为合法头像URL后通过，没有改生产解析。另一次辅助脚本错误假定CLI跨调用共享globalThis，已改为单次调用内的观察和CLI请求记录；未改变产品。503测试出现预期HTTP错误日志，最终正常流程控制台0错误、0警告。

截图`output/playwright/automatic-client-login.png`与`automatic-client-workspace.png`已实际查看，登录布局及工作台侧栏无遗留配对入口。两个临时daemon均观察到退出，浏览器已关闭，临时profile已回收。

## 未验证范围

未进行真实GitHub账号授权、Windows验证、原生Electron启动、安装包/签名或付费模型请求；既有里程碑中的平台与账号验收缺口保留。新增与迁移的`tests/e2e/login.spec.ts`已通过类型检查，本轮浏览器证据来自CLI实际操作，没有声称运行整个Playwright测试文件。
