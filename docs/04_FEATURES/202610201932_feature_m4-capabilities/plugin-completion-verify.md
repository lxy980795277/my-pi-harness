# M4 插件连接与任务工作流补齐验证

2026-10-26，产品0.8.0、协议15。属于M4.6–M4.9；本轮实现及macOS定向工程验证完成，真实供应商、DOCX页面视觉和Windows验收仍为Not verified，不将整个M4标为已验收。范围见[补齐Spec](plugin-completion.md)。未提交或推送。

## 环境与隔离

macOS arm64、固定Node24.20.0、pnpm10.34.6、Chromium，办公测试使用现有`.cache/office-venv/bin/python`。源码测试使用真实临时SQLite、文件与本机HTTP/OAuth/SDK fixture；浏览器运行构建后的daemon和Web，模型由受控Pi兼容服务提供。凭据均为明确假值，没有授权真实账号、读取用户凭据、根`.env`或更改用户profile与5174开发服务。

## 结果

| 范围           | 结果与证据                                                                                                                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 插件账户与归属 | Pass。详情内新增/配置账户、秘密提交后清空、发起/取消/重新打开授权、自动读取完成、多账户选择、显式关联及解除；Google五个App绑定同一明确账户。真实HTTP拒绝错供应商、旧revision/epoch、断开账户、错误归属、非官方目标及未知字段；关联不读取Token、不发网络、不自动恢复信任。          |
| App开关与状态  | Pass。REST目录、grant及派发按精确App复核；共享MCP同样检查所属App。关闭Docs、保留Drive不能继续通过其他Google通道使用Docs。旧独立OAuth标志不使GitHub/Google在未关联账户时显示就绪。                                                                                                  |
| 独立OAuth取消  | Pass。实际SDK/HTTP覆盖取消、一次性state、其他Server不受影响、在途换Token、凭据写入中的首次连接/重新授权取消。交互流程先暂存凭据，成功时写新引用并复核取消与权限；取消保留原记录与原Token、删除候选槽。                                                                             |
| Skills与资源   | Pass。GitHub四个、Google六个独立任务Skills及渐进资源可预览、安装和读取；Documents/PDF补充实际工具参数与检查流程。显式同步保留App引用、账户及同名Skill偏好；活动租约、旧revision和错误发布拒绝，普通失败回滚文件并推进revision。                                                    |
| DOCX           | Pass（结构与文件链路）。布局、命名样式、富文本、段落格式、重复表头、页眉页脚/页码、受控PNG/JPEG、精确修订与格式编辑；拒绝样式循环、越界路径/图片及无效版面。默认页面实际边距参与图片尺寸校验。浏览器完成工具加载、明确审批、创建、详情与原始hash绑定下载。页面视觉为Not verified。 |
| PDF            | Pass（结构与所查页图）。flow自动分页、长表重复表头、页眉页脚/页码、单选/多选choice写入回读；非法布局、字段值及冲突模式拒绝。10页中文长文与85行表格样例重开后提取文字，并实际查看第1、6、10页PNG，未观察到溢出或页眉页脚缺失。                                                      |

## 实际检查

以下源码命令分轮执行且存在重叠，不累加为独立用例总数。

```sh
pnpm exec vitest run packages/execution/test/office packages/agent-runtime/test/capabilities.test.ts packages/agent-runtime/test/connection-runtime.test.ts apps/daemon/test/connections.test.ts apps/daemon/test/plugin-connections.test.ts apps/daemon/test/plugin-sync.test.ts apps/daemon/test/skills-plugins.test.ts apps/daemon/test/plugin-preview.test.ts packages/integrations/test/plugin-preview.test.ts packages/integrations/test/skills/catalog.test.ts --maxWorkers=2
```

11个文件、88项通过。随后增加样式继承循环拒绝与OAuth生命周期回归：

```sh
pnpm exec vitest run packages/execution/test/office/formatting.test.ts apps/web/test/plugin-app-connection.test.ts apps/web/test/plugin-connections.test.ts apps/web/test/remote-mcp-test.test.ts apps/daemon/test/mcp-directory-api.test.ts packages/integrations/test/remote-oauth.test.ts --maxWorkers=2
```

6个文件、29项通过。最终资源正文及旧配置状态调整后：

```sh
pnpm exec vitest run apps/web/test/plugin-app-connection.test.ts apps/web/test/plugin-connections.test.ts apps/web/test/remote-mcp-test.test.ts apps/daemon/test/plugin-preview.test.ts packages/integrations/test/plugin-preview.test.ts --maxWorkers=2
```

5个文件、25项通过。最终凭据写入竞态修复后：

```sh
pnpm exec vitest run apps/daemon/test/mcp-directory-api.test.ts packages/integrations/test/remote-oauth.test.ts --maxWorkers=2
```

2个文件、8项通过；包含受控阻塞凭据写入的新增回归。

`pnpm typecheck`、`pnpm lint`、`pnpm build`和`pnpm format:check`通过。最后OAuth源码调整另跑daemon类型检查、daemon构建、所改源码/测试ESLint与格式检查通过；最后浏览器测试调整另跑E2E类型与ESLint。文档、差异空白与最终增量格式检查单独执行。构建保留既有Vite大chunk与Electron独立renderer配置提示，未将其当作桌面打包验收。

浏览器使用`MY_PI_HARNESS_OFFICE_PYTHON="$PWD/.cache/office-venv/bin/python" pnpm test:e2e`，所有轮次均为`--workers=2`、独立输出目录。共9个不同场景均有通过记录：插件账户3个、Skills/导航3个、外部连接1个、远程MCP1个、办公产物1个；不是一次全九项绿灯的结果。

- 首轮同时运行`plugin-connection.spec.ts`、`skills-plugins.spec.ts`、`connections.spec.ts`、`mcp-expansion.spec.ts`和`office-artifact.spec.ts`：7通过、2失败。失败分别为旧Markdown纯文本断言和默认审批方式假设；未为通过测试改变产品默认值。
- 办公复跑明确选“请求批准”，`office-artifact.spec.ts`通过；同轮Documents继续暴露旧简介选择器，随后全部改为当前简介。
- `pnpm test:e2e tests/e2e/skills-plugins.spec.ts tests/e2e/plugin-connection.spec.ts --output=output/playwright/plugin-completion-final --workers=2`：6通过、19.7秒。
- 最终daemon重建后，`pnpm test:e2e tests/e2e/plugin-connection.spec.ts tests/e2e/mcp-expansion.spec.ts --output=output/playwright/plugin-completion-release-check --workers=2`：4通过、14.6秒。

GitHub/Google的账号OAuth和服务信任使用真实daemon及合成供应商；GitHub目录展示和独立Notion App OAuth生命周期场景有明确UI fixture，不代表官方MCP已经连接。实际查看最后输出中的账户概览及`github-plugin-components.png`、`google-plugin-components.png`：App保持单行、连接详情可折叠，开关与信任状态可区分。办公浏览器证据位于`output/playwright/plugin-completion-followup/`；PDF及第1、6、10页图位于`output/office-final-review-evd4tvg8/`。这些输出均不作为源码资源提交。

## 修复与剩余边界

审查复现了取消OAuth与系统凭据异步写入交错时仍替换旧Token的问题，已用流程暂存及新引用发布修复。测试用可控gate进入实际写入窗口，再取消并检查原记录、原字节及候选清理，避免仅在网络阶段取消而漏掉持久化窗口。

资源同步不是文件系统与SQLite的全局事务。硬退出可能留下停用记录或隐藏备份，后续显式同步可重建；没有自动崩溃协调器。普通失败的恢复证据不代表进程被杀后的恢复。

真实GitHub/Google Client配置、用户同意页、实际系统浏览器、供应商scope/审核/MCP准入及真实服务工具调用为Not verified。合成OAuth不能代替这些验收。环境未安装LibreOffice，DOCX没有转换为页面图，结构成功不代表字体、分页及桌面Office版式已验收。Windows/Linux、新Electron安装包、签名、公证以及收费服务本轮未执行；既有M4验证中的相应缺口继续保留。

## 授权中转页补充（2026-10-26）

产品和协议版本不变。Web插件与连接管理入口在首次await前打开同源中转窗，立即设置opener为null；原页使用既有认证和CSRF发起OAuth，再校验授权地址并导航该窗口。中转页仅接受已注册供应商标签，不挂载App、不发出登录/工作区/OAuth请求，也不接受账户、名字或跳转地址参数。Electron保留既有系统浏览器桥，不要求系统浏览器共享Renderer登录。

Pass：阻止弹窗时零OAuth POST；延迟接口时已可见中转窗与关闭按钮，opener为null；一次点击只有一次POST，StrictMode没有重复启动；失败与发起请求期间卸载关闭本地中转窗；用户先关闭窗口仍保留已创建流程，重新打开复用同一URL、清除旧错误，明确取消后旧callback拒绝。原GitHub/Google多账户、状态轮询、账户关联及独立Notion OAuth回归保留。供应商页面跳转后的窗口能否物理关闭不作为后台撤销的证明。

实际检查：

- `pnpm exec vitest run apps/web/test/connection-oauth-launch.test.ts apps/web/test/plugin-connections.test.ts apps/web/test/plugin-app-connection.test.ts --maxWorkers=2`：3个文件、21项通过，含同步先开窗、HTTP/非法URL失败清理、abort、提前关窗后保留流程、重复打开不新建流程、桌面桥分支及查询参数拒绝。
- `pnpm --filter @my-pi-harness/web build`：Web三个类型编译面与生产构建通过；重新打开清除旧错误的最终修改后再次构建通过。保留既有大chunk提示。
- 所改源码/测试的ESLint、E2E类型、定向Prettier、`pnpm lint:a11y`、依赖边界、源码约定、文档检查与`git diff --check`通过。首次ESLint要求公开函数补充返回类型，已修正并复查。

浏览器使用独立daemon/profile和真实窗口，GitHub/Google同意页由context route替换为静态合成页面，Token交换使用现有本机issuer；未访问真实账号或供应商授权服务。

```sh
pnpm test:e2e tests/e2e/connection-oauth-launch.spec.ts tests/e2e/plugin-connection.spec.ts --output=output/playwright/oauth-launch-20261026 --workers=2
```

首次8通过、1失败，29.0秒。失败为测试错误地要求导航到供应商页面后窗口必须物理关闭，实际父页已撤销后台流程；修正为检查旧callback拒绝、流程清除与原页状态。单场景复跑通过，5.1秒；随后补充重开后旧错误消失，并修正两个入口的错误清理。

```sh
pnpm test:e2e tests/e2e/connection-oauth-launch.spec.ts tests/e2e/plugin-connection.spec.ts --grep '用户提前关闭中转窗|GitHub 插件|Google 插件|独立 App OAuth' --output=output/playwright/oauth-launch-final-20261026 --workers=2
```

最终重建后4通过、14.7秒。6个新增中转场景与3个原插件场景共9个不同场景均有通过记录，分轮重跑不累加。实际查看初次输出中的`github-oauth-launch.png`：720×760窗口中加载卡片居中、文字与控件正常，没有工作台或重复加载区域。

本次没有增加默认GitHub OAuth Client、修改账户凭据或回调地址，也未运行新的Electron实例或真实系统浏览器授权。桌面分支由单元替身验证；真实GitHub用户同意、浏览器差异、Windows及既有M4必要验收缺口仍为Not verified。未提交或推送代码。

## 插件单一授权入口（2026-10-27）

本轮替换插件详情中的多账户表单，产品0.8.0、协议15不变。当前默认入口只有授权或断开及账户状态，等待期间提供取消和重新打开；没有添加账户、Client ID/Secret、账户选择器或手动关联。高级连接管理保留。OAuth客户端来自daemon配置；GitHub优先专用插件配置，否则共用既有登录客户端注册与回调路径，插件Token和登录流程独立。

Pass：GitHub单击打开同源中转窗，再进入合成供应商页；回调后自动关联所属App、刷新账号，保留应用登录及其他手动账户。Google一次授权自动关联五个精确App；授权不自动授予MCP启动信任。阻止弹窗不产生POST或后台账户；缺少daemon客户端显示错误而不恢复表单。取消、重新打开、独立App OAuth及高级连接管理回归通过。

Pass：身份epoch、插件revision/generation、账号归属与一次性state复核；共用GitHub回调不签发、消费或清除登录Cookie，并行登录流程保留。取消或修改插件发生在凭据异步写入期间时，候选秘密删除、账户不发布。删除默认账户后使用新UUID，旧授权不能复活。插件配置改变后旧URL不可重新打开，状态503期间停止旧轮询，恢复后可立即重新授权。自定义插件回调来源只允许精确GET回调路径，普通业务API仍拒绝该额外来源。

实际源码检查使用固定Node24.20.0和pnpm10.34.6：

```sh
pnpm exec vitest run apps/daemon/test/plugin-authorization.test.ts apps/daemon/test/config.test.ts apps/daemon/test/connections.test.ts apps/daemon/test/login-web.test.ts apps/daemon/test/plugin-connections.test.ts --maxWorkers=2
```

5个文件102项通过；最后补充无显式URL时保留登录回调路径后，单独重跑`plugin-authorization.test.ts`和`config.test.ts`，2个文件52项通过。Web初轮4个相关文件30项通过；最终旧revision与网络失败修复后`plugin-authorization.test.ts`12项通过。各轮用例有重叠，不累加。

`pnpm build`通过；后续变更分别重建Web与daemon通过。Web三个类型编译面、daemon类型、E2E类型、所改源码/测试ESLint、`pnpm lint:a11y`、`pnpm format:check`、依赖边界、源码约定、文档与`git diff --check`通过。构建仍保留既有Vite大chunk和Electron renderer配置提示。

浏览器使用构建后的真实daemon/Web、临时profile和端口、本机合成issuer与拦截的供应商同意页。共13个不同场景分别有通过记录：6个插件、6个授权中转、1个高级连接；不是同一次全13项通过。

- `pnpm test:e2e tests/e2e/plugin-connection.spec.ts tests/e2e/connection-oauth-launch.spec.ts tests/e2e/connections.spec.ts --output=output/playwright/plugin-single-authorization-20261027 --workers=2`：11通过、1失败，GitHub默认回调路径断言不符。
- `pnpm test:e2e tests/e2e/plugin-connection.spec.ts --output=output/playwright/plugin-single-authorization-final-20261027 --workers=2`：5通过、1失败，新增测试要求跨站窗口物理关闭。改为检验可控的页面状态、轮询和重新授权。
- 最终共享回调构建后，`plugin-connection.spec.ts --grep 'GitHub 插件一键授权|插件版本改变' --output=output/playwright/plugin-single-authorization-retake-20261027 --workers=2`：GitHub通过，旧流程测试暴露本地页面尚未提交的fixture假设；其后单场景本地窗口版本通过。
- 最终简化为实际用户可见的旧流程清理、503期间停止轮询、恢复后重新授权：`pnpm test:e2e tests/e2e/plugin-connection.spec.ts --grep '插件版本改变' --output=output/playwright/plugin-single-authorization-stale-final-20261027 --workers=1`，1通过、5.5秒。

实际查看`plugin-single-authorization-retake-20261027/`中的GitHub未授权和已授权截图：授权区为紧凑单行，表单及手动关联已消失；已授权显示合成账号。Google截图位于`plugin-single-authorization-final-20261027/`。截图和trace只作为本机验证产物，不提交。

只核对本机根`.env`相关键是否已配置，未输出其值、修改`.env`、读取真实Token或授权真实账号。没有启动或关闭用户开发服务，也未运行新Electron实例；真实供应商用户同意、scope/审核/MCP准入和跨平台验收仍为Not verified。未提交或推送。

## 插件完整流程重构（2026-10-27）

产品保持0.8.0，公开协议升级16，SQLite schema升级7。本节是当前实现的验证；上方默认账户、共享登录回调、父窗发起授权和固定服务操作的历史证据不作为当前架构。

已完成插件声明、0600文件凭据、OAuth、连接状态、只读网关与MCP消费的职责拆分。GitHub/Google不再创建高级账户或关联connectionId；公开App的credentialSource决定授权来源，前后端均不按供应商名称猜测。专用SKILL客户端不回退到应用登录配置。文档权威入口为[插件协议](../../03_API/plugin-connections.md)。

### 行为证据

| 范围           | 实际结果                                                                                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth与凭据    | Pass。GitHub repo/user及PKCE；Google完整scope、offline/consent和id_token账号；10分钟一次性state，60秒刷新及同插件请求合并。凭据原子写入0600文件；旧刷新、在途换码与写入不能覆盖后来的授权或恢复已断开的Token。                                     |
| HTTP与身份     | Pass。真实临时daemon拒绝未登录写入、浏览器客户端注入及登录客户端回退；独立回调不签发登录Cookie。卸载后的迟到回调进入错误结果页，不交换或恢复Token。Google一次授权为五个App提供同一来源，仍保持App关闭。                                            |
| 弹窗与桌面入口 | Pass（浏览器及桌面适配协议）。浏览器同步开窗，由弹窗自行POST；主窗每秒轮询、关窗停止。窗口被拦截不启动OAuth，无客户端时只显示错误。一次性ticket在未登录浏览器兑换，fragment渲染前清除，重放、目标或身份变化拒绝；React重复effect不重复消费。       |
| MCP            | Pass。App开关显式开启及信任固定目标；Token按精确归属及官方地址读取，错误endpoint在读取前拒绝。刷新改变私有连接摘要且保留账号authority；断开清空目录并使冻结工具失效。独立App保留MCP OAuth。                                                        |
| 后台发现       | Pass。受控阻塞发现期间OAuth回调和状态刷新均已返回；断开、停用、移除及退出取消所属发现，退出等待任务收束，迟到结果不恢复目录。意外错误仅报告固定诊断，不包含上游错误或秘密。                                                                        |
| 网关与模型     | Pass。真实ToolRuntime web_fetch可进入私有网关，普通浏览器Cookie不能代替能力头；能力头只发往精确回环网关，供应商Token只加到固定上游。禁止路径、认证查询、重定向及超限响应。公开gatewayUrl进入冻结Skill、模型上下文和会话事实，不改变Skill文件hash。 |
| 旧配置         | Pass。SQLite7只移除旧managedPluginId字段，保留账户及秘密引用；使用真实临时数据库验证迁移及重复打开。没有手动修改用户profile或读取实际Token。                                                                                                       |

### 实际检查

使用固定Node24.20.0及pnpm10.34.6。以下分轮检查有重叠，不累加为独立用例总数：

- `config.test.ts`38项、`plugin-oauth-parity.test.ts`13项、最终`plugin-connection-api.test.ts`7项通过；`plugin-credentials.test.ts`3项、`plugin-manifests.test.ts`12项、`plugin-oauth.test.ts`3项通过。
- MCP最终执行`pnpm --dir apps/daemon exec vitest run test/plugin-mcp-credentials.test.ts test/mcp-directory-api.test.ts`，2文件14项通过、3.46秒；包含最终后台发现的阻塞、取消和诊断回归。
- `pnpm --dir apps/daemon exec vitest run test/plugin-gateway.test.ts`4项、`pnpm exec vitest run --config packages/execution/vitest.config.ts packages/execution/test/web.test.ts packages/execution/test/web-request.test.ts`46项通过；覆盖私有能力头和只读访问。`pnpm --dir packages/agent-runtime exec vitest run test/connection-runtime.test.ts test/capabilities.test.ts test/run-toolset.test.ts`16项通过，验证模型/会话事实。高级账户最终`pnpm --dir apps/daemon exec vitest run test/connections.test.ts`13项通过。
- `pnpm exec vitest run packages/storage/test apps/daemon/test/skills-plugins.test.ts apps/daemon/test/plugin-sync.test.ts apps/daemon/test/login-web.test.ts apps/daemon/test/login-lifecycle.test.ts --maxWorkers=2`首轮164项中161通过、3失败，均为旧App默认启用、旧connectionId资源正文及schema6断言；更新为新行为后，相关3文件加MCP凭据文件复跑28项通过。新增`plugin-account-migration.test.ts`单独通过；其首轮缺少fixture账户外键，补齐真实用户记录后通过。
- Web最终6个插件/启动页定向测试文件共27项通过；另有工具展示及高级连接的相关回归。Web三个类型编译面及生产构建通过。
- `pnpm typecheck`通过；最终后台发现调整后另跑daemon类型检查通过。`pnpm exec turbo run build --filter=@my-pi-harness/daemon...`六个实际构建任务通过；最终daemon源码另行构建通过。未运行新Electron打包或桌面实例。
- 最终源码`pnpm lint`通过，包含ESLint、a11y、697个源文件依赖检查、754个文件源码约定、文档与版本检查；`pnpm format:check`、最终文档及差异检查通过。初轮发现测试类型感知lint问题、未绑定回调、App数组联合推断及一处文档链接，均已修正后复查。

浏览器使用构建后的真实daemon/Web、临时profile和动态端口；供应商同意页由浏览器route替换，换码使用本机合成issuer，不访问真实账号。共10个不同场景分别有通过记录：7个授权/桌面入口/独立App场景与3个原Skills/插件导航场景，不是一次全10项运行。

首轮7个授权场景5通过、2失败，GitHub和Google结果页错误使用小写插件ID；改为声明中的展示名称后，二者及3个Skills/导航场景共5项通过。元数据统一及后台发现完成后，最终构建执行：

```sh
pnpm test:e2e tests/e2e/plugin-connection.spec.ts --grep 'GitHub 插件由弹窗|Google 插件由弹窗' --output=output/playwright/plugin-parity-complete-20261027 --workers=2
```

2项通过，6.9秒。实际查看GitHub授权区、App二级详情及结果页截图：没有账户表单或手动关联，已授权账号单行显示，App仍关闭且说明复用插件授权；Google同流程通过。最终产物位于`output/playwright/plugin-parity-complete-20261027/`，此前导航及深色截图位于`plugin-parity-final-20261027/`；均为本机验证输出，不提交源码。

### 真实环境边界

真实GitHub/Google授权仍需宿主配置专用SKILL客户端及供应商登记的精确插件回调；应用登录配置不能替代。实际`.env`、真实Token及其他项目凭据未读取或修改。官方用户同意页、scope/审核/MCP准入和真实服务调用为Not verified；合成OAuth证明本地授权链路，不代表供应商已为当前机器配置完成。

Electron真实系统浏览器、Windows/Linux、新安装包、签名公证及既有Office视觉缺口继续保留。没有启动或终止用户开发进程，没有提交或推送，M5尚未开始。

## 授权回调失败诊断（2026-10-27）

用户实际完成GitHub页面验证后，本地结果页仅显示通用失败。回调原先捕获并丢弃了所有异常，因此该截图不能确认是客户端配置、一次性state、网络、账号读取还是凭据保存失败。本次增加有限阶段、有限原因和固定提示；日志只补充插件ID、阶段、原因及可选HTTP状态，沿用请求ID，不记录供应商描述、正文、原始异常、授权码、state或Token。HTTP200响应若同时含error和access_token也按失败处理，不能继续读取账号。产品0.8.0、协议16和SQLite7不变。

实际检查使用Node24.20.0及pnpm10.34.6：

- `pnpm --filter @my-pi-harness/integrations exec vitest run test/plugin-oauth-errors.test.ts test/plugin-oauth.test.ts`：31项通过，覆盖供应商已知错误、网络分类、取消/超时、非法响应、账号读取与刷新撤销。
- `pnpm exec vitest run apps/daemon/test/plugin-connection-api.test.ts apps/daemon/test/plugin-oauth-parity.test.ts --maxWorkers=2`：23项通过，包含真实临时HTTP、固定提示与安全日志、本机写入失败及现有授权生命周期。初次新增测试发现error与Token同时存在时仍被接受，修正后本轮复跑通过。
- integrations与daemon类型检查、对应源码/测试ESLint及E2E类型检查通过。`pnpm exec turbo run build --filter=@my-pi-harness/daemon...`六个任务通过；未修改Web运行时代码，浏览器复用既有Web构建。

```sh
pnpm test:e2e tests/e2e/plugin-connection.spec.ts --grep 'GitHub 授权失败|GitHub 插件由弹窗' --output=output/playwright/plugin-oauth-diagnostics-20261027 --workers=2
```

2项通过、6.9秒。使用真实构建后的daemon/Web、临时profile和动态端口；供应商同意页与Token接口使用合成场景。验证成功链路回归、失败页具体固定提示、敏感参数不进入结果URL及失败后保持未连接。实际查看`github-oauth-specific-failure.png`，结果提示完整、布局正常；产物只保留在本机output目录，不提交。

无凭据探测当前GitHubToken地址和账号地址均收到HTTP响应，仅证明本机传输当时可达，不证明客户端凭据有效或真实授权可完成。未读取真实Secret/Token，未发起真实换码，也未启动或终止用户开发服务。真实失败原因仍等待用户完整重启、从插件详情发起新授权后根据具体提示确认；本次不宣称真实账号问题已解决。

## GitHub回调发行者修正（2026-10-27）

用户反馈新提示为授权响应校验失败，且从插件详情重新授权、过程中没有重启。随后用纯假参数复现插件将授权端点origin作为issuer的错误：GitHub正确的`https://github.com/login/oauth`在零上游请求时被拒绝，错误的`https://github.com`反而被接受。[GitHub官方声明](https://docs.github.com/en/apps/github-authentication-discovery-endpoints)与本仓已有应用登录及高级账户定义均保留该路径。此前测试回调只生成code/state，遗漏iss。

宿主manifest新增必填oauth.issuer，五家内置服务显式配置，不从端点origin或回调参数推断；保持未带iss的回调支持，存在iss时精确匹配。错误issuer返回有限reason和固定提示，state/PKCE、一次性消费及撤销保持不变。URL校验拒绝缺失、HTTP、凭据、query、fragment与私网地址。产品0.8.0、公开协议16与SQLite7不变，未改.env。

实际使用Node24.20.0及pnpm10.34.6：

- 新增`plugin-oauth-issuer.test.ts`先跑红，9项中4项失败，复现正确issuer拒绝、错误origin接受。修复后与`plugin-manifests.test.ts`、`plugin-oauth-errors.test.ts`、`plugin-oauth.test.ts`一起执行，4文件58项通过。包括正确iss、无iss、错误origin、伪造地址、尾斜杠与state不匹配。
- `pnpm exec vitest run apps/daemon/test/plugin-connection-api.test.ts apps/daemon/test/plugin-oauth-parity.test.ts --maxWorkers=2`：24项通过。真实临时HTTP回调带正确issuer；错误issuer零换码、保持未连接，再创建新流程可成功，已有保存、重放及撤销回归通过。
- integrations与daemon类型检查、所改TS/E2E的ESLint及E2E类型检查通过。`pnpm exec turbo run build --filter=@my-pi-harness/daemon...`六个任务通过；依赖边界、源码约定、文档及差异检查通过。

```sh
pnpm test:e2e tests/e2e/plugin-connection.spec.ts --output=output/playwright/plugin-oauth-issuer-20261027 --workers=2
```

8项通过、19.6秒。GitHub/Google合成回调均包含正确iss，覆盖授权成功、用户拒绝、关窗、阻止弹窗、缺客户端、桌面ticket及独立MCP入口。浏览器使用真实构建daemon/Web、独立profile和动态端口，供应商及账号为合成数据；不代替真实GitHub用户同意和Token交换验收。未读取真实凭据，未启动或终止用户开发服务，未提交或推送。已修复并验证所复现的issuer缺陷，真实账号成功仍待用户重启后验证。

## 插件能力全链路对齐审计（2026-10-27）

范围仍为M4.6–M4.9；本节记录本轮实际运行，早先局部通过不能替代本节。环境为macOS、Node24.20.0、pnpm10.34.6；所有自动化使用独占临时profile、动态端口与合成凭据，没有修改用户正在运行的服务、真实profile或其他项目资源。

### 实现与独立审查

内置资源启动对账、精确App修复、详情与安装正文一致、主/子开关、共享OAuth及目录状态已补齐；App目标统一从随包`.app.json`读取。目录增加SQLite schema8快照、授权指纹重验、单飞/四路并发/30秒等待及独立失败状态。审查进一步发现本地前置文件检查原先不在准备任务内，已把目录、绑定冻结和绑定复核的等待纳入受管所有权：取消/截止可以结束调用方等待，关闭仍等待真实文件操作结算，迟到工作不能连接或发布。

工具检索采用MiniSearch BM25与本地CPU向量融合，搜索后自动暂存、下一请求加载；完整名称优先，默认8/最多10/全局64，语义超时回退词法。启用Skill摘要、服务诊断、显式提及及无工作区只读网关进入已记录上下文。

第二轮审查补齐Skill跨Run与压缩保留、队列撤销降级、分支前缀隔离，以及动态Documents/PDF激活时同步暂存已冻结的本地Office工具。旧Skill绑定失效时仅省略继承并给固定诊断，显式选择继续严格拒绝；不把旧正文换成新磁盘内容。历史查询只投影Skill JSON及消息锚点，以seq每批16条处理，实时保留最近16个Skill，避免重复加载历史完整MCP目录。摘要来源保留首次创建时的reset边界，选回reset后生成的摘要不能复活reset前Skill。

### 源码行为

以下轮次有交集，不累加为唯一用例总数。

- Runtime整包21文件159项通过；随后补充摘要来源边界，3文件31项定向回归、Runtime typecheck/ESLint通过；最后新增1项后未重跑整包。覆盖真实Pi多轮、搜索自动加载与持久屏障、Skill摘要、提及、跨Run/压缩/队列/分支、撤销及无工作区网关。
- 插件daemon4文件34项通过：`plugin-sync`、`skills-plugins`、`plugin-preview`、`plugin-mcp-credentials`。新增资源声明/manifest2文件33项、Web插件4文件15项通过；主开关和详情额外有真实浏览器覆盖。
- MCP、codec和schema8定向9文件70项首轮69通过，唯一失败为后台刷新完成前立即断言。测试改为等待新Token绑定及目录ready后，`plugin-mcp-credentials.test.ts`14项全部通过；没有重跑已经通过的其他文件。目录准备/已恢复目录绑定冻结/绑定复核的取消和截止3文件26项另已通过。
- 新`packages/storage/test/skill-context.test.ts`4项通过，覆盖接受/动态加载、重开、可见分支前缀、跨多批21个Run及最近16项界限；非对象激活JSON继续拒绝，不因SQL投影变成空对象。既有tools/session-jsonl2文件44项通过。
- 本地Worker与Web执行2文件37项通过；Office2文件19项通过，使用显式`.cache/office-venv/bin/python`，不安装运行时软件。

主要补充命令：

```sh
pnpm exec vitest run apps/daemon/test/mcp-catalog-lifecycle.test.ts apps/daemon/test/mcp-catalog-failure.test.ts apps/daemon/test/mcp-api.test.ts apps/daemon/test/mcp-directory-api.test.ts apps/daemon/test/remote-mcp-configuration.test.ts apps/daemon/test/plugin-mcp-credentials.test.ts packages/integrations/test/catalog-snapshot.test.ts packages/storage/test/mcp-catalogs.test.ts packages/storage/test/plugin-account-migration.test.ts --maxWorkers=2
pnpm exec vitest run apps/daemon/test/plugin-mcp-credentials.test.ts --maxWorkers=2
pnpm exec vitest run packages/storage/test/skill-context.test.ts --maxWorkers=2
```

### 浏览器、向量与产物

```sh
pnpm exec playwright test tests/e2e/plugin-connection.spec.ts tests/e2e/skills-plugins.spec.ts tests/e2e/mcp-expansion.spec.ts tests/e2e/remote-mcp-configuration.spec.ts --grep-invert '跨重启'
pnpm exec playwright test tests/e2e/plugin-connection.spec.ts -g '跨重启' --output=output/playwright/plugin-parity-final-20261027
pnpm test:artifact
```

第一条实际匹配3个文件、12项全部通过，包含GitHub/Google授权、失败、关窗、弹窗拦截、缺Client提示、桌面ticket、独立MCP及主/子组件导航；没有匹配到的`remote-mcp-configuration.spec.ts`不计覆盖。最终构建后完整链路1项再次通过（7.7秒）：授权GitHub→开启App→目录ready→同profile重启daemon→保留授权和目录→未选择MCP工具的普通提问→中文tool_search自动加载→下一请求get_me→实际SDK结果和JSONL。模型请求与日志均未含合成Token。GitHub/Google供应商由隔离上游替代，MCP使用真实官方Server/Client及HTTP，没有用页面假目录代替。实际查看明暗插件详情与最终链路截图，未见布局阻断。

`pnpm test:artifact`最终2文件6项通过，验证构建CLI/IPC、恢复及退出。临时`pnpm --filter @my-pi-harness/daemon deploy --prod --legacy <temp>/daemon`实际通过，从部署cwd经package exports读取全部9个隐藏App声明及9个目标；实际import Transformers并解析ONNX，假模型在部署后的独占Worker输出384维后关闭。临时部署目录已清理，没有运行真实Electron或签名安装包。

本地语义适配另实际下载固定E5提交并在CPU/q8推理，不是随机向量或占位：中文GitHub账号查询与英文get_me说明得到384维向量，余弦0.895，高于无关音频说明的0.786；首次下载加推理25.036秒。该样例证明真实引擎接通，不作为大规模检索质量或两项目速度一致的证据。首次Worker继承`--input-type`导致启动失败，已改为显式空execArgv后复测通过；冷模型加载超过18秒时生产搜索可先使用词法结果。

### 最终检查与边界

最终`pnpm typecheck`、`pnpm build`、`pnpm lint`和`pnpm format:check`通过；构建保留既有Electron renderer与Web大chunk提示。最后历史SQL根类型拒绝和Skill提示文案调整另跑定向源码、storage构建与格式/静态检查通过：历史查询4项、插件同步/预览/资源目录3文件20项；文档170文件和源码规范792文件通过，diff空白检查通过，不重复整套已通过测试。

用户已确认真实GitHub OAuth成功；本轮没有读取真实仓库、测试Google同意与API、执行真实Electron安装或Windows验收。真实账号的仓库权限及外部MCP可用性仍需在用户重启后的环境复验；合成端到端不能证明供应商权限、配额或账号策略。工程范围补齐不等于整个M4平台验收结束，M5仍未开始。

## 未提交改动冗余审查（2026-10-27）

审查覆盖当前Git工作区的已跟踪改动及新增源码、测试、协议、资源与文档，按实际生产/动态入口和测试消费者判断。仍属M4收尾；没有提交、推送、读取真实秘密或操作用户服务。

实际清理：

- 人工插件资源同步已被启动`synchronize`替代，删除旧`/plugins/:id/sync`、服务方法和重复人工同步测试；安装的`pending`集合已被统一管理锁覆盖，删除。
- 删除旧账户桥接方案遗留且零消费者的`ConnectionService.assertBindable`。插件授权不改变高级账户或插件安装记录，删除对应两次无效Query刷新；高级手动账户链及独立MCP授权继续保留。
- 删除无调用的同步`refreshPluginApp`和废弃`plugin-refreshes.ts`壳文件；合并重复目录失效、重复诊断计算及身份类型/配置类型转导出。保留提前取消、后续权限重验、LocalPreflights和CatalogCache各自所有权。
- 插件详情/安装复用既有请求取消工具，显式保留原无定时器语义，其他调用继续30秒；三段Skill绑定JSON/schema解码合并，删除重复工具可见Set、Map互斥后的去重和等价schema遍历分支。
- 删除Office零消费者schema、拆分到`modify_pdf`后留下的旧导入及未使用常量；固定页与flow模式仍均有真实消费者。MiniSearch与本地向量引擎均在产品路径中，保留。
- 高级账户中的MCP地址及App名称与插件声明重复，统一从`.app.json`派生，保留现有公开字段和手动MCP识别。Spec移除已被独立插件OAuth取代的账户桥接设计和重复完成清单，实际历史验证保留其原范围。
- 修正测试残留：schema迁移断言7更新为实际8，使用Vitest当前`toThrow`替代弃用别名。

实际验证分组有重叠，不累加为唯一用例总数：OAuth/插件5文件42项（分轮）、MCP8文件56项、Runtime/Office7文件64项、地址派生及高级/手动MCP4文件40项均有通过结果；根另跑`pnpm exec vitest run packages/storage/test/auth.test.ts packages/storage/test/skill-context.test.ts --maxWorkers=2`，2文件17项通过。类型与取消/失效回归分别由所属测试覆盖。

`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm build`及`git diff --check`通过；最后providers派生调整另有integrations类型检查与ESLint通过。构建保留既有大chunk与独立renderer提示，没有执行签名或真实Electron安装。

```sh
pnpm exec playwright test tests/e2e/plugin-connection.spec.ts tests/e2e/connection-oauth-launch.spec.ts tests/e2e/skills-plugins.spec.ts --output=output/playwright/plugin-cleanup-20261027
```

3文件18项通过（45.4秒），使用真实构建的Web/daemon、临时profile和合成上游：覆盖插件/高级账户两套授权、失败/取消/关窗/弹窗拦截、单Skill与主开关，以及GitHub授权→启用App→重启→普通中文tool_search自动加载→SDK get_me及JSONL。没有以删除旧入口删掉现有功能；真实外部账号和平台验收仍沿用上节边界。
