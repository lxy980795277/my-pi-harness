# M5代码治理验证

日期：2026-10-30，北京时间。产品0.12.0，协议21，SQLite schema9；macOS arm64、Node24.20.0、pnpm10.34.6、Chromium。AC-01–04及UC-01–03在本轮源码、受控API/浏览器和产物恢复范围内通过。确认并处理9项中级、1项低级问题，未确认新的高风险缺陷；平台和真实服务范围见文末。

## 发现与处理

| 等级 | 位置                                               | 问题、处理与证据                                                                                                                                                                                                                                                                                    |
| ---- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 中   | storage/sessions/agent-tasks.ts                    | 详情先全量读取再JS分页，工具/usage还加载整个Session。改为ordinal范围SQL、ID-only后页判断及本页正文，工具限定Task与页锚点/待审批，用量只提取目标子树计量。JSON.parse计数证明不解码页外/兄弟大正文及无关工具，EXPLAIN命中task_id与ordinal范围索引。用量仍需聚合目标子树，不宣称全部查询为常数复杂度。 |
| 中   | protocol/sessions/agents.ts                        | messagesQueue没有消费者却每次传回全部通信。删除DTO、生产查询及fixture字段，内部通信事实与listAgentMessages保留；协议20→21，无SQL迁移。                                                                                                                                                              |
| 中   | Web/Runtime README、系统架构和使用指南             | 当前文档仍描述已移除的执行/Plan选项、delta持久提交、仅比较snapshotSeq及子Agent尚未实现。对照源码修正为当前入口和双水位，历史Spec/verify不覆盖。                                                                                                                                                     |
| 中   | Web tasks/use-task-detail与stores/messages         | 续作已接受但响应丢失时，重试随新Run重建ID并可能重复排队。完整输入与草稿由内存Store拥有，跨关闭保留；明确拒绝/确认才释放，已关闭Task仍可确认原请求。迟到Abort/422不能清理新确认。真实POST被接受后丢响应、关闭再开及Task结算后重试，JSON完整一致且仅一条补充/一个子Run。                              |
| 中   | Web sessions/use-session                           | 忙时丢弃失效通知可能遗留最后旧WorkState。Session和Agent订阅共用轻量排空函数，在途变化保留下一轮刷新；关闭、切换、重连及同持久seq的实时变化分别验证，通用点击互斥桥保留。                                                                                                                            |
| 中   | agent-runtime/agents/runtime.ts                    | 准备阶段超时仅因signal中止而记为取消。按首次拥有的终止原因分类，只有主动取消记录cancelled，后续停止不覆盖故障；真实限时与resolver通用AbortError两个用例先红后绿，原用户停止仍通过。                                                                                                                 |
| 中   | daemon/sessions/artifact-route.ts及storage工具查询 | 子Office工具不在根快照，下载入口遗漏。改为有界Session摘要及getVisibleTool精确查询，支持当前分支可见子工具；继承前缀200、裁剪/跨会话404、持久故障503，原原生来源/完成状态/路径/符号链接/摘要拒绝保持。                                                                                               |
| 中   | storage/sessions/journal-codec.ts                  | 子Run结束清整个Session基线，使父/兄弟重复写完整上下文。内存基线按Run→branch拥有，仅释放结束Run；交错编解码及真实Journal追加、重开、续追加回归先红后绿，完整自包含请求仍可读取，未改持久字段或历史文件。                                                                                             |
| 中   | package.json lint入口                              | 默认约4GiB堆下全仓类型感知ESLint退出134。仅给ESLint进程设8GiB上限，保留全部规则与范围；最终普通pnpm lint通过，不要求全局NODE_OPTIONS，也不改变产品进程配置。                                                                                                                                        |
| 低   | agent-runtime/agents/budget.ts                     | RequestWaiter.signal仅初始化而未读取，取消使用闭包signal。删除这一字段和赋值，既有6项预算回归通过。                                                                                                                                                                                                 |

准备阶段分类复用现有终止原因，没有新增重复failure字段；会话摘要、快照、订阅及串行命令的disabled检查归到同一assertReadable。工具集归一及角色/审批分离属于原[M5修复](../202610281702_feature_m5-subagents-board/verify.md#审批继承与只读能力修复2026-10-30)，不重复计算为本表治理发现。

## 实际检查

全部命令使用仓库固定Node的PATH；下面结果按各自范围列出，重叠测试不相加为总用例数。

- `pnpm exec vitest run packages/agent-runtime/test apps/daemon/test/agent-api.test.ts apps/daemon/test/approval-context.test.ts apps/daemon/test/plugin-connection-api.test.ts`：37文件234项通过，覆盖权限修复及指纹归一；后续治理变化按下面定向补验。
- `pnpm exec vitest run packages/agent-runtime/test/agents-failures.test.ts packages/agent-runtime/test/agent-runtime.test.ts packages/agent-runtime/test/agent-effects.test.ts packages/agent-runtime/test/session-runtime.test.ts apps/daemon/test/office-artifact.test.ts apps/web/test/task-message-recovery.test.ts apps/web/test/session-work-refresh.test.ts apps/web/test/agent-updates.test.ts apps/web/test/client-state-lifecycle.test.ts apps/web/test/input-recovery.test.ts`：10文件47项通过，9.44秒。迟到422分支新增后Web上述5文件最终14项通过，包含先复现再修正；最后纯类型导入与Store声明次序整理经类型和静态检查。
- `pnpm exec vitest run packages/storage/test/agent-query.test.ts packages/storage/test/agent-tasks.test.ts packages/storage/test/live-messages.test.ts packages/storage/test/journal-codec.test.ts packages/storage/test/session-jsonl.test.ts apps/web/test/task-view.test.ts`：最终6文件97项通过，涵盖查询范围、分页、实时覆盖、分支归属、损坏关系、请求引用与事务回滚隔离。
- `pnpm exec vitest run apps/desktop/test tests/unit/node-runtime.test.js tests/unit/process-tree.test.js tests/unit/desktop-oauth.test.js tests/unit/source-declarations.test.js tests/unit/source-conventions.test.js`：13文件159项通过、1项跳过，11.77秒；审查桌面11个源码文件及开发/资源/进程/检查脚本，未因此修改稳定桌面实现或声称Windows实机通过。
- `pnpm exec vitest run packages/agent-runtime/test/agents-budget.test.ts`：冗余字段删除后6项通过。
- `pnpm --filter @my-pi-harness/daemon exec vitest run --config vitest.built.config.ts test/recovery.built.test.ts`：最终产物2项通过，11.44秒，覆盖独立进程与已提交事实恢复。
- `pnpm typecheck`：根、E2E及8项workspace任务通过，16.452秒；后续codec改动的storage独立typecheck、最终Web build的源码/配置/测试类型面及纯类型整理后的Web测试tsc均通过。
- `pnpm build`：最终后端8项成功、4缓存，12.575秒，含协议21及最后codec；Web最后build单独通过，产物index-BI_skznk.js。既有Vite chunk提示保留；之后仅声明次序、纯类型导入、文档和检查进程内存配置整理，不重复无行为变化的浏览器验证。
- `pnpm exec playwright test tests/e2e/m5.spec.ts --grep 'M5 只读角色保留|M5 真实委派隔离|M5 子任务补充响应丢失' --workers=1`：最终5项通过，26.8秒，使用上述后端与最后Web产物，三审批策略、主委派及未知结果跨关闭重试均走真实受控服务。
- `pnpm lint`：最终普通入口全部通过，含ESLint、a11y、864源码导入、932文件声明约定、当时202文件文档及版本校验。此前检查分别发现类型import写法、声明顺序及默认堆OOM，已修正并完整重跑；没有关闭规则、缩小扫描或永久设置环境变量。随后pnpm format:check全仓通过，最终文档检查通过（203文件），git diff --check无输出，暂存区为空。

## 范围与交付

审查按通用、Renderer、daemon/能力包/存储及桌面四类规范进行，重点检查未提交M5、实时消息、错误呈现和审批修复的消费者与所有权；兼查MCP、Skills、插件OAuth、网络、embedding worker、凭据和恢复入口，未确认额外需要修复的集成缺陷。不因静态未命中删除动态注册、schema、CSS或发布资源，不新增依赖、物化字段、兼容分支或M6功能。

已查看output/playwright/m5-readonly-full-access-get.png及M5浅色/窄屏证据；自动化模型、GitHub和网关均为隔离fixture，不是用户真实账户或供应商验收。未重新打包/启动Electron安装包、执行Windows实机、签名公证或真实外部授权；既有平台缺口保持。

协议21需完整重启前后端，不清理用户数据库或会话，SQLite schema仍9，产品版本仍0.12.0。全部工作区已有有效改动保留，暂存区为空，未commit、push或创建发布记录。
