# M3收尾复核与技术文档验证

日期：2026-10-16，北京时间。复核当前工作区实现和此前验证，未改产品源码、未提交、未推送、未清理数据，也未进入M4开发。

## M3完成结论

M3.1–M3.8达到当前Spec定义的工程完成标准，未发现需要补写的功能或可证实的产品缺陷。状态维持“实现与macOS本机自动化验证完成，待用户统一体验验收”；不将真实供应商、账号、其他平台和原生输入法体验写为已验收。

| 模块            | 复核的实现                                                           | 实质验证入口                                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M3.1 规则       | 工作区根/引用祖先发现、优先级、规则冻结及下次Run重载                 | [规则测试](../../../packages/agent-runtime/test/context-rules.test.ts)、[工作运行时](../../../packages/agent-runtime/test/work-runtime.test.ts)、[M3浏览器](../../../tests/e2e/m3.spec.ts)                    |
| M3.2 附件       | 文本/图片/PDF/文档解析、不可变内容、仅附件发送、图片粘贴与历史预览   | [附件服务](../../../apps/daemon/test/attachments.test.ts)、[附件文件](../../../packages/storage/test/attachment-blobs.test.ts)、[前端输入](../../../apps/web/test/attachment-input.test.ts)                   |
| M3.3 预算       | 每请求投影、分类估算、Usage校准、输出预留、完整工具周期与超限拒绝    | [预算测试](../../../packages/agent-runtime/test/context-budget.test.ts)、[请求流水线](../../../packages/agent-runtime/test/context-pipeline.test.ts)                                                          |
| M3.4 压缩       | 同Run连续压缩、结构化七字段、版本父链、任务连续性、fallback/取消     | [请求流水线](../../../packages/agent-runtime/test/context-pipeline.test.ts)、[上下文回归](../../../packages/agent-runtime/test/context-review-regressions.test.ts)                                            |
| M3.5 提问       | 多题单/多选/自由答、校验、取消、同Run继续和重启中断                  | [工作运行时](../../../packages/agent-runtime/test/work-runtime.test.ts)、[工作API](../../../apps/daemon/test/work-api.test.ts)、[M3浏览器](../../../tests/e2e/m3.spec.ts)                                     |
| M3.6 Plan/Todos | 计划反馈/修订/批准后同Run执行、步骤与完成证据、规划只读              | [工作运行时](../../../packages/agent-runtime/test/work-runtime.test.ts)、[上下文回归](../../../packages/agent-runtime/test/context-review-regressions.test.ts)、[M3浏览器](../../../tests/e2e/m3.spec.ts)     |
| M3.7 检查点     | 摘要比较/选择、有界本会话检索、任务/上下文分离重置、手动快照恢复分支 | [工作投影](../../../packages/storage/test/context-work.test.ts)、[上下文回归](../../../packages/agent-runtime/test/context-review-regressions.test.ts)、[M3浏览器](../../../tests/e2e/m3.spec.ts)             |
| M3.8 联调与存储 | JSONL批提交、SQLite投影、privateData隔离、附件恢复与进程中断         | [JSONL测试](../../../packages/storage/test/session-jsonl.test.ts)、[构建daemon恢复](../../../apps/daemon/test/recovery.built.test.ts)、[M3实际验证](../202610151655_feature_m3-context-interaction/verify.md) |

复用的实际执行证据：M3验证记录包含731项源码、33项浏览器、6项构建daemon及macOS打包/smoke；随后[代码治理验证](../202610161244_refactor_code-governance/verify.md)包含745项源码通过、2项环境跳过、12项定向浏览器、格式/lint/类型和构建通过。本轮只读核对这些测试及其实现，未重新执行产品测试，不合并各轮计数。

Windows Shell、浏览器新增工作区继续属于用户暂缓的M2；MCP/Skill、子Agent、跨会话检索/长期记忆、完整导入导出和磁盘撤销分别仍归M4–M7。现有文件引用只保留宿主API与历史预览，不重新加入用户已移除的前端入口。

## 技术文档交付

09当前仅有总览和五篇设计，每篇约230–280行，按机制复杂度组织，不复制参考文档的业务内容或凑满其522行。

- [系统架构](../../09_TECHNICAL/系统架构设计.md)：进程、资源归属、授权、全链路及HTTP/SSE状态同步。
- [Agent运行时](../../09_TECHNICAL/Agent-Runtime.md)：Pi分工、Session/Run、队列、取消、工具和同Run交互。
- [上下文管理](../../09_TECHNICAL/上下文管理设计.md)：规则/附件冻结、每请求预算、摘要、版本、检索与重置。
- [会话存储](../../09_TECHNICAL/会话存储与恢复设计.md)：JSONL/SQLite分工、批提交、附件、恢复、分支与快照。
- [工作区与执行](../../09_TECHNICAL/工作区与执行设计.md)：目录归属、路径与预像、三种审批、Shell隔离和回收。

四篇旧文档已按要求删除，无副本或重定向页。AGENTS、README、文档地图和roadmap入口同步，09不再承担依赖版本审计、范式对照、决策流水或通用经验汇编。

## 源码核对与修正

- roadmap中M1的持久化说明更新为当前JSONL事实与SQLite投影；协议删除旧数据库迁移叙述，保留实际Provider绑定职责。
- Pi 1.1.0的steer只入队，当前回复和该轮工具完成后再注入，不中断在途模型或工具；API与设计按实际语义说明。
- SSE原EventSource自动重连复用原URL，daemon不使用Last-Event-ID覆盖afterSeq；重复传输通过单调快照合并处理，不宣称精确无重复续流。
- 规则正文属于公开WorkState，供已授权客户端读取；附件完整正文/图片、模型codec和请求privateData的接口归属另行明确。
- 工具执行限额不等于失败审计记录总数上限；协调器实例与其Run/等待项生命周期分别描述。
- 文件工具与Shell的.git策略、目录真实路径与inode保证、已有会话与首次空日志的恢复行为均按源码收紧表述。
- 修正运行时README“唯一步骤”的歧义，治理verify表格恢复正确列数；历史M3折叠证据保留原记录。

## 本轮实际检查

| 检查                               | 结果                                                     |
| ---------------------------------- | -------------------------------------------------------- |
| node scripts/check-docs.mjs        | Pass；收尾后85份文档的链接、末尾换行和分钟目录检查通过   |
| pnpm format:check                  | Pass；收尾后全仓Prettier通过                             |
| 五篇实现锚点与机制交叉审阅         | Pass；对照当前源码及锁定Pi依赖核查，无未实现能力冒充现状 |
| 09目录文件集合与Markdown表格列检查 | Pass；仅五篇设计加总览，检查技术文档及修复后的治理表格   |
| git diff --check                   | Pass；收尾后复查通过，保留已有未提交改动                 |

本轮没有源码行为变化，不重复lint、typecheck、产品测试、构建或桌面打包。最终格式和文档检查已在收尾文件写入后通过；没有新增真实供应商或其他平台运行证据。

## 中文文件命名调整

按用户后续要求，09五篇设计及入口均改用中文文件名，入口为[技术文档总览](../../09_TECHNICAL/技术文档总览.md)；正文交叉引用、AGENTS、README、文档地图、roadmap和本轮记录同步，不保留英文别名副本。重命名后85份文档检查与diff检查通过，旧英文文件名和入口路径扫描无剩余引用；所有本轮受影响文档格式检查通过。此次仅重命名与引用更新，未运行产品测试或提交。

## 提交前引用同步

当前运行时设计文件使用Agent-Runtime.md名称，保留现有内容与命名，其他文档及本记录的引用同步为实际路径；中文命名调整段落保留此前执行记录。
