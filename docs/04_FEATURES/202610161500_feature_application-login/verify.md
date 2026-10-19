# 应用登录验证

- 日期：2026-10-16，Asia/Shanghai。
- 应用版本：0.4.0；wire协议9；SQLite schema2；Session JSONL格式保持1。
- 环境：macOS arm64、Node24.20.0、pnpm10.34.6、Electron43.7.9、Chromium。
- 结论：原登录基础与本机自动化已交付；根 `.env` 与 Web/桌面分工的修正见末节。待用户真实GitHub账号与体验review；未commit/push，未删除实际开发数据、会话、工作区文件或模型凭据。

## AC与UC

| 验收             | 结果                                     | 证据与边界                                                                                                                                                                                         |
| ---------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 / UC-04    | Pass                                     | storage/auth真实SQLite覆盖首次绑定事务、回滚、稳定userId、更名、另一provider/issuer/subject拒绝、配置保留；HTTP另一账号无Cookie且归属不变                                                          |
| AC-02 / UC-01/07 | Pass                                     | 真实HTTP证明仅配对仍无应用登录；设置/模型/会话/工作区/附件/私有SSE拒绝；Origin、CSRF、未知字段拒绝；原M1–M3已登录场景保留                                                                          |
| AC-03 / UC-02/03 | Pass（可控上游）                         | 使用生产GitHub适配器，注入标准GitHub响应，实际执行Device Flow/身份校验/HTTP complete；pending、slow_down、拒绝、超时、取消、非法URL/身份、体积上限、跨客户端与重复完成均覆盖。未连接真实GitHub账号 |
| AC-04 / UC-05/08 | Pass（本机）                             | HTTP与built进程重启保留原两Cookie，在offline上游下恢复；bootstrap只复用本机信任；过期/撤销拒绝；原生应用验证新profile不自动登录                                                                    |
| AC-05 / UC-06/07 | Pass                                     | HTTP退出即时终止私有SSE，旧Cookie拒绝且另一客户端保留；前端401/到期重查清理私有Query、草稿与导航；取消/过期记录被清理后，关闭及退出仍等待其活动任务。已接受Run未被退出逻辑取消或重放               |
| AC-06 / UC-08    | Pass（自动化）；Not verified（真实账号） | Chromium验证登录页、验证码、取消重试、实际DTO头像/姓名、刷新、退出和服务侧撤销；原生macOS `.app`验证门禁、双Cookie和桥。需要用户完成真实GitHub授权及体验review                                     |
| AC-07            | Pass（本轮自动化范围）                   | 全仓静态、源码、构建、既有浏览器场景、进程恢复与macOS打包smoke通过；配置、协议、架构与技术设计已同步                                                                                               |

## 实际执行

以下各入口有重叠，不将测试数量相加称为独立覆盖。

| 命令                                                                                                                                    | 结果                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                                                                                                        | Pass：根工具、E2E及全部workspace类型面                                                                                |
| `pnpm test`                                                                                                                             | Pass：78文件通过、1文件跳过；797项通过、2项环境跳过。后续仅新增/调整任务回收边界，使用下述23项定向验证，无需重复全仓  |
| `pnpm exec vitest run apps/daemon/test/github-auth.test.ts apps/daemon/test/login-lifecycle.test.ts apps/daemon/test/login-api.test.ts` | Pass：最新源码23项；包含新增的过期目录项被清理后退出仍等待任务                                                        |
| `pnpm --filter @my-pi-harness/storage test`                                                                                             | Pass：88项，包含13项认证存储与真实SQLite测试                                                                          |
| desktop全目录Vitest                                                                                                                     | Pass：41项，含真实HTTP和Cookie store的桌面授权适配测试                                                                |
| Web全目录及后续登录专项Vitest                                                                                                           | Pass：Web既有回归通过；最新登录专项14项，覆盖未知完成结果、明确拒绝、取消晚到与过期流程重试                           |
| daemon定向M1/work/workspaces/attachments/config/server源码测试                                                                          | Pass：48项                                                                                                            |
| `pnpm --filter @my-pi-harness/daemon exec vitest run --config vitest.built.config.ts test/recovery.built.test.ts`                       | Pass：2项，复用首次两Cookie验证M1流中断和M3附件/工作状态重启恢复；该命令由pnpm在apps/daemon目录执行                   |
| `pnpm exec playwright test tests/e2e/login.spec.ts`                                                                                     | Pass：新增3场；最新冻结Web构建已复验并保留截图                                                                        |
| 既有M1/M2/M3、settings、workspace、runtime、approval的Playwright场景                                                                    | Pass：33场；首轮32过、1失败；修复后定向补验失败场景通过。与新增3场去重共36场                                          |
| `pnpm lint`                                                                                                                             | Pass：ESLint、a11y、404源码依赖检查、443文件约定、文档、版本                                                          |
| `pnpm build`                                                                                                                            | Pass：全部真实发布产物；最新daemon任务回收修改另执行daemon build，最终打包入口再次构建                                |
| `pnpm package:desktop`                                                                                                                  | Pass：最新未签名macOS arm64应用目录                                                                                   |
| `pnpm smoke:desktop`                                                                                                                    | Pass：实际`.app`启动、登录门禁、设置/模型目录、文档解析、工作区图标与目录拖入、有限桥、来源拒绝、窗口隔离及daemon退出 |
| `git diff --check`、Prettier                                                                                                            | Pass：差异空白与格式检查；最终文档收尾后重新检查文档/格式                                                             |

原生smoke使用独立临时profile，通过测试工具预先写入明确测试身份，再向Electron Cookie store注入对应测试Cookie；启动时先证明bootstrap仍未登录，之后验证登录后的既有功能。生产代码没有测试登录开关或跳过GitHub的接口。该证据不能替代真实GitHub授权。

## 本轮修正

- 原身份为daemon级内存昵称，配对即业务授权；已拆为持久本机客户端与独立应用会话。Web授权码与桌面Device Flow最终按末节对齐。
- 初轮浏览器回归发现断网后auth查询错误覆盖运行状态页；已保留仍有效的缓存身份和离线视图，401/撤销/到期继续封锁。
- 明确4xx完成拒绝改为重新登录；网络结果未知保留“重试进入”并先GET status。过期/已移除流程不阻止重新开始。
- 过期目录清理曾使活动验证任务脱离关闭等待；活动任务改为独立按所属记录跟踪，关闭和退出均等待。撤销观察的timer由LocalAuth显式拥有和释放。
- 直接以`pnpm exec node scripts/prepare-desktop.mjs`准备资源缺少npm_execpath，被脚本明确拒绝；改用仓库拥有的`pnpm package:desktop`完成装配，未修改安全检查或跳过失败。

## 视觉与人工范围

已查看Chromium登录待授权截图，紧凑居中卡片、用户验证码、取消与打开浏览器入口无溢出；桌面smoke保留原生截图。截图路径均在Git忽略目录：

- `output/application-login/login-GitHub登录可取消与重试，登录后恢复身份且退出清理草稿-chromium/github-login-pending.png`
- 同目录`github-login-restored.png`，以及另一场景的`github-login-required.png`。
- `output/playwright/desktop-login.png`、`desktop-settings.png`与`desktop.png`。

Not verified：GitHub侧OAuth App设置与用户授权、GitHub侧拒绝/撤销的真实网络体验、Windows实机及签名/公证安装包。GitHub网络在keyless测试中可控替换，不能称为真实账号通过；Windows Shell和浏览器新增目录仍沿原M2暂缓，不转移到登录或M4完成状态。

## Review入口

根 `.env` 已保存用户提供的Client ID；桌面可按[登录指南](../../07_USER_GUIDE/application-login.md)启动，浏览器需另补Client Secret与GitHub回调配置。体验首次登录、刷新恢复、退出和同账号重登。首个成功登录绑定当前profile；不提供换号/清空归属入口。通过后继续原M4.1本地MCP，不提前实现M4其他能力。

## 根 `.env` 与双入口修正验证

按用户要求重新核对标杆。Client ID 已从 TypeScript 常量移至仓库根 `.env`；该文件不进入 Git，`.env.example` 提供字段模板。开发 daemon 和 Electron 子服务自动加载根配置，进程环境优先。Web 使用授权码 + state + S256 PKCE，Electron 使用 Device Flow 并自动打开系统浏览器；通用身份适配器支持仅 Web 的 Provider，不要求提供空 Device handler。

Web callback 通过短命 Lax nonce Cookie、state 与 PKCE 关联原始本机客户端，不依赖跨站 Strict Cookie、不直接签发应用会话。回到发起页面后同源 complete 才登录；回调 hostname 不匹配提前拒绝，允许端口不同。显式重开替换旧 Web 流程；新任务在等待旧任务前即登记，退出/关闭不会漏掉在等待中的新授权。

| 检查                                                                                                                                                                                                       | 实际结果                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`、`pnpm lint`                                                                                                                                                                              | 全仓通过；随后 Web 小修、E2E 与 daemon 生命周期修正各自再次通过对应编译面和 ESLint                                                 |
| `pnpm exec vitest run apps/daemon/test/config.test.ts apps/daemon/test/github-auth.test.ts apps/daemon/test/login-api.test.ts apps/daemon/test/login-web.test.ts apps/daemon/test/login-lifecycle.test.ts` | 最终65项通过；包含PKCE交换、nonce/state/客户端错配与重放、拒绝、缺Secret不降级、Web重开、回调hostname以及退出/关闭等待旧任务的竞态 |
| `pnpm exec vitest run tests/unit/desktop-oauth.test.js apps/desktop/test/daemon.test.ts apps/desktop/test/authorization.test.ts apps/daemon/test/server.test.ts`                                           | 32项通过；白名单打包、环境优先、真实独立Node加载env、桌面Cookie及请求日志去query                                                   |
| `pnpm exec vitest run apps/web/test/application-login.test.ts apps/web/test/authorization-url.test.ts`                                                                                                     | 26项通过；入口选择、Web/Device URL限制、回调恢复、取消和完成重试                                                                   |
| `pnpm exec playwright test tests/e2e/login.spec.ts --grep-invert '离开GitHub'`                                                                                                                             | 4场通过；Web拒绝重试、登录恢复/退出、缺Cookie门禁、撤销与Desktop Device自动打开失败后手动重试                                      |
| `pnpm exec playwright test tests/e2e/login.spec.ts tests/e2e/m1.spec.ts tests/e2e/m3.spec.ts --grep '离开GitHub\|配置兼容 API、真实 Pi 流式请求\|M3 上传文本随首发' --output test-results/auth-final`      | 3场通过；新增Web返回刷新后重开，以及登录后的配置/Pi流式/分支和受保护附件历史预览；与前项共7个不同场景                              |
| 根 `.env` 自动加载检查                                                                                                                                                                                     | 通过：在daemon工作目录用tsx的Node env-file参数启动，只断言Client ID已加载，不打印私密配置                                          |
| `pnpm package:desktop` 与产物配置检查                                                                                                                                                                      | macOS arm64应用装配通过；实际资源仅有Client ID，未含根 `.env` 或已删除的application-config模块                                     |
| `pnpm smoke:desktop`                                                                                                                                                                                       | 实际macOS `.app`启动、登录门禁、Cookie/有限桥、受保护业务与退出通过；使用独立临时测试身份，不触发用户真实授权                      |
| `pnpm exec prettier --check .`、`node scripts/check-docs.mjs`、`git diff --check`                                                                                                                          | 通过；`.env`由Node解析，不交给不支持env格式的Prettier                                                                              |

最终退出/关闭竞态修正后，重新执行 `pnpm package:desktop` 和 `pnpm smoke:desktop` 均通过；对最新dist定向执行 `pnpm exec playwright test tests/e2e/login.spec.ts --grep '离开GitHub' --output test-results/auth-replacement-final`，1场通过。该场是上述5场登录中的复验，不增加独立场景数。实际最终产物的配置白名单与根 `.env` Client ID匹配检查通过，本机未配置Client Secret。

首轮日志回归发现Fastify默认请求日志带query，已改为请求子logger序列化时只保留path，回归证明code/state不写入日志。首轮浏览器fixture缺UTF-8声明导致中文locator失败，修正假GitHub页面的charset后通过；产品代码未增加测试绕过。

浏览器截图位于`test-results/`及`test-results/auth-final/`，原生登录页位于`output/playwright/desktop-login.png`；均已查看，居中紧凑卡片无溢出。真实GitHub、用户OAuth App设置、Windows实机及签名公证仍为Not verified。本机根 `.env` 当前只有用户提供的Client ID；浏览器真实登录还需由用户在本机填写Client Secret及GitHub callback，桌面需在GitHub应用开启Device Flow，见[登录指南](../../07_USER_GUIDE/application-login.md)。

## 登录视觉调整（2026-10-18）

按用户参考图将登录页改为居中紧凑卡片、圆角浅边与轻阴影。顶部复用项目 `favicon.svg`，中间显示“登录”和“使用 GitHub 账号登录进入”，主按钮使用现有静态 GitHub 品牌 SVG 与描边圆角样式；深色主题反转单色图标。验证码、等待、错误及取消/重试保留原有逻辑并统一间距和圆角。

- `pnpm --filter @my-pi-harness/web build` 通过，包括Web三个TypeScript编译面及生产构建。
- 修改组件的ESLint、Prettier、`pnpm lint:a11y`、源码约定、文档与 `git diff --check` 通过。
- `pnpm exec playwright test tests/e2e/login.spec.ts --output test-results/login-style`：5场通过，覆盖Web授权拒绝/重试、身份恢复/退出、登录门禁、撤销清理、Electron入口的设备码与自动打开失败重试、返回刷新重开。
- Playwright CLI在独立临时profile和动态端口上检查浅/深主题，实际品牌图片加载、居中卡片与按钮无溢出。截图：`output/playwright/login-style-light.png`、`output/playwright/login-style-dark.png`。测试服务与浏览器检查后关闭，不触碰实际用户profile。

本次仅改登录组件和所属Spec/验证记录；没有修改协议、增加依赖、重打桌面安装包或运行真实GitHub授权，未commit/push。

## 真实GitHub回调的issuer修正（2026-10-19）

用户真实回调的参数名为code、iss、state；原查询schema拒绝未知字段，导致合法iss在进入登录编排前返回400 INVALID_REQUEST。使用独立临时profile及假上游复现：原callback为303，加入iss或普通scope扩展后为400且未请求上游；旧dist浏览器用例同样在授权回调停留于JSON错误页。

回调现在接收有界的可选iss，并与Web挑战的authorizationIssuer精确匹配；GitHub值为https://github.com/login/oauth，不改变持久GitHub身份issuer及已有账号归属。匹配失败在授权码兑换前返回400 LOGIN_ISSUER_MISMATCH；已知重复字段、空/超长issuer仍400。仅OAuth响应查询按协议忽略未知扩展，其余接口继续拒绝未知字段。相关机制见[应用登录协议](../../03_API/application-auth.md)。

实际验证：

- daemon的config、github-auth、login-api、login-web、login-lifecycle共5个定向Vitest文件，79项通过；新增14项覆盖正确issuer、未知扩展、错误issuer与错误回调、重复字段、长度和上游零调用拒绝。
- daemon lint、typecheck和 `pnpm --filter @my-pi-harness/daemon build` 通过。
- E2E文件ESLint及 `tsc -p tests/e2e/tsconfig.json --noEmit` 通过，修改文件Prettier、文档检查与差异检查通过。
- `pnpm exec playwright test tests/e2e/login.spec.ts --grep 'GitHub浏览器授权拒绝' --output test-results/callback-issuer-before` 在旧dist按预期失败，复现合法iss被拒绝；重建后 `pnpm exec playwright test tests/e2e/login.spec.ts --output test-results/callback-issuer-fixed` 5场通过，11.1秒。假GitHub成功和拒绝回调都包含实际观察到的iss字段，完整验证回调、同源完成、Cookie、刷新、退出与重新登录。

验证未使用用户真实授权码或Secret，所有上游网络由假GitHub替换，临时服务与profile由fixture清理。没有修改本机.env、GitHub应用设置或已有数据，没有重打桌面安装包或commit/push；真实账号登录需要用户回首页重新发起。

## GitHub账号选择与用户菜单（2026-10-19）

网页授权URL加入 `prompt=select_account`，与标杆的账号选择交互对齐。点击左下角用户信息卡片向上打开同宽菜单，依次为带图标的“设置”和红色“退出登录”，侧栏独立退出按钮已移除。设置弹窗接管焦点，关闭后回到卡片；退出沿用已有会话撤销与私有缓存、草稿清理流程。

- `pnpm exec vitest run apps/daemon/test/github-auth.test.ts apps/daemon/test/login-web.test.ts`：35项通过，验证授权URL参数及现有Web回调/完成流程。
- `pnpm --filter @my-pi-harness/daemon build` 与 `pnpm --filter @my-pi-harness/web build` 通过；后者包含Web三个TypeScript编译面。
- `pnpm exec playwright test tests/e2e/login.spec.ts tests/e2e/settings.spec.ts --grep 'GitHub浏览器授权|本机信任仍在|服务端撤销后|桌面入口使用设备码|离开GitHub|用户卡片只打开|设置内容加载中|内置厂商只读设置' --output test-results/user-menu-alignment`：8场一次通过，17.5秒，覆盖账号选择参数、退出清理、菜单方向/顺序、Esc/外部点击回焦、设置加载及弹窗焦点。
- 修改源码、E2E与桌面smoke脚本的定向ESLint、E2E TypeScript、Prettier、a11y与源码约定检查通过。

已查看 `test-results/user-menu-alignment/` 内的 `user-menu-light.png` 和 `user-menu-dark.png`，两项菜单紧凑且无溢出。桌面smoke脚本已更新为卡片→菜单→设置，本次未重新打包或运行原生smoke；真实GitHub账号选择仍由用户验收，测试使用独立临时profile和假上游。未commit/push。

## 退出确认与登录loading（2026-10-19）

退出菜单只打开警示确认弹窗，默认聚焦取消；取消和Esc不发送退出请求，身份、草稿和页面保留，关闭后焦点回卡片。确认按钮才调用已有退出流程。警示图标、浅灰取消和实心危险色确认按钮通过ConfirmDialog的可选warning呈现启用，其他确认弹窗保持原有样式。

网页登录从发起请求到页面离开保持禁用的GitHub按钮，显示“正在前往 GitHub…”；回调恢复和完成请求显示“正在登录…”。跳转状态独立于请求事件结束，真实失败可重试，历史页面恢复后可再次登录；Electron设备码与手动打开保持可用。

- `pnpm --filter @my-pi-harness/web build`：通过，包含Web三个TypeScript编译面及生产构建。
- 修改源码的定向ESLint、`pnpm lint:a11y`、`node scripts/check-source-conventions.mjs` 通过；最终E2E TypeScript、ESLint与Prettier通过。
- `pnpm exec playwright test tests/e2e/login.spec.ts tests/e2e/settings.spec.ts --grep 'GitHub浏览器授权|本机信任仍在|服务端撤销后|桌面入口使用设备码|离开GitHub|退出确认可取消|浏览器登录慢请求|用户卡片只打开' --output test-results/auth-confirmation-loading`：初轮7场通过；loading场景受暂停跨站导航时Playwright等待新文档影响，调整测试观测方式。
- `pnpm exec playwright test tests/e2e/login.spec.ts --grep '浏览器登录慢请求' --output test-results/login-loading-regression`：最终1场通过，4.6秒；仅该场定向复验，不重复其余7场。假GitHub返回204以保留文档，验证请求事件结束后按钮仍loading、persisted pageshow恢复、慢回调完成及502后重试。共8个不同场景覆盖通过。

已查看浅/深色退出确认、浅/深色发起登录及回调loading截图。确认图位于 `test-results/auth-confirmation-loading/` 的 `logout-confirmation-light.png` 与 `logout-confirmation-dark.png`；登录图位于 `test-results/login-loading-regression/` 的 `login-start-loading.png`、`login-start-loading-dark.png` 和 `login-callback-loading.png`。主题截图禁用过渡动画，导航行为使用断言验证，不保留导航过程中未绘制的截图。

未使用真实GitHub账号或本机开发数据，未更改协议、登录凭据和依赖，未重打桌面安装包或commit/push。
