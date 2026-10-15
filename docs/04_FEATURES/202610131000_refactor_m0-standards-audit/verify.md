# M0规范与架构审计验证

日期：2026-10-13；产品版本：0.1.0。本记录覆盖本轮规范、依赖与M0修正，前次M0验证保留其历史环境与结果。

## 环境与范围

macOS26.5.1 / Darwin25.5.0 / arm64，Node24.20.0，pnpm10.34.6，Electron43.7.9，Vitest4.1.11，Playwright1.63.0及匹配的Chromium1243。所有检查在本仓库执行，未修改参考项目、commit或push。

审查范围为apps/web、daemon、desktop，protocol、共享ESLint/TS配置，开发/缓存/资源/版本/静态检查脚本，测试与CI，以及AGENTS和docs00–10。没有新增Agent、工具、SQLite、Zustand示例Store或Computer Use。

## UseCase结果

| UC               | 结果         | 证据                                                                                                      |
| ---------------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| UC-01 依赖选型   | Pass         | 全部37项catalog、Node/pnpm与CI actions有官方来源；严格peer安装和frozen lockfile通过，选择依据见版本审计   |
| UC-02 按规范开发 | Pass         | React/Zustand细则、Electron/后端/TS/安全/存储/测试规范及docs00–10范式映射完成，AGENTS和导航指向实际所有者 |
| UC-03 静态拒绝   | Pass         | 实际ESLint parser与配置正反例、全源码配置覆盖、Oxlint真实CLI正反例、磁盘依赖与源码约定fixture通过         |
| UC-04 生命周期   | Pass（本机） | 取消、重复退出、其他窗口/frame、导航/权限/参数、PID、HEAD、背压、半HTTP headers、真实子进程树回归通过     |
| UC-05 交付验证   | Pass（本机） | 源码独立检查、构建、CLI、浏览器、应用目录smoke及开发入口启停通过；平台和发布缺口如下                      |

## 执行结果

| 命令/操作                               | 实际结果                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                          | 严格peer解析成功，未关闭strict-peer-dependencies                                                                       |
| `pnpm install --frozen-lockfile`        | lockfile一致，pnpm10.34.6成功                                                                                          |
| `pnpm check`                            | format、lint、typecheck通过；Vitest16文件、257通过、1个Windows专用测试跳过                                             |
| 源码独立检查条件                        | 暂时移走四个workspace的dist及根Turbo缓存后执行上行检查；四个typecheck任务均cache miss实际运行；finally恢复原产物与缓存 |
| `pnpm build`                            | protocol、daemon、web、desktop四个构建任务成功                                                                         |
| `pnpm test:artifact`                    | 构建后的daemon CLI/IPC/退出3项通过                                                                                     |
| `pnpm exec playwright install chromium` | 安装Playwright1.63对应的Chromium与headless shell1243成功                                                               |
| `pnpm test:e2e`                         | 真实浏览器5项通过：健康/SSE、主题、退出与重连、协议拒绝、实例不一致拒绝、服务恢复                                      |
| `pnpm package:desktop`                  | Electron43.7.9的macOS arm64未签名.app应用目录成功                                                                      |
| `pnpm smoke:desktop`                    | 临时cwd启动、随包Node版本、资源链接不逃逸、健康/SSE、有限桥、隔离、其他窗口拒绝、daemon实际退出及端口拒绝通过          |
| `pnpm dev`及Ctrl+C                      | Web同源health和页面就绪；退出状态0，5174/4311均ECONNREFUSED，所属daemon PID返回ESRCH                                   |
| `pnpm audit --prod --json`              | 零漏洞报告；该结论限当日npm公告检查，不代表全面安全证明                                                                |
| `pnpm audit --json`                     | 非零：构建依赖链有1条中危公告，未隐藏或伪装通过，详见下文                                                              |
| CI action核验                           | 三个正式版本、完整commit SHA与官方node24 manifest核对；未触发远端CI                                                    |

最终源码门禁覆盖75个非生成源文件的约定、55个app/package源文件的依赖边界；ESLint配置覆盖测试另检查包括配置、工具和测试在内的全部实际JS/TS文件。源码门禁的显式生成豁免为protocol版本文件，ESLint仍检查该文件；业务目录没有整片豁免。

真实开发watcher在SIGTERM退出期间打印tsx强制结束及Vite transform终止日志；本轮确认了退出状态、监听关闭和所属daemon PID消失，不把该开发关闭日志当作发布版正常IPC退出的证据。

## 修正与模块判断

提交前再次复核实际依赖解析，发现自动peer使用Vite8.3.4和ESLint10.12.0。显式提供catalog peer后，root/daemon的Vitest实际使用Vite7.3.7，root/eslint-config实际使用ESLint10.11.0，旧peer快照已移除。该修正后重新执行无dist/无Turbo缓存的 `pnpm check`：16文件、257通过、1个Windows专用测试跳过；四个类型任务均实际执行。新依赖图的 `pnpm build` 与 `pnpm test:artifact` 3项亦通过。Web与桌面应用实现没有改变，浏览器/桌面smoke沿用上表同日证据；首次源码检查的peer与最终提交peer不混为一份运行环境。

main按application、window、security、renderer和daemon supervisor划分，入口只引导生命周期；Web按页面组件、Hook、Query、领域Service和传输客户端划分；protocol只含实际共享的schema/DTO。当前M0模块职责与进程依赖合理，未创建未来能力的空包；接入Pi和存储后仍需按其Spec重新审查。

修复清单与复现归属见 [Spec Issues](spec.md)。静态规则验证具名FC、typed回调例外、箭头函数体、JSX条件/样式、Store选择器与稳定返回值、HTTP/SSE所有者、组件目录、命名、ESM扩展、导入顺序、helper聚合及文件上限。它们不证明完整数据流、别名、状态所有权和任意跨Store间接访问；这些继续由review与行为检查承担。

已查看真实桌面smoke截图 `output/playwright/desktop.png`：浅色主题、连接状态、服务信息和事件呈现无明显溢出或白屏。截图、依赖元数据、构建和测试输出保持忽略，不纳入源码交付。

## 已知限制

- 全依赖审计报告 `electron-builder > app-builder-lib > @electron/get > global-agent > roarr > sprintf-js@1.1.3` 的中危拒绝服务公告，当前没有修复版本；保留已验证的构建工具，发布前继续检查上游，不用不兼容override或忽略名单消除报告。[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
- Windows实机、Windows专用进程树回归和远端CI：Not verified。矩阵已配置；不能据macOS结果声称Windows通过。
- POSIX开发退出只覆盖继承所属进程组的后代；Windows开发工具等待taskkill和child退出，leader提前退出后的孤儿后代不能保证回收，未实现Job Object。后续Agent执行树保证由独立平台适配器拥有。
- 用户人工体验、正式安装器、签名、公证、自动更新、升级迁移与真实Provider：Not verified或未实现，不能从.app目录smoke推断支持。

本轮完成当前M0范围的审计与修正；第一阶段全功能交付仍按里程碑继续，不能把本记录当作Agent Runtime所有业务功能已经完成。
