# 项目概览

My Pi Harness 是独立开发的本地优先 PC Agent 应用。用户在浏览器或 Electron 桌面窗口中与 Agent 对话，本机 daemon 负责模型调用、执行编排、本地工具、授权与持久化。

第一阶段按已确定的功能清单完成对齐，按里程碑逐步交付，不以早期可用版本替代第一阶段完成标准。Computer Use 排除在当前版本之外，保留为后续专项；第二阶段开展自己的产品迭代。

本仓库只沿用已经确认的开发范式和公开技术依赖，不复制参考项目的业务实现、提示词或历史文档。功能覆盖、当前状态与后续顺序统一见 [里程碑](roadmap.md)。

## 文档地图

编号 `00` 至 `10` 共十一类文档。入口只链接已经存在的文件；未落地模块不预建空文档或空 package。

| 目录                                                | 权威内容                               | 阅读时机           |
| --------------------------------------------------- | -------------------------------------- | ------------------ |
| [00_OVERVIEW](workflow.md)                          | 项目定位、里程碑、七步工作流           | 首次进入与接任务   |
| [01_ARCHITECTURE](../01_ARCHITECTURE/overview.md)   | 技术栈、模块职责、进程和产物           | 设计或架构变更     |
| [02_DESIGN](../02_DESIGN/overview.md)               | UI、状态呈现与交互规范                 | 界面与交互变更     |
| [03_API](../03_API/overview.md)                     | HTTP、SSE、桌面桥与共享协议            | 协议变更           |
| [04_FEATURES](../04_FEATURES/overview.md)           | Spec、UseCase、Tasks、Issues、验证证据 | 需求到交付         |
| [05_CONSTRAINTS](../05_CONSTRAINTS/overview.md)     | 前端、后端、Desktop 与 Testing 规范    | 编码与审查         |
| [06_RELEASES](../06_RELEASES/overview.md)           | 产品版本与发布记录                     | 提交与发布         |
| [07_USER_GUIDE](../07_USER_GUIDE/overview.md)       | 用户操作与启动指南                     | 使用与体验验证     |
| [08_COLLABORATION](../08_COLLABORATION/overview.md) | 提交、分支与协作                       | 用户要求提交或协作 |
| [09_TECHNICAL](../09_TECHNICAL/技术文档总览.md)     | 核心技术设计、关键机制与取舍           | 理解核心流程与维护 |
| [10_GOVERNANCE](../10_GOVERNANCE/overview.md)       | 定期代码与文档治理                     | 专项审查           |

`AGENTS.md` 是简短入口；具体约定由以上文档负责。用户当前指令优先于仓库默认约定，已接受的范围调整应同步到对应 Spec。
