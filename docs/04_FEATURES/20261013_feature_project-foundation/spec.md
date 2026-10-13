# M0工程底座

## Spec

状态：工程实现与macOS arm64本机验证完成；Windows验证待执行，跨平台验收尚未全部关闭。证据见 [verify.md](verify.md)。本次授权覆盖M0连续实施、相关检查及文档同步，不包含commit、push或分支改写。

### Intent

建立独立的my-pi-harness Monorepo、AI Coding范式和真实桌面/浏览器启动链，为第一阶段完整功能对齐提供可检查、可运行、可发布的基础。M0是工程里程碑，不宣称Agent产品已经完成。

### Constraints

- 架构与选型遵循 [架构](../../01_ARCHITECTURE/overview.md)；业务实现独立，不复制其他项目代码、提示词或历史文档。
- 范围是Web、daemon、desktop、protocol、共享工程配置、文档、静态检查、测试入口和桌面打包链。
- 不创建agent-runtime空壳、业务数据库、Agent假会话或Computer Use；后续职责按 [里程碑](../../00_OVERVIEW/roadmap.md) 创建。
- Renderer与Node隔离，服务仅回环监听；桌面启动拥有的daemon可追踪并可回收。
- 开发检查使用源码，发布运行使用真实构建产物；产品版本单一来源且打包时同步。
- 自动化、运行观察、人工体验和目标机器安装证据分别记录，未验证项不能写成通过。

### Acceptance Criteria

| ID    | 可验收条件                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------ |
| AC-01 | pnpm workspace与Turbo识别实际apps/packages，内部依赖使用workspace:\*；有明确TypeScript、ESLint与Prettier配置 |
| AC-02 | 清晰的AGENTS入口、00–10文档导航、七步流程、Spec格式、提交和发布规范存在，内部文档链接有效                    |
| AC-03 | Web与独立daemon开发启动，页面通过同源代理校验并显示真实health与runtime.ready状态                             |
| AC-04 | daemon配置拒绝非法值，只监听回环；SSE首条身份、心跳与连接/服务关闭资源清理正确                               |
| AC-05 | Electron开发自动启动独立daemon，校验启动信息并显示同一Web，关闭窗口/启动失败能收束其拥有的服务               |
| AC-06 | Renderer不访问Node；preload仅暴露已声明桥；main拒绝不受信任来源；边界检查覆盖禁止导入                        |
| AC-07 | 源码lint/typecheck/test不依赖旧dist；构建后daemon用Node解析真实protocol exports并托管Web                     |
| AC-08 | 产品版本由根package.json生成并检查，桌面打包版本和公开协议应用版本一致；内部包不独立发布                     |
| AC-09 | 有覆盖M0实际行为的Vitest和Playwright检查、CI与桌面smoke入口；记录实际执行结果，不以脚本存在冒充通过          |
| AC-10 | 桌面资源装配独立Node、daemonJS/生产依赖和Web；平台打包及启动验证结果注明具体平台与限制                       |

## UseCase

| UC                   | 前置条件与步骤                                      | 预期结果                                            | 异常路径                                             |
| -------------------- | --------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| UC-01 浏览器连接     | 准备依赖，运行pnpm dev，打开Web                     | 显示健康版本和runtime.ready连接，身份来自同一daemon | daemon不可达显示失败/重连状态，不展示假成功          |
| UC-02 独立服务       | 运行dev:daemon；读取health并建立SSE；关闭连接和服务 | 数据符合schema；连接资源被清理                      | 非法端口/资源目录明确失败；监听失败不继续宣称ready   |
| UC-03 桌面开发       | 运行dev:desktop，观察页面与桥信息，再关闭应用       | 独立daemon启动；受信任Web加载；子服务退出           | 错误启动记录/超时/服务异常有明确失败，相关进程被收束 |
| UC-04 静态与行为检查 | 执行当前改动对应检查与M0自动化用例                  | 原始证据覆盖AC，源码检查不借用旧产物                | 非法输入、错误事件或禁止依赖被实际检查拒绝           |
| UC-05 构建与资源启动 | build后运行产物smoke；准备桌面资源并按平台打包      | 不依赖tsx、Vite或根src，应用与协议版本一致          | 缺失Node/Web/daemon资源或版本不一致明确失败          |
| UC-06 文档交付       | 核对导航、Spec任务、发布/协作和未验证项             | 事实单一来源；无死链；完成验证后才产生verify        | 没有运行或人工观察的路径保留Not verified             |

## Tasks

- [x] 创建实际workspace和工程配置，统一命名、依赖与版本生成（AC-01/08）。
- [x] 建立协议schema和daemon配置、health、SSE及退出清理（AC-03/04）。
- [x] 建立Web真实连接页面、校验和异常状态（AC-03）。
- [x] 建立Electron main/preload、独立Node服务生命周期与来源检查（AC-05/06）。
- [x] 实现源码依赖检查、构建输出和生产资源装配（AC-06/07/10）。
- [x] 添加M0行为、异常路径、浏览器E2E、CI和桌面smoke入口（AC-09）。
- [x] 写入项目文档、约束、功能Spec与发布/协作规范（AC-02）。
- [x] 执行源码、浏览器、CLI、macOS开发与应用目录检查，修复已核实问题（AC-01–10，本机证据）。
- [x] 验证结束后创建verify.md，记录自动、运行观察及未验证结果（UC-06）。
- [ ] 执行Windows CI与目标平台应用目录启动检查，补齐跨平台证据（AC-09/10）。

## Issues

以下问题已在本次实现中解决；未验证平台不以这些本机结果代替。生产资源装配还会删除legacy deploy遗留的daemon自引用；smoke拒绝损坏链接及解析到应用资源外的链接。

| 问题                             | 根因与修复                                                                                                                   | 预防证据                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 安装peer冲突与编译配置差异       | electron-vite与Vite、ESLint插件、typescript-eslint各有版本范围；依据实际peer声明固定兼容catalog，并显式配置Electron构建entry | 严格peer安装、typecheck及build通过，不关闭检查                   |
| 桌面冷启动抢跑Web                | main仅等daemon.ready，没有等Vite；开发加载前增加有界HTTP就绪等待                                                             | 先启动Electron/daemon再启动Vite，页面进入ready且退出收束         |
| 应用目录缺少生产依赖             | electron-builder默认过滤FileSet根下node_modules；为部署依赖建立单独extraResources FileSet                                    | 随包Node在临时cwd加载真正daemon/protocol依赖，packaged smoke通过 |
| 工具宿主强制Electron进入Node模式 | 继承ELECTRON_RUN_AS_NODE=1，Electron拒绝浏览器调试参数；开发聚合与smoke启动环境移除该变量                                    | 开发与packaged启动通过                                           |
| 缓存并发和中断留下不完整安装     | 共享archive与直接解压目录没有完整发布标记；改为私有目录完成后原子发布manifest                                                | 9项缓存/并发fixture与实际官方Node准备通过                        |
| 相对导入绕过workspace规则        | 检查只覆盖跨app；补齐app/package所有者判断                                                                                   | 43项真实AST fixture拒绝/允许验证通过                             |
| IPC退出测试等待错误事件          | 进程exit0，但诊断stdio尚未close；退出证据改为exit，并显式清理诊断pipes                                                       | built CLI合法shutdown、owner disconnect两项通过                  |
