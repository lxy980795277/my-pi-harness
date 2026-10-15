# My Pi Harness

本地优先的 PC Agent 应用。Electron 管理桌面窗口与独立 Node daemon，React Web 负责呈现；Agent 内核使用 Pi core，模型调用使用 Pi ai。

## 工作入口

- 首次进入先读 [项目概览](docs/00_OVERVIEW/overview.md)、[架构](docs/01_ARCHITECTURE/overview.md) 和 [约束入口](docs/05_CONSTRAINTS/overview.md)。
- 编码前按 [七步工作流](docs/00_OVERVIEW/workflow.md) 建立或更新功能 Spec；已经确认的需求和设计在授权范围内连续执行，不重复请求确认。
- 建立Spec、拆分任务及建议下一步前，对照 [roadmap](docs/00_OVERVIEW/roadmap.md) 标明所属里程碑与未完成项；子步骤沿用原里程碑，范围变化先更新Spec与roadmap。
- 功能文档使用北京时间 `YYYYMMDDHHmm_category_name/` 目录和 [Spec / UseCase / Tasks / Issues](docs/04_FEATURES/overview.md)；历史分钟的排序估计不作为真实开始时间，验证结束后才生成 `verify.md`。
- 本仓库独立实现。不得复制或引用其他项目的业务代码、内部提示词、历史功能文档作为本仓库实现；允许采用公开依赖和已确认的工程范式。

## 实现边界

- 目录、依赖方向、源码与发布产物以 [架构](docs/01_ARCHITECTURE/overview.md) 为准。业务代码只放 `apps/` 或有明确职责的 `packages/`。
- Renderer 不访问 Node、凭据、数据库、daemon 源码或 Pi 内部对象；preload 只提供 [协议](docs/03_API/overview.md) 中声明的有限桌面能力。
- HTTP、IPC、模型工具参数、配置、文件和持久化数据在进入业务层前校验；同进程已声明类型的值不重复做无依据的运行时防御。
- 本地副作用必须经过统一策略、真实路径检查与取消/超时管理。安全规则见 [安全约束](docs/05_CONSTRAINTS/backend.md)。
- 临时运行状态可保存在内存；持久事实和派生索引按 [存储约束](docs/05_CONSTRAINTS/backend.md) 管理。
- 当前实现模型、授权、SQLite会话与公开JSONL镜像、队列/分支、M2工作区与三种审批策略，以及M3规则/附件上下文、预算/压缩、人工提问、计划任务和会话检查点；检查点不回滚磁盘或外部副作用。Computer Use属于后续里程碑。后续范围见[里程碑](docs/00_OVERVIEW/roadmap.md)。

## 质量与交付

- TypeScript 使用 strict；包间用 `@my-pi-harness/*`。Web 模块无后缀，NodeNext 宿主相对导入保留 `.js`；类型与外部校验见对应规范。
- 前端、daemon、Electron和测试分别遵守 [前端](docs/05_CONSTRAINTS/frontend.md)、[后端](docs/05_CONSTRAINTS/backend.md)、[桌面](docs/05_CONSTRAINTS/desktop.md)、[测试](docs/05_CONSTRAINTS/testing.md)；交付证据与硬规则检查统一见测试规范。
- 变更同步更新实际受影响的架构、协议、约束或功能文档；一个事实保留一个权威位置，其他文档链接引用。
- 只报告实际运行的检查、实际观察到的结果及未验证项。局部检查与 CI 分工见测试约束。
- 不擅自提交、推送、创建分支、重写历史或处理无关改动。用户明确要求提交时才执行 [八步提交流程](docs/08_COLLABORATION/commit.md)。
- 产品版本唯一来源为根 `package.json`；发布记录与桌面产物版本按 [发布规范](docs/06_RELEASES/overview.md) 同步。
- 参考范式的逐目录采用与取舍见 [范式映射](docs/09_TECHNICAL/development-paradigm.md)，不将参考项目的远端部署或历史业务规则直接套用本仓库。
