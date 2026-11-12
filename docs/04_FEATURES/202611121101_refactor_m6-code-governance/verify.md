# M6 实现治理验证

2026-11-12。按[Spec](spec.md)完成当前M6实现及其与既有runtime/tools、storage、Web、daemon和共享协议连接的治理；属于M0与M6维护。保留原M6未提交内容，产品0.19.1、公开协议27和SQLite16均保持，不读取真实凭据、不清理真实数据、不提交或推送。

## 扫描与修复

本轮按下表归纳7类，1项中、6项低，未在本轮扫描范围发现高风险项；这不是对全仓或所有平台的安全保证。类型、消费者、动态注册、生产入口和相关测试一起核对，没有按文件数或行数制造拆分。

| 等级 | 位置                                                                              | 证据与处理                                                                                                                                        | 验证                                                                                    |
| ---- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 中   | daemon/application/services.ts、memory/retrieval.ts                               | 记忆召回单独构造查询引擎，只用结果且绕过已有服务取消/关闭管理；统一注入SearchService.queryScoped，内部输入只接收query/limit，范围由独立access负责 | 实际临时SQLite与可控推理验证关闭中的召回被取消、等待真实结算、关闭后拒绝新查询；API回归 |
| 低   | agent-runtime/runs/agent.ts、request.ts、ports.ts、memory.ts                      | 删除RunRequestDraft对PreparedContext的重复包装及第二memory引用；四写及搜索端口只从context取得已合并signal                                         | 派发/摘要名额、root/child、steer/follow-up、host this绑定及Run/Tool任一取消回归         |
| 低   | agent-runtime/runs/search.ts、daemon/search/runtime.ts、protocol/search/search.ts | 同版本搜索资格按来源去重；引用仍保留精确选区。相同来源比较收敛为共享纯函数，来源类别及记忆mode schema复用；范围、版本冲突、事实核对仍由执行者负责 | 重复chunk与冲突版本、同文不同来源、越界引用及真实HTTP精读回归                           |
| 低   | storage/memory/repository.ts、sessions/memory-adoption.ts、search/repository.ts   | 删除无消费者get接口；收窄实际更新来源；完整prepared在入口校验一次，解码继续核对system/range；静态行schema归文件头，向量不再伪造rank并重复解析     | 正常采用与非法范围、坏日志、截断BLOB/TEXT/Infinity拒绝、CAS/遗忘/搜索回归               |
| 低   | Web/search hooks/types、sessions/types/timeline-target.ts                         | 来源翻页由cursor/textOffset两份状态收敛为selection/messages/text联合；删除三个无消费者返回字段，import集中在声明前                                | 客户端缓存/引用/定位测试、三类型面、浏览器实际分页与草稿保留                            |
| 低   | daemon/search/local-model-resource.ts、tool-search-embedder.ts                    | 工具目录协议适配独立归位；模型资源类只拥有两模型视图、Worker与调度。没有拆成互相转发的队列/Worker类                                               | 原资源、取消、公平性、M4适配测试及生产部署                                              |
| 低   | docs/03_API/overview.md                                                           | 当前版本字面量26/15已过期，改为引用PROTOCOL_VERSION与SCHEMA_VERSION的源代码定义                                                                   | 文档与版本检查                                                                          |

## 明确保留

- Worker队列、活动取消与真实settled跟踪共同协调容量，626行文件经职责评估仅移出独立工具适配器；没有为行数拆生命周期。
- 当前任务文本与记忆召回查询来源不同，runtime授权与storage持久事实核对处于不同实际入口，均保留。
- Query事实、Zustand草稿/筛选、虚拟seek中的DOM定位和自动跟随分别拥有不同状态，不合并为第二事实源。
- 两模型的准备/取消状态独立、一次资源拥有者保持；既有迁移1–16、过滤、索引、JOIN、排序及模型调度不变。向量SQL仅移除没有语义的常量rank投影，保留损坏与有限性校验。
- 检索诊断中的lexical/semantic/ranked有真实质量/性能测试消费者，不按只看生产调用的扫描误删。

## 实际检查

环境为macOS arm64、Node24.20.0。以下测试存在交叉覆盖，不相加当作独立用例总数。命令在仓库根执行，Node选择为`export PATH="$PWD/.cache/node/node-v24.20.0-darwin-arm64/bin:$PATH"`。

- `pnpm exec vitest run --config packages/storage/vitest.config.ts packages/storage/test/memory-adoption-codec.test.ts packages/storage/test/journal-codec.test.ts packages/storage/test/search.test.ts packages/storage/test/search-source-window.test.ts packages/storage/test/memory.test.ts packages/storage/test/memory-writes.test.ts packages/storage/test/context-work.test.ts --maxWorkers=2`：7文件91项通过。
- `pnpm exec vitest run tests/unit/boundaries.test.js tests/unit/source-conventions.test.js --maxWorkers=2`：2文件187项通过。
- `pnpm exec vitest run packages/agent-runtime/test/memory-request-dispatch.test.ts packages/agent-runtime/test/memory-delegated-dispatch.test.ts packages/agent-runtime/test/memory-context.test.ts packages/agent-runtime/test/memory-mutations.test.ts packages/agent-runtime/test/search-source-access.test.ts packages/agent-runtime/test/session-search-runtime.test.ts packages/tools/test/memory-mutations.test.ts --maxWorkers=2`：7文件40项通过。随后增加取消/绑定断言，对memory-mutations、memory-request-dispatch、search-source-access三个文件再验22项通过。
- `pnpm exec vitest run apps/web/test/search-service.test.ts apps/web/test/search-discovery.test.ts apps/web/test/search-lifecycle.test.ts apps/web/test/search-quotes.test.ts apps/web/test/search-source-metadata.test.ts apps/web/test/timeline-target.test.ts apps/web/test/timeline-state.test.ts --maxWorkers=2`：6个未变文件17项通过；metadata用例首次因缓存种子仍使用旧分页key有1项失败，更新种子后以`pnpm exec vitest run apps/web/test/search-source-metadata.test.ts --maxWorkers=2`重验3项通过。没有放宽产品断言。
- `pnpm exec vitest run apps/daemon/test/memory-retrieval.test.ts apps/daemon/test/search-service-lifecycle.test.ts apps/daemon/test/local-model-resource.test.ts apps/daemon/test/memory-api.test.ts apps/daemon/test/memory-writes-api.test.ts --maxWorkers=2`：5文件33项通过。
- `pnpm exec vitest run apps/daemon/test/search-api.test.ts apps/daemon/test/search-sources-api.test.ts apps/daemon/test/search-indexer.test.ts --maxWorkers=2`：3文件9项通过。
- 共享来源比较收口后，`pnpm exec vitest run packages/agent-runtime/test/search-source-access.test.ts packages/agent-runtime/test/session-search-runtime.test.ts apps/daemon/test/search-sources-api.test.ts apps/daemon/test/search-api.test.ts --maxWorkers=2`：4文件17项通过。
- `pnpm typecheck`：根及e2e、11个workspace通过；共享协议收口后再次通过。`pnpm lint`通过ESLint、a11y、边界、源码约定、文档及版本检查；最后纯函数/类型调整另有对应四文件ESLint通过。
- `pnpm --filter @my-pi-harness/web build`：三Web类型面与正式产物通过；Vite保留既有大chunk提示，不以提高阈值隐藏。
- `pnpm --filter @my-pi-harness/daemon test:deployment --maxWorkers=2`：3文件7项通过，覆盖隔离生产源码、资源与启动依赖。

最终`pnpm format:check`、271篇文档检查、1140源文件导入边界、1211文件源码约定及`git diff --check`通过；不因提交重复全量测试。

## 浏览器

Playwright CLI在独立临时profile上使用本次Web产物、实际daemon/Pi及本机合成Provider，种入3轮持久消息，其中长来源为18913个UTF-16单位，含中英和🙂。实际点击搜索、打开来源并翻页：初始请求无分页字段，文本页只有textOffset，消息页只有cursor；文本页按既有规则禁用消息翻页，返回结果重新打开后正常进入消息分页。

首轮自动脚本错误地等待禁用消息按钮产生请求而超时；根据实际禁用状态改为上述合法操作顺序后通过，未改生产行为。文本段落无拆开的代理对；选择4001–12000字符引用后，待发引用可见、原草稿保留，真实Session API确认活动分支与Run不变。浏览器控制台0错误、0警告。截图`output/playwright/m6-governance-source-pages.png`和`m6-governance-quote-draft.png`已查看，临时浏览器、daemon、模型服务与profile已回收。

## 未验证范围

本轮没有改变检索排序、范围或调度，未重跑原真实本地模型质量/10400片段性能基准，沿用[M6证据](../202610301722_feature_m6-memory-search/verify.md)对应部分。不调用付费模型或真实GitHub/Google，不重新打包桌面应用，不扩张Windows/Linux、签名或真实账号结论。没有自动提交或清理真实数据。

## 提交前复核补充

2026-11-12按用户授权检查累计改动时，发现记忆搜索结果查询未声明memorySource元数据，更新或遗忘后的当前事实刷新无法命中已打开的结果列表。沿用来源阅读器的元数据声明，按实际搜索范围标记记忆结果，消息历史查询不受影响。真实QueryClient与QueryObserver证明当前结果重新读取、在途旧正文取消后不能回写；`pnpm exec vitest run apps/web/test/memory-cache.test.ts apps/web/test/search-lifecycle.test.ts apps/web/test/session-work-refresh.test.ts --maxWorkers=2`的3文件8项通过，Web三类型面及两文件ESLint/Prettier通过。历史请求采用正文仍保留，宿主权限、来源hash与检索算法未改变。
