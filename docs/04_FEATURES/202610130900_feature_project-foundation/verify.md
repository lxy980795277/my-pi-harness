# M0验证记录

日期：2026-10-13。应用版本：0.1.0；协议版本：1。环境：macOS 26.5.1（Darwin 25.5）、arm64，Node 24.20.0、pnpm 10.33.2、Electron 44.7.0、Playwright Chromium。源码实现与本机验证通过；Windows及远程CI是Not verified，跨平台验收尚未全部关闭。没有commit或push。

## 自动检查

所有命令从仓库根执行；检查进程使用Node 24.20.0。最终行为证据如下：

| 实际命令                                          | 结果 | 证明范围                                                                                              |
| ------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------- |
| `pnpm install` / `pnpm install --frozen-lockfile` | Pass | 严格peer安装、workspace依赖与lockfile一致性                                                           |
| `pnpm check`                                      | Pass | Prettier、ESLint、37个源码文件的依赖检查、文档与版本校验、全部TS程序；5个源码测试文件71项通过         |
| `pnpm build`                                      | Pass | protocol、daemon、Electron main/preload、Web真实产物                                                  |
| `pnpm test:artifact`                              | Pass | 2项built CLI测试：ready、非法IPC保活、health/SSE、合法shutdown、owner disconnect、自然exit0与资源清理 |
| `pnpm test:e2e`                                   | Pass | 5项Chromium场景：真实连接/主题保存、退出后失败、health版本拒绝、SSE身份拒绝、服务恢复手动重连         |
| `pnpm test:e2e --grep '真实健康与事件连接'`       | Pass | 截图关闭过渡动画后，连接与主题场景再次通过                                                            |
| `node scripts/node-runtime.mjs --ensure`          | Pass | 官方Node下载SHA-256校验、完整缓存manifest发布与复用                                                   |
| `pnpm package:desktop`                            | Pass | 本机应用目录含独立Node、daemon生产依赖、Web与应用代码                                                 |
| `pnpm --filter @my-pi-harness/desktop package`    | Pass | macOS identity:null明确关闭签名，重新装配同一应用目录                                                 |
| `pnpm smoke:desktop`                              | Pass | 资源链接完整且留在安装资源内；真实.app版本、有限桥、Node隔离、来源拒绝、daemon PID消失与端口连接拒绝  |

源码检查曾在移走四个dist与Turbo缓存后运行：全部TS任务实际执行，64项当时已存在的源码测试通过。之后新增7项相对workspace导入用例，最终源码套件为71项。源码检查未使用旧产物；CLI、浏览器和应用目录检查分别使用真实构建产物。

71项源码测试包括daemon配置/HTTP/SSE（15）、依赖规则（43）、Node缓存（9）、desktop监督器真实子进程（4）。监督器异常用例证明非法/超大ready、ready前退出、重复stop的清理；CLI退出测试观察process exit，不把stdio close或超时当作自然退出。

## 运行与视觉观察

| 场景                   | 结果 | 观察                                                                                                                                         |
| ---------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev` +真实浏览器 | Pass | 5174代理health 200、同实例SSE ready；浅色切深色、刷新保留；捕获真实HMR后仍ready；CSP违规为空、最终console无错误/警告                         |
| Electron开发冷启动     | Pass | 临时检查脚本直接启动构建后的Electron入口及源码Node daemon，确认4311就绪后才启动Vite；main等待Web，页面ready、getInfo有效；关闭后4311连接拒绝 |
| packaged应用目录       | Pass | 从临时cwd启动，设置不可用开发Node/页面覆盖项，仍从安装资源启动Node 24.20.0与Web；主窗口桥有效，额外窗口同源调用也被main拒绝                  |
| 页面截图核对           | Pass | 浏览器浅色/深色、Electron页面布局与真实连接信息可读；未观察到溢出或缺失内容                                                                  |

浏览器截图在`test-results/`，桌面截图在`output/playwright/desktop.png`及`desktop-dev.png`，均为忽略的本机产物。运行观察由开发工具完成；用户本人尚未进行体验验收。

## UC与AC

| 项目               | 结果                                      | 证据                                                                          |
| ------------------ | ----------------------------------------- | ----------------------------------------------------------------------------- |
| UC-01/02、AC-03/04 | Pass（本机）                              | 真实dev代理、15项daemon测试与2项built CLI测试                                 |
| UC-03、AC-05       | Pass（本机）                              | Electron冷启动观察、4项监督器测试及packaged退出                               |
| AC-06              | Pass（本机）                              | 43项依赖用例、真实Renderer无require/process、有限getInfo桥和非授权窗口拒绝    |
| UC-04、AC-01/07/08 | Pass                                      | 源码独立检查、严格依赖安装、真实exports运行、版本生成与桌面/daemon/桥版本一致 |
| UC-06、AC-02       | Pass                                      | AGENTS、十一类文档、Spec/verify、协作与发布规则、本地链接检查                 |
| AC-09              | Pass（本机）；CI Not verified             | 本机自动用例已执行，macOS/Windows工作流已配置但未触发                         |
| UC-05、AC-10       | Pass（macOS arm64）；Windows Not verified | 独立资源的.app已启动验证；其他平台证据待补                                    |

## Not verified

- Windows原生CI、应用目录启动与系统进程清理；macOS远程CI，以及macOS x64/Linux目标机器。
- 独立目标机器安装、正式DMG/NSIS安装器、签名、公证、升级与自动更新；当前产物是未签名应用目录。
- 用户手动体验验收。
- Agent、Provider真实调用、SQLite、工具/审批/OS沙箱与Computer Use，均不属于M0实现范围。

已核实实现问题及解决方法见 [Spec Issues](spec.md#issues)。
