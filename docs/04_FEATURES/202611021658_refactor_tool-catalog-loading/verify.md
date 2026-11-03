# 工具治理验证记录

2026-11-03。范围见[Spec](spec.md)，最终机制见[设计](design.md)。实现与验证完成，按用户要求同步本地提交版本0.16.0，不推送；下述源码、浏览器与构建证据来自0.15.1候选实现，提交阶段仅同步文档与版本元数据。旧开发数据处理单列。

## 实现结果

34项模型工具收敛为28项，catalog/selection统一默认与候选。普通macOS有工作区、启用委派为11项，有Skill目录为12项；无工作区对应5/6项。显式选择、角色和已有状态另计。初始schema不重复写入nativeCandidates，来源与指纹保持真实。

删除6项入口及Skill grant/revoke、旧停止回调和重复路由名单；用户检查点/重置API保留。RunSkills拥有正文和租约，宿主拥有资源与插件绑定。模型loader只需ID，内部仍保留hash和授权代次。

请求准备统一协调加载持久化、声明和预算，保留SDK原文。长结果直接给出真实宿主记录ID并提供reader；缺少实际执行器时不伪造恢复承诺。显式排队Skill在消息消费后激活，消费前编辑/删除不残留正文或租约。

## 已执行检查

最终源码组合使用仓库缓存Node24.20.0。浏览器和首次构建使用Node24.22.1，最终构建又在24.20.0完成；早期Node25定向结果不作为受支持运行时的唯一证据。

| 检查                                                                                                                                            | 结果                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 整个agent-runtime/test，加storage capability-loading/skill-context、daemon skills-plugins/work-api/plugin-connection-api、Web tool-presentation | 48文件、340测试通过                                                          |
| storage capability-loading/skill-context/storage三文件定向回归                                                                                  | 44测试通过，包含真实SQLite/JSONL与重放、非法来源/指纹/Skill绑定拒绝          |
| protocol、storage、agent-runtime、daemon、Web与E2E编译面tsc                                                                                     | 通过；Web构建另执行其node/test编译面                                         |
| 本次变更TS/TSX的ESLint                                                                                                                          | 首次仅runtime.ts的type-only import错误；修正后单文件复检通过，其他文件无错误 |
| check-source-conventions.mjs                                                                                                                    | 961文件通过                                                                  |
| check-boundaries.mjs                                                                                                                            | 893源码文件通过                                                              |
| check-docs.mjs、变更文件Prettier、git diff --check                                                                                              | 通过；实际检查链接、换行和功能分钟目录                                       |
| pnpm build                                                                                                                                      | 最终8任务成功，6项缓存、runtime/daemon实际重建，产品版本未改                 |
| Chromium：M3全部场景及插件目录恢复调用                                                                                                          | 7场景通过，实际构建daemon/Web、动态端口、临时profile及合成Provider           |
| Office产物浏览器文件                                                                                                                            | 因已有Python环境前提跳过1项，不计为Office验证通过                            |

源码最终组合命令：

```sh
.cache/node/node-v24.20.0-darwin-arm64/bin/node node_modules/vitest/vitest.mjs run packages/agent-runtime/test packages/storage/test/capability-loading.test.ts packages/storage/test/skill-context.test.ts apps/daemon/test/skills-plugins.test.ts apps/daemon/test/work-api.test.ts apps/daemon/test/plugin-connection-api.test.ts apps/web/test/tool-presentation.test.ts
```

浏览器保留审核、快照/分支、两类重置、附件、上下文版本及合成GitHub授权后跨重启tool_search调用。Plan主请求由5次变为7次，其中2次是实际发现；补充查询前隐藏、查询后声明及批准步骤自动可达断言，没有降低原行为门槛。截图在忽略的output/playwright目录，Plan审核截图已实际观察。

浏览器实际入口为`/Users/liuxinyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`（24.22.1）。相同PATH下两轮实际命令：

```sh
pnpm exec playwright test tests/e2e/m3.spec.ts tests/e2e/plugin-connection.spec.ts --grep 'M3 计划反馈|M3 上下文摘要|GitHub 授权与应用目录跨重启恢复'
pnpm exec playwright test tests/e2e/m3.spec.ts --grep-invert 'M3 计划反馈|M3 上下文摘要'
```

两轮分别3项、4项通过。实际观察截图为`output/playwright/m3-plan-review.png`；同场景另有m3-plan和m3-checkpoints截图。

## 声明测量

使用最终构建catalog/selection与现有预算估算器。比较当前默认集合与保留28项全部声明，不含system、Skill摘要/正文、用户消息、MCP及其他已有状态；不是旧版27项的供应商Token对照或模型速度实测。

| 场景                  | 声明数 | JSON UTF-8字节 | 工具Token估算 |
| --------------------- | -----: | -------------: | ------------: |
| 有工作区、无Skill目录 |     11 |           6884 |          2647 |
| 有工作区、有Skill目录 |     12 |           7260 |          2804 |
| 无工作区、有Skill目录 |      6 |           4323 |          1633 |
| 保留28项全部声明      |     28 |          38028 |         13573 |

默认spawn/wait和Skill loader没有额外发现往返；Office、未知历史和非默认任务控制需发现。长结果reader、Skill资源和已有工作状态依据明确需求提供，不为已知入口重复搜索。

## 审查与限制

独立审查实际修复了Context与执行器能力混用、运行中新增Skill资源缺失、未消费Skill撤回，以及子任务角色目录和继承指纹问题；已进入最终回归。原始参数、审批、MCP只读/unknown/取消、父子隔离及持久化失败保持覆盖。

本地仅统计结构元数据：3份会话中2份同时含旧workspaceCandidates接受快照及工具加载事件。新校验不支持旧候选格式；未清理或改写原数据，也未启动用户profile验证旧数据恢复。新实现重启前需要处理旧开发会话，这与新临时profile通过分开记录。

未调用收费模型或真实OAuth账号，未改变4311/5174开发服务。Windows、Office视觉、真实供应商速度/计费、Electron安装器/签名和发布未在本轮验证；不扩大既有里程碑验收结论，不进入M6。

用户确认family/source分类维度与命名优化留待下一迭代，本次提交保留现有分类。

## 后续旧开发会话清理（2026-11-03）

工具治理提交后，用户实际启动在projectCapabilityLoad读取旧接受快照时遇到INVALID_RECORD；Vite随后因daemon退出而被联动终止。只读结构检查确认两份含workspaceCandidates的旧接受快照在工具加载事件处触发校验。临时副本先复现相同错误，再验证隔离两份日志及重建会话投影后可恢复，21张独立配置表摘要不变。

用户随后明确授权“不需要兼容旧数据，可以直接删掉，数据库也可以清理”。已持现有profile互斥锁，直接删除Desktop profile对应的两份阻塞JSONL，并按现有恢复顺序清空17张可重建投影表；正常ProfileStore回放恢复剩余一份会话。数据库完整性结果ok、外键检查无错误；独立配置表摘要保持一致，6个Provider和2个工作区保留。未删除整个数据库、工作区源文件、附件或凭据，也未引入格式兼容。

使用同一实际Desktop profile、构建后的daemon和动态端口完成启动验证：收到daemon.ready，GET /api/health返回200和ready。通过所属IPC断开关闭验证进程，退出码0；4311/5174没有留下验证服务。此次未发起模型请求或真实OAuth流程。上述清理是提交后的用户授权操作，不改变前文实现阶段未处理原数据的历史证据。
