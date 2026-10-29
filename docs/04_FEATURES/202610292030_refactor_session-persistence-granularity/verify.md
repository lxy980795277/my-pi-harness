# 会话消息持久粒度验证

日期：2026-10-29，北京时间。macOS arm64、Node24.20.0、pnpm10.34.6、Chromium；产品0.12.0，公开协议20、SQLite schema9。工程实现与本机自动化验证通过，旧会话已按授权清理；尚未提交或推送。

## 实现与验收

AC-01 / UC-01：message.delta只经publishMessageDelta更新LiveMessages内存覆盖层并发轻量通知，不分配持久事件ID/seq，不进入JSONL或SQLite。storage回归将相同1000字符分别一次和1000次发布，最终均恰好3行、相同持久事件集合和完整快照；另一SQLite连接持有写锁时仍能publish，data_version、事件、消息和日志字节不变。旧持久delta与误用append明确拒绝。

AC-02、03 / UC-01–03：主/子快照和分页详情合并各自partial，普通持久事实及queue.added穿插后保留正文。持久seq前进时liveRevision归零，纯实时变化只增加revision；HTTP、SSE patch和任务详情按双水位留新。真实HTTP/SSE覆盖同seq/rev3、重连完整partial、终态seq+1/rev0；客户端覆盖迟到、重复、缺口、精确双基线和清理。纯live不重读工作状态，子delta不重建根聊天。

AC-04 / UC-03、04：正常取消/失败的空SDK final保留已展示正文、思考及原签名，完整终态一次落盘且重开相等；失败材料不进入模型历史。SQL回滚/fsync不确定失败保留覆盖层并冻结后续append和publish。真正SIGKILL后不恢复未完成内存片段，只保留同ID空中断占位、推进seq/rev0，先前正常取消及完整消息保持，无自动模型重跑。

AC-05 / UC-05：工具审批、派发屏障与终态继续持久，当前没有工具临时进度生产者，不预建空接口；MCP unknown恢复不变。完整模型codec、请求上下文、canonical工具结果及磁盘引用保留。浏览器下载验证运行中快照可见partial而日志不含它，结束后保存完整正文；旧下载字节不变，所有下载无message.delta。

AC-06：工程检查及授权数据清理见下文。未新增依赖、兼容分支或进程epoch，未处理此前单独搁置的预算通用错误文案。

## 实际检查

命令先将仓库.cache/node/node-v24.20.0-darwin-arm64/bin加入PATH；普通检查使用临时profile、动态端口、合成模型和认证，不调用真实供应商或读取.env/系统凭据。

| 命令 / 范围                                                                                                                                                                                      | 结果                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| storage定向4文件                                                                                                                                                                                 | 76项通过；storage类型及相关ESLint通过。                                                                                                                            |
| runtime定向5文件                                                                                                                                                                                 | 32项通过；运行时类型及相关ESLint通过。                                                                                                                             |
| daemon/Web定向8文件                                                                                                                                                                              | 52项通过；protocol/Web类型及相关ESLint通过。定向结果不与全量重复累计。                                                                                             |
| pnpm typecheck                                                                                                                                                                                   | 全workspace、根程序及E2E通过，8任务成功。最终测试调整后另执行tsc -p tests/e2e/tsconfig.json --noEmit及tsc -p apps/daemon/tsconfig.json --noEmit通过。              |
| pnpm test                                                                                                                                                                                        | 180文件通过、1文件跳过；1754项通过、2项跳过，58.49秒。                                                                                                             |
| pnpm build                                                                                                                                                                                       | 8任务成功，14.319秒；保留既有renderer config和大chunk提示。                                                                                                        |
| pnpm test:artifact                                                                                                                                                                               | 首轮6项中5项通过；一项仍断言SIGKILL前partial持久，与新语义冲突。同步明确的新恢复断言后，单跑test/recovery.built.test.ts两项通过，10.71秒；其他已通过产物证据复用。 |
| pnpm exec playwright test tests/e2e/m1.spec.ts tests/e2e/m3.spec.ts tests/e2e/m5.spec.ts tests/e2e/conversation-rendering.spec.ts tests/e2e/session-log.spec.ts tests/e2e/answer-process.spec.ts | 最终构建26项全通过，约1.2分钟，覆盖流式、队列/分支、上下文/提问、子任务、过程折叠、Markdown/阅读及日志下载。                                                       |
| pnpm format:check；pnpm lint                                                                                                                                                                     | 格式、ESLint、a11y、852源码导入、918文件源码约定、200文件文档及版本检查通过；本verify随后加入，单独完成文档检查。                                                  |

日志下载测试将生成中“已提交”改为准确的“已显示”，断言liveRevision大于0而下载不含partial；完成后包含完整正文。M5固定任务入口使header已有两个按钮，断言同步准确数量；下载失败重试、离开取消、文件字节一致性和原模型请求数断言保留。恢复测试明确区别正常取消与SIGKILL，不延长超时或删除无自动重跑检查。

## 已授权数据清理

确认两个本项目profile均无running Run后，正常SIGTERM结束cwd确认为本项目的开发launcher，等待4311及5174监听关闭；没有操作pi-harness开发实例。在各profile原owner.sqlite取得排他锁后清空会话、Run、消息、队列、事件、工具、工作状态、附件索引及存在的Task/通信投影，保留独立配置表。

desktop命名空间删除2份旧JSONL，合计21658267字节，清除对应附件目录；独立daemon原无会话。SQLite执行secure_delete、WAL checkpoint和VACUUM，完整性检查通过；两个profile全部会话表及当前日志数均为0。

独立配置按表排序内容计算前后指纹，两个profile分别20/21张独立表均一致，包括Provider、默认设置、工作区、应用身份/登录、MCP/插件配置及schema记录。系统凭据、插件凭据文件、.env、工作区源文件和其他项目数据未删除；没有改写旧日志做兼容。

清理后用构建的openProfileStore打开真实desktop profile并关闭，结果为0个Session、6个Provider；未调用模型或其他服务。开发实例保持关闭，用户可自行执行pnpm run dev:desktop启动新协议。

## 验证边界

本轮不代表真实供应商延迟/费用、真实服务账号、Electron窗口/安装包或Windows实机验收。正常完成/取消/失败保存完整已观测消息，真正崩溃前未完成的内存片段不恢复。未自动重做外部副作用，产品版本未变更，尚未提交。
