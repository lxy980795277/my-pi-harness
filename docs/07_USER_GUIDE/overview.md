# 使用指南

当前提供模型设置、持久会话、队列与历史分支、工作区与审批工具，以及M3附件、项目规则、上下文压缩、提问、计划和检查点。操作见[模型与会话](model-session.md)、[工作区与工具](workspace-execution.md)及[上下文、计划与检查点](context-interaction.md)。各平台与真实供应商状态见[里程碑](../00_OVERVIEW/roadmap.md)及所属功能验证记录；Windows Shell与浏览器新增目录仍保留原暂缓范围，Computer Use属于后续专项。

## 开发启动

准备Node24及根package.json声明的pnpm版本，安装依赖后按需要启动：

| 命令               | 用途                                |
| ------------------ | ----------------------------------- |
| `pnpm dev`         | 同时运行Web与独立daemon             |
| `pnpm dev:web`     | 单独运行Web开发页面，需要已有daemon |
| `pnpm dev:daemon`  | 单独运行本机服务                    |
| `pnpm dev:desktop` | Electron开发窗口及其拥有的daemon    |

默认地址、进程归属和环境变量见 [架构](../01_ARCHITECTURE/overview.md)。桌面开发启动自己的服务，不应依赖另一个不受其管理的长期daemon。

页面应能区分连接中、成功与失败。出现失败时查看对应终端的安全日志，检查端口和配置；不要把修改为外部监听或关闭安全检查作为排障步骤。

开发者执行M2定向验收时，先运行`pnpm build`，再运行`pnpm test:m2`；该入口覆盖工作区/工具源码与真实浏览器链路，不自动重新构建，也不代表Windows或真实供应商验收。其他检查见[Testing规范](../05_CONSTRAINTS/testing.md)。

## 产物运行

当前构建、资源装配与应用目录打包入口见 [测试入口](../05_CONSTRAINTS/testing.md)。应用目录携带自身运行资源，不依赖本仓库源码、Vite或tsx；正式安装器及签名发布在后续平台发布步骤实现。

当前模型、会话、工具与M3交互见上述指南。插件操作在所属里程碑落地后新增。
