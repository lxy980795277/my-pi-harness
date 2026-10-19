# M3复核与M4前代码治理验证

日期：2026-10-19，Asia/Shanghai。应用0.4.0、wire9；macOS arm64、Node24.20.0、pnpm10.34.6、Electron43.7.9、Chromium。保留此前登录与界面未提交改动，未提交、推送或删除开发数据。

## 结论

M3.1–M3.8达到当前Spec的工程完成标准，没有未实现子项。按治理流程发现高0项、中4项、低2项，均已修复或清理，相关回归通过；可以进入已确认的M4.1本地MCP设计与开发。用户统一体验、真实供应商/GitHub授权和其他平台仍单列，不将工程完成写成全部外部验收完成。

## M3功能复核

| 子项              | 当前实现与本轮证据                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| M3.1 规则上下文   | 作用域、优先级、冻结、下一Run重载与安全拒绝；context-rules、work-runtime及宿主引用浏览器场景通过              |
| M3.2 附件         | 文本/图片/PDF/文档、冻结内容、单附件发送、粘贴与历史预览；附件服务/文件及浏览器通过，本轮补关闭重开及取消回归 |
| M3.3 预算         | 每请求估算、输出预留、Usage校准、完整工具配对与超限拒绝；context-budget、context-pipeline通过                 |
| M3.4 压缩         | 同Run连续压缩、结构化摘要、父子版本、fallback/取消与任务连续性；流水线与上下文回归通过                        |
| M3.5 人工提问     | 多题单/多选/自由答、错误关联拒绝、取消与原Run继续；work-runtime、work-api及浏览器通过                         |
| M3.6 Plan/Todos   | 同Run反馈/批准、只读规划、任务完成依据及步骤关联；本轮修复替换计划造成失效关联，真实Pi与SQLite回归通过        |
| M3.7 检查点与重置 | 摘要比较/选择、本会话检索、快照新分支、独立任务/上下文重置；存储/运行时及浏览器通过                           |
| M3.8 联调与恢复   | JSONL事实、SQLite投影重建、附件恢复与中断收敛；源码、构建daemon恢复、M1/M2浏览器和最新桌面smoke通过           |

MCP/Skill禁用占位不是M3缺项；已按用户决定移除的工作区文件引用入口不恢复，宿主API与历史预览保留。跨会话记忆/搜索、子Agent、完整导入导出和磁盘撤销仍归后续里程碑。

## 治理发现与处理

| 等级与位置                                                                      | 实际问题与证据                                                                                                                        | 修复及验证                                                                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 中：`apps/web/src/features/attachments/components/attachment-item/index.tsx:57` | 原内容Query常驻附件Item，关闭只设enabled=false；真实QueryObserver证明gcTime=0仍保留原文，浏览器旧dist重开直接显示旧内容               | 内容组件仅随打开的预览挂载，最后observer卸载取消读取并回收内容缓存，不影响其他打开的预览；新dist验证重开只显示loading、关闭在途请求触发ERR_ABORTED |
| 中：`packages/agent-runtime/src/work-interactions.ts:170`                       | 新计划可以删掉已有Todo关联的步骤，保存失效planStepId；真实模型用例在旧代码进入错误计划等待而失败                                      | 保存与创建审核等待前拒绝并提示更新任务关联；回归证明完整WorkState/revision不变，合法计划仍可批准并继续，子集步骤进度更新不删关联                   |
| 中：`.github/workflows/ci.yml:35`                                               | 打包要求Client ID，CI没有配置且根.env不跟踪，干净checkout资源准备必失败；临时空目录直接复现拒绝                                       | 仅CI打包步骤显式提供合成公开Client ID，生产缺配置仍拒绝；配置解析、无.env环境构建输入、秘密白名单已有实测，远端CI未执行                            |
| 中：`docs/07_USER_GUIDE/context-interaction.md:27`                              | 指南仍写停止后批准、重新发消息执行和合并重置，名称与行为均落后当前UI                                                                  | 对照PlanReviewCard、CheckpointPanel、CompactionPanel及行为测试，改为原Run审核、两种独立重置和摘要/快照区别，补文档与单附件发送说明                 |
| 低：`packages/agent-runtime/src/context/index.ts`、`work-runtime.ts:108`        | 旧compaction模块只有内部barrel与自身单测消费者，prepare还接收未使用toolDefinitions；全仓引用、公开exports和真实压缩路径核对无其他用途 | 删除旧模块的2函数/1类型/相应导出、2条仅测旧实现的用例，去掉未使用参数及唯一调用构造；保留真实手动/自动压缩与对应M3回归                             |
| 低：`apps/daemon/src/features/attachments/README.md:3`                          | 只写本机授权，遗漏新增应用登录门禁                                                                                                    | 明确附件元数据/内容及文件列表要求本机信任与有效应用登录，与统一鉴权及既有拒绝用例一致                                                              |

审查按overview、code、web、server、desktop覆盖Renderer状态/Query、HTTP/SSE、Agent权限/取消、JSONL/SQLite、Electron有限桥/进程监督及工程入口。核对领域类型、弃用API、复杂空值选择、依赖与动态消费者；没有机械禁止简单默认、改写有拥有者的宿主Promise或裁剪实际fixtures/support。未发现其他需要修改的高/中问题；store.ts接近行数阈值，后续扩展需继续关注职责，当前不为凑治理结果拆散事务。

## 实际检查

命令均在仓库根目录、项目缓存Node PATH下执行；子包命令由pnpm切换目录。源码测试与构建产物分别验证，不将重叠用例重复计数。

| 命令                                                                                                                                                                                                            | 结果                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                                                                                                                                                             | Pass，全仓格式；最后文档收尾另做定向Prettier                                                                  |
| `pnpm lint`                                                                                                                                                                                                     | Pass，ESLint含弃用规则、a11y、408文件依赖边界、449文件源码约定、文档与版本检查                                |
| `pnpm typecheck`                                                                                                                                                                                                | Pass，根工具/E2E及7个workspace任务，包含Web三个编译面                                                         |
| `pnpm test:m3`                                                                                                                                                                                                  | Pass，17个源码文件112项，随后6个Chromium场景；包含新增计划关联与附件关闭回归                                  |
| `pnpm exec vitest run apps/desktop/test tests/unit/desktop-oauth.test.js tests/unit/boundaries.test.js tests/unit/source-conventions.test.js tests/unit/lint-coverage.test.js tests/unit/frontend-lint.test.js` | Pass，13文件303项，无跳过；包含真实合法/非法规则fixture、桌面授权/安全/生命周期与OAuth资源白名单              |
| `pnpm exec playwright test tests/e2e/m1.spec.ts tests/e2e/m2-completion.spec.ts --output test-results/m3-governance-regressions`                                                                                | Pass，4场；流式会话/刷新/分支、Enter/输入法事件、队列/停止/引导，以及真实工具审批/编辑/受限执行               |
| `pnpm --filter @my-pi-harness/daemon exec vitest run --config vitest.built.config.ts test/recovery.built.test.ts`                                                                                               | Pass，2项；新构建真实daemon进程、登录Cookie恢复及M3附件/工作状态中断恢复                                      |
| `pnpm package:desktop`                                                                                                                                                                                          | Pass，包含7个workspace构建任务（4个缓存命中）及最新macOS arm64应用装配；使用本机既有公开Client ID，未修改.env |
| `pnpm smoke:desktop`                                                                                                                                                                                            | Pass，最新真实.app在临时cwd/profile启动，覆盖门禁、设置、解析、工作区桥/来源拒绝及所属进程退出                |

源码两组共415项，另有2项构建daemon和10个浏览器场景；聚焦计划用例包含在112项中，不额外累加。登录/退出loading未修改，沿用此前对应验证，未重复跑全部浏览器或全仓单测。

修复前证据：新增计划用例旧代码失败、修复后聚焦通过；`pnpm exec playwright test tests/e2e/m3.spec.ts --grep 'M3 上传文本随首发' --output test-results/governance-attachment-before` 在旧dist因仍显示原文而失败，新dist随test:m3通过。真实QueryObserver还证明最后observer卸载会取消signal，晚到结果不重新留在cache。CI配置复现在独立临时空目录调用desktopOAuthEnvironment，缺配置拒绝、显式合成配置接受，不读取真实.env内容。

## 边界与交付

Windows Shell仍是用户暂缓且尚未实现的M2项，浏览器新增目录也继续暂缓。未执行Windows实机、远端GitHub Actions、真实模型/GitHub授权、正式签名/公证或安装器验收。Chromium合成输入法事件不代替原生输入法人工体验；macOS应用目录的未签名smoke不等于正式安装发布。

本轮没有新增依赖、改协议/日志版本、执行数据迁移或清理现有会话。打包存在既有上游依赖弃用告警，未发现直接源码弃用调用，也未借本轮升级依赖。完成后下一步是M4.1本地MCP：先细化Run工具集、配置/信任与受监管stdio的Spec，再按已确认流程开发，不提前将M4.2–M4.9标为已实现。
