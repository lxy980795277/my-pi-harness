# Agent循环策略验证

日期：2026-11-03。环境：macOS、仓库缓存Node 24.20.0、pnpm 10.34.6。属于M0及既有M1/M5维护，不进入M6；验证使用受控模型、真实Pi、临时SQLite/JSONL和隔离浏览器服务，不使用真实供应商凭据。

## 验收结果

| 条件             | 实际证据                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 长循环     | 根、子Run各完成34次模型请求、66次成功文件工具调用，超过原32/16轮与64次调用限制；均自然结束且模型租约释放                                                                         |
| AC-02 配置精简   | 删除maxTurns schema、默认、计数、Hook、设置和详情展示；真实HTTP设置、存储写入和spawn拒绝旧字段，现有持久字段清理机制保持                                                         |
| AC-03 重复提醒   | 同一工具与规范化完整参数在3/5/8次提醒；对象键序无关、数组顺序保留；动态声明重建保持同Run状态，新Run独立；原JSON首块及公开结果不变，重开profile重建后工具上下文与实际入模内容一致 |
| AC-03 容量边界   | 先复现满128块工具内容追加提醒导致持久化失败；修复后连续三次满容量结果完整进入Pi与SQLite，Run正常完成；容量由现有TypeBox schema读取，不另存硬编码上限                             |
| AC-04 部分成果   | 保留失败/取消/超时前正文和错误，length或16000字符返回截短标partial；成功完整答案不标partial，续作无新文字不借用旧Run；父模型实际读取部分结果                                     |
| AC-05 职责与回归 | 工具指纹和重复检测复用tools/identity；提醒沿原终态tool.context落盘，不新增事件、用户消息或强制总结调用；现有权限、请求并发、停止及任务存储/API回归通过                           |

## 执行检查

下列node命令均使用仓库缓存的24.20.0可执行文件。各组测试有交叠，不累加为独立用例总数。

- 综合源码：`vitest run packages/agent-runtime/test packages/storage/test/agent-limits-persistence.test.ts packages/storage/test/agent-tasks.test.ts packages/storage/test/agent-query.test.ts apps/daemon/test/agent-api.test.ts apps/daemon/test/agent-change-stream.test.ts apps/daemon/test/session-stream-update.test.ts apps/web/test/task-view.test.ts apps/web/test/task-message-recovery.test.ts apps/web/test/agent-updates.test.ts`：54文件343项通过。
- 满容量修复后定向：`vitest run packages/agent-runtime/test/tool-repeat-reminder.test.ts packages/agent-runtime/test/run-toolset.test.ts`：2文件12项通过；此前原工具执行11项通过。
- `pnpm typecheck`：8个workspace检查通过，含根程序与E2E编译面。拒绝旧字段的存储fixture曾触发多余属性编译错误，已用具名输入保留实际非法数据并修正；容量修复后运行时`tsc --noEmit`再次通过。
- 改动TS/TSX的ESLint通过；后续identity、收据及满容量改动分别补跑所属文件ESLint。
- `pnpm build`：8项构建通过；后续运行时去重及容量修复分别增量编译，最终构建产物导入通过。原Electron renderer配置提示及Web大chunk提示仍存在，不据此扩大本轮范围。
- `playwright test tests/e2e/m5.spec.ts`：8项通过，覆盖三种审批方式、上下文隔离、任务树/看板/设置、人工提问、父子通信、实际模型流停止及补充请求重试身份。
- 源码声明检查969文件、导入检查901文件通过，版本同步检查、改动格式及diff检查通过；最终文档门禁覆盖本目录及更新后的索引。

## 审查与边界

独立审查未发现遗留固定请求轮数或累计工具调用次数判断。仍保留同时声明64个工具的容量、任务数、嵌套深度、请求并发、已有时限、输入输出和上下文容量约束；这些不是累计执行次数。提醒只覆盖进入ToolRuntime的已接受调用，结果满容量时保留原结果并跳过该次提醒。

公开协议更新为23，SQLite schema9和原事件格式保持；循环策略实现阶段未清理真实数据、修改凭据、停止用户服务或自动提交/推送。用户后续授权将本轮与已完成的subagents模块重构一起整理为[0.17.0](../../06_RELEASES/0.17.0.md)本地提交；两者验证范围分别保留，不将版本同步当作新增产品验收。

未验证真实供应商是否会依据提醒调整策略、真实网络/MCP长期任务效果、Electron实际窗口及Windows平台；部分输出只回收已有assistant正文，不自动汇总所有原始工具结果，也不保证任务内容质量。
