# 会话日志精简验证

日期：2026-10-27。实现验证阶段产品0.9.1，公开协议17，SQLite schema8，宿主JSONL批次3；macOS arm64、Node24.20.0、pnpm10.34.6、Chromium。本轮属于M0工程范式及M1–M4维护，不启动M5。用户后续授权删除旧会话并按0.10.0执行本地提交流程，不推送。

## 实现与数据边界

新批次仅有version、records、checksum，删除batchId、previousBatchId、外层sessionId和firstSeq。逐事件归属、连续seq、内容校验和、完整行及fsync仍生效；旧v2明确拒绝，没有生产迁移或兼容读取分支。

privateData与模型codec、队列绑定和请求messages使用原生对象/数组。snapshotPrivateData复制JSON值并保留原有可选undefined清理行为；SDK后续修改不能改变已冻结消息。SQLite private_data仍是TEXT字段，以JSON对象映射读写，不修改历史SQL或表版本。完整请求审计只保存在JSONL，SQLite事件查询投影不再重复保存整份context.prepared私有数据；相关测试验证重启前后公开统计与来源保留且private_data为null。

journal-codec在同Run、同branch中将不变请求消息替换为前一次快照索引，systemPrompt可以引用首system消息正文；工具展示文本与同批canonical文本完全相等时使用显式正文引用。不同、被截断或更丰富的结果完整保留。读取先校验磁盘checksum，再恢复逻辑records，返回records数组而非带无效checksum的解压批次。Run结束清空基线，失败写入不推进基线，下载仍是已提交原始字节。

独立交叉审查核对键顺序、分支/Run/Session隔离、末行修复、写入失败冻结、原字节下载及模型历史重建，未发现实质问题。实现阶段对原用户日志仅做只读测算；后续用户明确要求删除旧会话，清理结果见本记录末尾。

## 静态、源码及构建

实际执行pnpm typecheck，全8项workspace任务通过；runtime最终变更另经本包tsc通过。最终pnpm lint通过，覆盖752个源码导入、812个源码约定文件、176个当时已存在文档及版本一致性；新增verify后另检查文档与格式。

实际执行pnpm test：156文件通过、1文件跳过，1589项通过、2项跳过，59.66秒。定向分组有交集，不累计为唯一总数：journal/codec两文件60项、runtime22文件161项、storage/daemon七文件49项均有通过记录；context-work补充SQLite不重复保存私有审计的7项再次通过。所有测试仅使用隔离profile与合成凭据。

实际执行pnpm build，8项任务全部实际构建通过、0缓存，14.052秒。固定Node24后执行pnpm test:artifact，2文件6项通过，10.23秒。此前另有Node25补充运行，未作为本轮正式产物证据。未重新生成Electron安装器或执行安装、签名、公证和Windows验收；既有renderer配置与大chunk提示未扩大处理。

## 浏览器

固定Node24执行pnpm exec playwright test tests/e2e/session-log.spec.ts --output=output/playwright/session-journal-compaction-log-20261027，3项通过，10.9秒；覆盖新v3日志下载、原始文件内容及已提交前缀。

显式设置MY_PI_HARNESS_OFFICE_PYTHON为本仓库.cache/office-venv/bin/python后执行：

```sh
pnpm exec playwright test tests/e2e/m1.spec.ts tests/e2e/m2-completion.spec.ts tests/e2e/m3.spec.ts tests/e2e/plugin-connection.spec.ts tests/e2e/skills-plugins.spec.ts tests/e2e/office-artifact.spec.ts --grep '配置兼容 API|停止保留队列|完整工具链|M3 |GitHub 授权与应用目录跨重启恢复|创建 Skill 后|按需加载办公工具' --output=output/playwright/session-journal-compaction-20261027
```

首轮11项通过、旧M2审批前置条件用例失败。修复测试显式选择请求批准后，Node24单独重跑tests/e2e/m2-completion.spec.ts，1项通过、7.2秒，原审批/文件修改/Shell/私网拒绝/SDK工具ID复用和刷新历史断言均保留。总计15个不同浏览器场景通过；没有重跑已通过的其余11项。

验证覆盖真实Pi请求组装、流式回复与刷新、编辑分支、停止保留队列并显式恢复、文本/图片附件、规则引用、计划反馈与批准、手动快照及两类重置、摘要版本比较、GitHub插件授权后启用App并跨重启自动发现、Skill上下文和真实Python Worker创建/下载DOCX。供应商OAuth和模型使用合成上游，未声明新的真实账号、模型费用或Office页面视觉验收。

## 只读体积测算

以用户提供的b5dec3fb旧日志为输入，仅在内存JSON.parse其已编码私有值与请求消息，保持原批次边界和全部事件，调用新构建encodeJournalRecords/decodeJournalRecords。逐批比较JSON.stringify恢复记录与完整逻辑记录完全一致，再按v3正文计算SHA-256及UTF-8行字节。读取前后原文件hash一致；这段测算不是产品旧格式支持，也没有生成迁移后的用户文件。

| 指标                   | 结果                  |
| ---------------------- | --------------------- |
| 原日志                 | 4,793,736字节         |
| 仅v3字段及原生对象表示 | 3,904,365字节         |
| 完整精简编码           | 1,534,383字节         |
| 减少                   | 3,259,353字节，67.99% |
| 保留事件/事务          | 1,180事件，1,148批    |
| 请求消息/工具正文引用  | 683 / 30              |
| 完整回放及键顺序       | 逐批相同              |
| 结束后基线             | 空                    |

AC1–AC5与UC1–UC4在上述工程范围通过。该结果只证明样例的存储精简与恢复等价，不是吞吐、首token延迟或不同任务之间的性能基准。

实现验证阶段最终pnpm format:check、pnpm typecheck、177文件文档检查、812文件源码规范检查及git diff --check均通过。当时暂存区为空，产品版本、公开协议、历史SQL迁移与锁文件没有该阶段改动；后续提交版本同步见下文。

## 用户授权的旧数据清理与提交准备

用户明确要求直接删除旧session并允许清理数据库。先核对PID命令及打开文件，正常终止本项目Electron开发watcher、桌面主进程和daemon，确认三者全部退出；没有按进程名批量终止或修改参考仓库。

已清理本项目桌面与独立daemon两个已确认profile：取得各自owner.sqlite排他锁，在事务内按外键顺序清空tool_contexts、tool_calls、branch_messages、work_states、checkpoints、requests、queued_inputs、events、messages、runs、branches、sessions和attachments共13表，并删除对应本仓库session namespace。桌面profile实际删除3份JSONL、3个会话、11个Run、139条工具、141条消息及10696条事件；另一个profile原会话为空，清理后仍为空。两个namespace均无附件文件。

Provider、工作区、应用设置、auth\_\*登录、MCP、插件、连接配置及迁移表行数在事务前后相同；外键检查通过。保留owner.sqlite文件、独立凭据文件及系统钥匙串。清理后checkpoint/VACUUM数据库，使用新构建openProfileStore分别重新打开，两者会话列表均为空、没有旧格式恢复错误；没有启动模型或工具请求。

提交产品版本与生成APP_VERSION同步为0.10.0，公开协议17与SQLite schema8仍不变，发布说明单独记录JSONL2→3的不兼容。源码、构建与浏览器的既有通过结果复用，提交钩子继续按仓库配置执行。未重新创建旧格式兼容层，也未清理模型、工作区或插件配置。
