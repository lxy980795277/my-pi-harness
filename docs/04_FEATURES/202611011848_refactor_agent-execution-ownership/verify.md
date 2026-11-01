# Agent执行职责拆分验证

2026-11-01在macOS、Node24.20.0、pnpm10.34.6完成源码验证；基线a7b87f2。M0工程组织及M1/M3/M4/M5维护范围，M6仍仅规划。产品0.14.1、协议22、SQLite9未变；没有提交、构建、发布、清库或操作用户服务。

用户随后授权本地提交，按仓库规范同步产品与APP_VERSION至[0.14.2](../../06_RELEASES/0.14.2.md)；不推送、构建或发布。上面的0.14.1及范围diff记录对应实现验收时点，提交仅额外包含版本元数据与发布说明，公开协议22及SQLite9保持。

## 结果

| 条目             | 证据                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 执行职责   | RunExecution保留取消、失败、终态及后代收束；agent/inputs/messages分别拥有Pi装配、输入投递和原SDK事件记录，旧实现删除                                          |
| AC-02 公共准备   | prepare统一主子模型检查、history/work/user/system和接受批次；新增5项真实Pi及临时存储回归，覆盖根子字段差异、接受顺序、时间与租约释放                          |
| AC-03 工具分工   | families/policy/mcp-dispatch/ledger分开路由、审批、外部派发与记录；34种内置定义及27/21默认可见数量保持，定向工具回归9文件72项通过                             |
| AC-04 共用IO     | readStableFile共用原有安全读取；4文件66项通过，新增真实句柄用例覆盖增长、同长度修改、取消、关闭及源文件拒绝                                                   |
| AC-05 消息保持   | protected路径对基线diff为空；独立审查逐段核对原terminalContent、delta、privateData、队列原子批次、通信、partial及主子字段默认；Agent与相关存储45文件363项通过 |
| AC-06 静态与审查 | 两包类型检查与ESLint通过；私有类型归位后runtime类型检查及受影响文件ESLint通过；依赖和源码规范检查通过；独立只读审查无遗留阻塞                                 |

## 实际命令

下列pnpm与ESLint命令在仓库根目录使用`export PATH="$PWD/.cache/node/node-v24.20.0-darwin-arm64/bin:$PATH"`；用例使用真实临时JSONL/SQLite、文件句柄和受控Pi faux Provider，不调用真实模型或用户账户。各组存在交叠，不累计成独立用例总数。

```sh
pnpm --filter @my-pi-harness/agent-runtime --filter @my-pi-harness/execution typecheck
node --max-old-space-size=8192 node_modules/eslint/bin/eslint.js packages/agent-runtime packages/execution
pnpm exec vitest run packages/execution/test/stable-file.test.ts packages/agent-runtime/test/context-rules.test.ts packages/execution/test/execution.test.ts packages/execution/test/workspace-path.test.ts
pnpm exec vitest run packages/agent-runtime/test packages/storage/test/tools.test.ts packages/storage/test/agent-tasks.test.ts packages/storage/test/agent-query.test.ts packages/storage/test/context-work.test.ts packages/storage/test/live-messages.test.ts packages/storage/test/journal-codec.test.ts packages/storage/test/session-jsonl.test.ts packages/storage/test/stored-event.test.ts
pnpm exec vitest run packages/agent-runtime/test/tool-ownership.test.ts packages/agent-runtime/test/tool-runtime.test.ts packages/agent-runtime/test/external-tools.test.ts packages/agent-runtime/test/task-toolset.test.ts packages/agent-runtime/test/run-toolset-pipeline.test.ts packages/agent-runtime/test/agent-permissions.test.ts packages/agent-runtime/test/capabilities.test.ts packages/agent-runtime/test/approval-review-guard.test.ts packages/agent-runtime/test/task-work.test.ts
pnpm --filter @my-pi-harness/agent-runtime typecheck
node --max-old-space-size=8192 node_modules/eslint/bin/eslint.js packages/agent-runtime/src/tools/ledger.ts packages/agent-runtime/src/tools/policy.ts packages/agent-runtime/src/tools/types.ts packages/agent-runtime/test/tool-ownership.test.ts
node scripts/check-source-conventions.mjs
node scripts/check-boundaries.mjs
git diff --check
```

源码规范检查949文件、依赖检查881源文件通过。最后一次行为回归后仅归位模块私有类型、调整一个测试标题和同步文档，没有改执行行为；类型与对应ESLint已重验。

收口检查对全部33个变更文件执行Prettier写入及`--check`通过；`node scripts/check-docs.mjs`通过217份文档。补充对`packages/agent-runtime/test/tool-runtime.test.ts`执行ESLint通过；`git diff --check`通过。

范围核对使用以下命令，输出为空：

```sh
git diff --exit-code HEAD -- packages/protocol packages/storage apps/web apps/daemon packages/agent-runtime/src/context/codec.ts packages/agent-runtime/src/context/agent-message.ts packages/agent-runtime/src/sessions/ports.ts packages/agent-runtime/src/runs/acceptance.ts package.json pnpm-lock.yaml
```

## 审查与限制

审查修复了抽取过程中的两处行为偏移：work工具保留原完整公开结果，让超限继续被持久边界拒绝；未知session工具仍在接受intent和策略处理后拒绝，不在构建SDK工具列表时提前报错。新增超限work回归确认不静默截断成功、不保存canonical结果或继续第二次模型请求；持久失败停用Session。

未验证真实供应商、OAuth、外部MCP、浏览器、Electron产物或Windows机器，本轮没有改变这些对外接口或页面。现有真实API、Office及目标平台缺口继续由roadmap拥有。本轮没有恢复parts、消息重命名、EventInput迁移或新codec，也没有旧格式兼容层。
