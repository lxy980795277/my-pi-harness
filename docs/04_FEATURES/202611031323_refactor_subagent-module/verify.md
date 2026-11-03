# 子Agent模块整理验证

2026-11-03，以候选产品0.16.0完成实现与本机自动化验证，范围见[Spec](spec.md)。模块验证阶段未自动提交、推送、升版或处理用户数据；后续数据清理单独记录于文末，用户本次授权的本地提交与版本同步见[0.17.0](../../06_RELEASES/0.17.0.md)。

## 实现与职责

agents目录迁到subagents，AgentRuntime改为SubagentCoordinator，存储端口为SubagentStore；宿主通过SessionRuntime.subagents接入。运行时源码、daemon装配及测试消费者同步，公开HTTP路径、任务事件、消息格式与持久schema保持。旧内部目录与名称没有兼容转发。

协调器继续唯一拥有活动节点索引、树级计时器、写入拥有权与停止/收束。policy负责委派角色、限额、附件和工具访问；messaging负责通信幂等、路由及续作准入，只借协调器的只读索引和启动回调，不新增状态Map。没有为草图机械创建lifecycle文件或独立package。

原run-hooks拆成tool-dispatch和run-adapter，分别适配五个模型工具与单Run请求/生命周期。RunHooks与RunInjectedInput归runs/ports，运行中输入仅在SDK消费消息时提交贡献记录。现有通信回归增加task.message_consumed与message.started同批、同时间且只消费一次的断言。

通用selection接收allows与required，不解释子任务角色；launch提供原有角色谓词和通信入口依赖。runs不导入subagents，prepare仍以共享AgentMessage DTO处理续作来源，不引入新消息表示。工具分类和权限行为的后续优化不并入本轮。

## 已执行检查

所有命令使用仓库缓存Node24.20.0，构建和浏览器通过PATH显式选择同一运行时。

| 检查                                                                                                                     | 结果                                                              |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 整个agent-runtime/test、storage的agent-tasks/agent-query/agent-limits-persistence、daemon的agent-api/agent-change-stream | 47文件、306项通过；真实临时SQLite/JSONL及受控模型调用             |
| runtime、daemon编译面tsc --noEmit                                                                                        | 通过                                                              |
| 变更TS/TSX的Prettier与ESLint                                                                                             | 通过                                                              |
| check-source-conventions.mjs                                                                                             | 964文件通过                                                       |
| check-boundaries.mjs                                                                                                     | 896源码文件通过                                                   |
| 文档链接、版本一致性及git diff --check                                                                                   | 通过                                                              |
| pnpm build                                                                                                               | 8任务成功，全部实际构建；Web编译面与Electron main/preload构建完成 |
| Chromium M5完整文件                                                                                                      | 8场景通过，动态端口、临时profile、合成Provider和内存凭据          |

源码组合命令：

```sh
.cache/node/node-v24.20.0-darwin-arm64/bin/node node_modules/vitest/vitest.mjs run packages/agent-runtime/test packages/storage/test/agent-tasks.test.ts packages/storage/test/agent-query.test.ts packages/storage/test/agent-limits-persistence.test.ts apps/daemon/test/agent-api.test.ts apps/daemon/test/agent-change-stream.test.ts
```

构建与浏览器：

```sh
PATH="$PWD/.cache/node/node-v24.20.0-darwin-arm64/bin:$PATH" pnpm build
PATH="$PWD/.cache/node/node-v24.20.0-darwin-arm64/bin:$PATH" pnpm exec playwright test tests/e2e/m5.spec.ts
```

M5场景实际覆盖full-access/ask/auto三种审批继承、隔离子上下文、任务树和看板设置、子任务提问、父子通信、停止实际受控模型流，以及补充响应丢失后的重试身份。没有用静态类型检查代替这些用户链路。

AC-01/02/06通过源码导入、消费者及独立审查核对；AC-03–05由委派、协作、权限、副作用、失败与准备测试及M5浏览器共同覆盖；AC-07以本表实际命令为准。新增模型工具、权限策略或数据格式均不在本次变更中。

## 审查与限制

交叉审查未发现角色筛选、通信消费、请求槽释放或取消顺序相对重构前的行为变化。模型工具路由与Run适配使用窄宿主接口；没有为了未来后端添加未使用factory、事件总线或新包。

构建完成后移除忽略目录dist中20份旧agents路径及task-toolset编译残留，避免已删除源码继续进入产物；实际新入口使用subagents。构建保留既有renderer config与Web大chunk提示，不作为本轮功能失败。

没有访问真实模型/OAuth/用户Keychain，不更改4311/5174服务，没有运行用户profile或处理先前记录的旧格式会话。未执行Windows、Electron实际窗口/安装包/签名、真实供应商或Office视觉验收。M6及既有平台缺口保持原状态。

模块验收后，用户另行授权直接清理上轮工具治理的旧数据。已删除两份阻塞启动的会话并重建投影，使用实际Desktop profile启动构建daemon、通过健康检查后退出，详细证据见[工具治理后续清理](../202611021658_refactor_tool-catalog-loading/verify.md#后续旧开发会话清理2026-11-03)。此操作没有改动本轮源码或扩大模型、OAuth、Electron窗口及平台验收结论。
