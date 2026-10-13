# 编码约束

编码和审查按变更职责读取本目录。技术选型与依赖方向由架构负责，协议字段由API负责；这里记录可执行的实现约束。

| 文件                           | 适用范围                      |
| ------------------------------ | ----------------------------- |
| [typescript.md](typescript.md) | 类型、导入、错误和边界验证    |
| [forbidden.md](forbidden.md)   | 流程、质量、安全和发布红线    |
| [frontend.md](frontend.md)     | Renderer、组件与连接状态      |
| [backend.md](backend.md)       | daemon、模块与生命周期        |
| [desktop.md](desktop.md)       | Electron、IPC、平台进程与资源 |
| [security.md](security.md)     | 桌面桥、回环服务与本地副作用  |
| [storage.md](storage.md)       | 持久事实、迁移与会话记录      |
| [testing.md](testing.md)       | 自动化、人工证据和CI          |

先查已有所有者再新增类型、组件或工具；避免复制定义、空包和只为转发而加的抽象。注释说明非显然的行为、失败、时间或所有权，不复述代码或开发过程。

不保留废弃实现来遮蔽缺失功能；不将错误转换为假成功；不扩大任务范围去处理用户无关改动。

规范是交付要求，自动检查的实际覆盖见 [测试约束](testing.md)。新增硬规则要安排对应静态检查或行为验收；未配置的gate不能凭文档存在宣称通过。参考范式的采用与取舍见 [映射](../09_TECHNICAL/development-paradigm.md)。
