# AI Coding范式映射

本仓库参考 `/Users/liuxinyu/Desktop/projects/kola/magic-book` 的AGENTS与docs组织开发流程，逐项采用适用规则并按本地PC架构调整。参考源是工程范式，不是源码依赖；没有复制其业务代码、内部提示词、历史功能Spec或产品专属设计。

本页记录采用与取舍，实际规范在对应权威文档维护，避免两处定义同一规则。源文件名使用代码文本，不建立对参考仓库的运行依赖或死链。

## 目录00至10

| Magic Book参考位置                                             | 本仓库权威位置                                                                                                              | 采用与调整                                                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                    | [AGENTS](../../AGENTS.md)                                                                                                   | 保留首次阅读、按任务读规范与文档同步；简短入口，不复制got it口号、全量技术摘要和历史路径禁令         |
| `00_OVERVIEW/overview.md`、`workflow.md`                       | [概览](../00_OVERVIEW/overview.md)、[七步流程](../00_OVERVIEW/workflow.md)                                                  | 保留文档地图与七步交付顺序；已确认范围连续执行，提交需用户明确指令                                   |
| `01_ARCHITECTURE/overview.md`及架构叶文档                      | [架构](../01_ARCHITECTURE/overview.md)                                                                                      | 保留技术栈、模块与数据流；改为Web/main/preload/独立Node，源码与产物分开                              |
| `02_DESIGN/overview.md`、`design.md`、`component.md`           | [设计](../02_DESIGN/overview.md)、[设计语言](../02_DESIGN/design-language.md)                                               | 保留克制、语义token、组件统一和状态；不复制旧产品字号、字体、业务组件和Tiptap专项                    |
| `03_API/overview.md`及接口叶文档                               | [API](../03_API/overview.md)                                                                                                | 保留接口语义与共享DTO；使用TypeBox、SSE、有限桌面IPC，不复制统一traceId包装或禁204                   |
| `04_FEATURES/overview.md`、功能目录结构                        | [功能文档](../04_FEATURES/overview.md)                                                                                      | 沿用Spec / UseCase / Tasks / Issues，实际验证后生成verify；不迁移历史功能                            |
| `05_CONSTRAINTS/overview.md`、`forbidden.md`                   | [约束](../05_CONSTRAINTS/overview.md)、[禁止事项](../05_CONSTRAINTS/forbidden.md)                                           | 保留复用、命名、类型和交付红线；明确外部校验与同进程类型，不复制绝对禁止Map或typeof                  |
| `05_CONSTRAINTS/frontend.md`及React/Zustand规则                | [前端](../05_CONSTRAINTS/frontend.md)                                                                                       | 按用户明确要求沿用React、Zustand、样式和组件细则；移除Next/SSR与旧编辑器业务，生成shadcn保留官方惯例 |
| `05_CONSTRAINTS/backend.md`、`database.md`、`testing.md`       | [后端](../05_CONSTRAINTS/backend.md)、[存储](../05_CONSTRAINTS/storage.md)、[测试](../05_CONSTRAINTS/testing.md)            | 分层、事务、日志和Mock思想保留；框架、数据库与验证方式按下表调整                                     |
| `06_RELEASES/overview.md`与Release Note                        | [发布](../06_RELEASES/overview.md)                                                                                          | 保留版本与新增/改进/修复记录；产品根版本同步桌面和protocol，内部包不独立升版                         |
| `07_USER_GUIDE/overview.md`                                    | [使用指南](../07_USER_GUIDE/overview.md)                                                                                    | 保留用户视角，只描述实际已实现操作                                                                   |
| `08_COLLABORATION/commit.md`、`collaboration.md`、`pruning.md` | [提交](../08_COLLABORATION/commit.md)、[协作](../08_COLLABORATION/collaboration.md)、[裁剪](../08_COLLABORATION/pruning.md) | 保留八步、精确暂存、Review与裁剪；不自动commit/push或创建分支，不擅自删除用户数据                    |
| `09_TECHNICAL/overview.md`、`decisions.md`、`lessons.md`       | [技术记录](overview.md)、[决策](decisions.md)、[问题](lessons.md)                                                           | 保留决定/原因/变更条件和复现/根因/预防，不搬旧产品技术方案                                           |
| `10_GOVERNANCE/web.md`、`server.md`、`dead-code.md`            | [治理](../10_GOVERNANCE/overview.md)及对应检查文档                                                                          | 保留按模块扫描、严重度与证据格式；新增桌面进程审查，移除旧目录ignore与框架专项                       |

## 关键规则的取舍

| 源范式                                            | 本仓库处理                                     | 原因                                                  |
| ------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| 确认需求、设计与体验后推进                        | 保留结论检查点，已明确授权不重复询问           | 用户要求连续完成已确认范围，功能变化再对齐            |
| Next App Router、use client、SSR/dynamic          | 不采用                                         | Vite Renderer与浏览器共用，不运行Next服务             |
| React具名FC、选择器、完整函数体和条件渲染         | 采用适用细则                                   | 用户明确认可该前端规范，工程配置需落实实际规则        |
| Nest Controller/Service、class-validator、Swagger | 调整为route/service/domain/repository与TypeBox | Fastify按schema运行，不能复制装饰器结构               |
| 多实例禁止Map/Set，强制Redis                      | 不采用该部署政策                               | 临时连接、Agent和锁是单机进程状态，持久事实才进SQLite |
| 统一throw Error字符串、禁止领域ErrorCode          | 不采用                                         | 跨进程用户状态需要区分取消、冲突、策略拒绝和未知结果  |
| 禁204并强制traceId包装                            | 不采用                                         | 遵守HTTP语义，关联ID按协议实际定义                    |
| Prisma/MySQL、t\_前缀、UUIDv7和全表审计字段       | 不移植固定方案                                 | better-sqlite3/Drizzle与事件领域有自己的schema需求    |
| AI只输出DDL，不运行迁移                           | 改为随应用发布与执行的SQLite迁移               | 本机用户安装升级不能依赖人工DDL；已发布迁移仍冻结     |
| 共享类型仅源码/特定alias和禁止共享常量            | 改为浏览器安全protocol的真实exports            | 同一公开DTO/schema和常量可以共享，生产Node需要dist    |
| 全面禁止可选链、typeof和instanceof                | 按输入职责调整                                 | 外部unknown需要校验，同进程值避免冗余防御             |
| 单测全部mock外部边界                              | 单测mock不可控依赖，集成用真实本机边界         | 进程退出、SSE、SQLite和打包不能仅凭替身证明           |
| 旧覆盖率百分比与每次任务全量单测                  | 不复制数字，按风险选择检查                     | 本仓库未设置覆盖率gate，CI负责keyless全量与平台矩阵   |
| 500/1000行治理、清理注释实现                      | 500行review、1000行自动gate与显式生成例外      | 防止职责堆积，行数不能代替职责判断                    |
| 超3个月未用或兼容分支多就删除                     | 调整为证据、数据保留与授权判断                 | 不能仅凭静态未引用或时间删除兼容入口和用户数据        |
| 指定master、自动拉取或开始分支                    | 不采用默认副作用                               | 分支、提交和历史操作由用户指令与实际状态决定          |

## PC专项补充

Magic Book的远端Web服务规范不能覆盖桌面特权。新增 [Electron/PC](../05_CONSTRAINTS/desktop.md) 与 [安全](../05_CONSTRAINTS/security.md) 规定main/preload来源检查、权限、独立Node、生命周期、原生模块与资源装配；Computer Use仍属于后续专项。

Electron细则对照官方安全、IPC、session和生命周期文档；Fastify细则对照官方schema/hooks/logger；Node和SQLite细则对照其进程、权限、事务及备份文档，来源链接放在实际规则附近。依赖版本事实由单独版本记录拥有，不在本页重复固定版本号。
