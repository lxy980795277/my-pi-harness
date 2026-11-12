# 共享数据目录验证

2026-11-12，产品0.19.1，macOS arm64，Node24.20.0用于测试、类型与构建。公开协议28、SQLite和日志格式不变；本轮未提交。

## 结果

| 用例         | 结果                   | 证据                                                                                                     |
| ------------ | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| UC1 默认切换 | Pass（配置与服务回归） | daemon默认解析与桌面child透传分别验证；macOS默认指向原桌面数据目录，不依赖Electron userData或启动cwd     |
| UC2 显式覆盖 | Pass                   | 真实Node child验证env-file配置及进程环境优先，桌面不再注入另一个profile；daemon原有绝对路径校验保留      |
| UC3 共用历史 | Pass（HTTP与存储）     | 临时桌面形态服务完成实际Pi合成回复，关闭后Web形态新客户端读取同一消息、分支和设置，JSONL字节保持         |
| UC4 重复持有 | Pass                   | 第一服务持有profile时，第二服务初始化明确抛出ProfileLockedError                                          |
| UC5 隔离验证 | Pass（源码）           | smoke环境显式传入已seed的临时PROFILE；Electron userData继续隔离Cookie/cache。本轮未重新打包运行原生smoke |

## 实现与真实数据保护

daemon的loadDaemonConfig唯一决定profile。macOS默认固定沿用`Application Support/@my-pi-harness/desktop/profiles/default`，Windows原LocalAppData规则保持；desktop删除ProfilePaths/resolveProfileDirectory及基于Electron userData的强制覆盖，原文件改为只拥有日志根的session-log-root。没有新增跨包默认解析层、目录探测、数据迁移或实例接管。

通过只读配置解析、文件存在性及日志数量检查确认：新默认仍对应原桌面profile和`12db850fbe58815dbcd4b9d590e078bb6a06c443bbc5c3b794e50b849cd8cf0e`日志分区，检查时有5个JSONL文件；用户运行期间可以继续新增日志，因此不以诊断时的4条作为不变计数。未启动该真实profile进行测试，不移动或删除数据库、日志、附件、凭据、根.env或另一套旧目录，也未主动停止用户实例。

## 自动检查

- `pnpm exec vitest run apps/daemon/test/config.test.ts apps/daemon/test/profile-sharing.test.ts apps/desktop/test/daemon.test.ts apps/desktop/test/session-log-root.test.ts --maxWorkers=2`：4文件55项通过。共享历史测试加强清理、completed状态及精确回复断言后单文件1项复跑通过；桌面测试按边界调整后单文件13项复跑通过。
- `pnpm typecheck`：根/e2e与11个workspace任务通过；最终测试调整另有daemon和desktop-main定向tsc通过。
- `pnpm lint`首轮在新测试的同步saveSettings上发现无效await；移除后对应文件ESLint通过。后续边界检查拒绝桌面测试直接导入daemon私有配置，已删除该导入和生成夹具中的同类引用；桌面测试负责透传，daemon测试负责解析，没有放宽gate或增加公开测试出口。
- 全仓ESLint覆盖后修正文件定向ESLint通过；`pnpm lint:a11y`、`check-boundaries`（1139源文件）、`check-source-conventions`（1210文件）、`check-docs`及`pnpm version:check`分别通过，不声称首轮lint命令整体成功。
- `pnpm format:check`通过；最终验证、Spec与索引另做定向格式检查。
- `pnpm --filter @my-pi-harness/desktop build`：main/preload产物通过，保留既有renderer config提示，不添加无关配置。
- `git diff --check`通过。架构、桌面/后端/测试约束、登录与存储说明同步，历史验收记录保持。

## 未验证范围

未操作真实账号、付费模型或系统凭据；未重新运行原生Electron、安装包、完整desktop smoke或Windows实机。跨入口共享的实际执行证据来自临时Node服务、Pi合成模型、HTTP与SQLite/JSONL；不将其等同于原生平台验收。两个前端同时使用同一profile时应连接同一daemon，继续保留排他锁，不支持两个daemon并发写同一个库。
