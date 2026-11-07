# 共享协议与模块数据归属整理

## Spec

### Roadmap Alignment

属于M0与既有M1–M5维护。M6继续仅规划；既有真实账号、Office视觉与平台验收缺口保持，不新增产品能力。

### Intent

按实际消费者重新审视protocol，只统一确有重复的跨端或宿主共享数据；将默认子Agent策略交还运行时，将Provider凭据引用限制在宿主内部。

### Constraints

- 用户授权实施并要求先复审，不机械集中所有类型；2026-11-08后续授权按0.19.0本地提交，不推送，不读取真实.env、凭据或会话数据。
- 公开protocol只保存跨端数据；默认Agent角色、提示和限制归agent-runtime，由daemon装配给storage，不建立storage到runtime的生产依赖。
- ProfileStoreOptions归profile模块；默认工厂只用于缺配置时读取，完整配置首次保存仅依赖数据库revision，不需要默认策略。
- Provider公开响应不暴露credentialRef，内部记录保持既有存储字段与布局；公开协议从24升为25，SQLite10与会话格式保持。
- 共享授权请求和响应保持各流程区别，不将不同OAuth结果合成大量可选字段；外部校验留在实际HTTP/IPC/持久化入口。
- ToolContent统一文本/图像数据定义，MCP处理、执行接口及工具参数仍归各自模块。
- initialWorkState、parseExternalUrl、真实公开事件、单模块接口和已有schema/type配对保持；不机械集中空请求、路由ID包装或IPC通道。

### Acceptance Criteria

- AC-1：重复的授权/模型操作请求、OAuth启动结果、Skill目录响应和API错误数据有唯一公开定义，并更新真实消费者。
- AC-2：公开Provider响应无credentialRef，宿主仍能选取凭据、读写配置，存储布局不变。
- AC-3：默认子Agent策略只由运行时拥有，首次读取与修订语义保持，存储通过显式注入获取默认配置。
- AC-4：工具文本/图像内容共享同一内部定义，不扩大Renderer可见内容或合并MCP特有结果语义。
- AC-5：删除确证无运行时消费者的已解析会话输入schema；保留合理的模块类型与纯共享工厂。
- AC-6：相关静态、类型、HTTP/存储/运行时回归和部署检查通过，实际文档同步，结束验证后生成verify。

## UseCase

- UC-1：登录、配对、模型密钥与授权操作继续通过对应请求校验；非法输入和非JSON错误响应有明确结果。
- UC-2：插件/高级账户/MCP分别启动授权，返回各自既有字段；Skill目录在Web与Desktop使用同一响应定义。
- UC-3：新增与更新Provider后公开列表只含界面所需状态，宿主仍使用内部凭据引用。
- UC-4：新profile读取默认Agent策略，修改后revision递增；未注入默认值的存储调用不能静默制造业务策略。
- UC-5：MCP内容经执行和持久化继续保留文本/图像及原有大小限制。

## Tasks

- [x] T0：复核实际消费者、合理保留项与本轮范围。
- [x] T1：统一公开HTTP请求/响应及错误数据。
- [x] T2：拆分公开Provider与宿主记录。
- [x] T3：迁移默认Agent策略并完成显式装配。
- [x] T4：统一内部ToolContent，移除无运行时用途的schema。
- [x] T5：同步文档、审查冗余、执行回归并记录验证。

## Issues

首次全量源码回归遇到长循环及ESLint编译超时，降低并发后的复测又受主机休眠影响。保留原时限、断言和默认worker设置，在命令期间临时防止闲置休眠，最终全量通过；详细证据及未验证范围见[验证记录](verify.md)。
