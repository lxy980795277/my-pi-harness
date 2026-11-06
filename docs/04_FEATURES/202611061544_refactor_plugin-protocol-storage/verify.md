# 插件、协议与存储职责治理验证

日期：2026-11-06。产品版本0.18.3，协议24，SQLite10。环境为macOS arm64、仓库缓存Node 24.20.0、pnpm 10.34.6；所有命令在my-pi-harness根目录执行，PATH优先使用该Node。仅验证本轮M0及既有M1–M5维护，不进入M6，不改变原有外部验收状态。

## 结果

| 条件       | 结果 | 实际证据                                                                                                                                                                                  |
| ---------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1、UC-1 | Pass | 新plugins包拥有声明/资源、安装更新开关与授权生命周期；daemon保留HTTP和宿主适配，tools保留通用Skills。插件API、预览、同步、网关、MCP归属及办公CLI回归通过。                                |
| AC-2、UC-2 | Pass | 插件与高级账户共用integrations/oauth，明确保留各自scope、客户端认证和响应策略；非法Token字段、PKCE/state/issuer、ID Token claims、刷新撤销与固定安全诊断回归通过。未执行真实账户授权。    |
| AC-3、UC-3 | Pass | 本地向量Worker与Transformers生产依赖归daemon；既有4项Worker加载、分批、取消、关闭与安全错误用例通过，工具目录及Run能力回归保留。                                                          |
| AC-4、AC-5 | Pass | internal独立出口，EventInput/RequestAcceptance唯一定义；删除Storage纯转发文件和根类型别名。96项导入边界fixture覆盖允许与拒绝，部署probe确认私有Schema不在公开根出口。                     |
| AC-6、UC-4 | Pass | SessionQueries、SessionRecovery、ArtifactRepository分别拥有查询、启动重建及产物引用；ProfileStore保持唯一事务/fsync/失败冻结。真实临时JSONL/SQLite、附件、产物与任务回归25文件237项通过。 |
| AC-7、UC-5 | Pass | 12个workspace离线frozen安装、全仓静态/类型/构建通过；7项独立生产部署检查覆盖CLI、退出、恢复与资源。62份插件正文/脚本/manifest等资源字节保持，第三方packages/snapshots锁定解析保持。       |

## 执行的检查

| 命令或检查                                                                                               | 结果                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --offline --ignore-scripts`                                                                | Pass；新增workspace链接与依赖归属更新，无下载。                                                                                                              |
| `pnpm install --offline --frozen-lockfile --ignore-scripts`                                              | Pass；12个workspace，锁文件一致。                                                                                                                            |
| `pnpm format:check`                                                                                      | Pass。                                                                                                                                                       |
| `pnpm lint`                                                                                              | Pass；包含ESLint、a11y、976个源码导入边界、1046个源码约定文件、文档及版本检查。                                                                              |
| `pnpm typecheck`                                                                                         | Pass；根与E2E编译面、10个workspace任务，最终20.281秒。                                                                                                       |
| `pnpm test`                                                                                              | Pass；212文件通过、1文件按原条件跳过，2094项通过、2项按原条件跳过，91.18秒。                                                                                 |
| `pnpm test:artifact`                                                                                     | Pass；3文件7项，24.75秒。临时生产deploy通过源码exports与tsx加载，旧tools/plugins出口拒绝，插件及PDF资源均在deploy内；四个办公Skill物化后运行真实Python CLI。 |
| `pnpm build`                                                                                             | Pass；Web及Electron main/preload，2个任务，13.518秒。保留现有Web大chunk提示，未调整阈值。                                                                    |
| `pnpm exec vitest run packages/tools/test/skills apps/daemon/test/local-embedder.test.ts --maxWorkers=2` | Pass；5文件30项。                                                                                                                                            |
| Storage最终类型导入收尾的定向typecheck与Vitest                                                           | Pass；25文件237项，13.87秒，无运行行为变更。                                                                                                                 |
| 锁文件与资源只读比较、`git diff --check`                                                                 | Pass；packages/snapshots未变化，62份迁移资源字节一致，无空白错误。                                                                                           |

全量源码回归后仅删除了Storage的类型转发出口并迁移类型引用，已补跑Storage及全仓类型检查；不为纯类型出口清理重复整个运行时测试。提交、推送、真实账户、Browser/Electron视觉、正式安装器、签名及Windows/Linux未执行，不由本轮工程结果推导通过。

## 问题与修复

- 插件抽取首轮发现Vercel高级账户的Basic策略被插件默认body策略覆盖，以及办公测试仍假定PDF helper与插件位于同一资源根；分别保留高级账户策略和显式注入两个来源，原测试通过。
- 独立OAuth复核发现手工归一化弱于高级账户原SDK校验、Basic特殊字符编码和立即过期Token处理存在差异；统一使用SDK客户端认证及对应grant的响应处理器，补Token字段、nonce/issuer/audience、零过期时间和长refresh token回归。插件展示用途ID Token与缺省token_type通过显式策略管理，高级账户保持严格。
- 全量HTTP回归发现通用OAuth错误文字覆盖插件原有固定中文诊断；技术错误留integrations，插件用户提示由plugins/auth唯一拥有，原断言保持并通过。
- 首次将源码全量与部署检查并行时，长Agent循环和实际ESLint编译用例达到时间上限；两个文件45项单独复测通过，随后源码全量与部署分离执行通过。未调整超时、跳过用例或放宽断言。
- 首次全仓lint扫描与删除Storage类型转发文件同时发生，命中已删除文件产生ENOENT；源码收口后重新执行完整lint通过。没有保留兼容文件规避扫描。

## 独立复核

Store复核覆盖事务、重放、会话查询与产物引用，日志仍在SQLite提交前fsync，实时消息清理和产物引用转正仍在提交成功后发生。插件与OAuth复核覆盖身份/安装代、撤销、并发刷新、精确资源映射和网络限制；已发现问题均通过实际fixture修复。未发现额外状态副本、反向包依赖、旧插件路径或Storage共享类型转发残留。

## 提交元数据

用户后续明确要求本地提交，根产品版本与APP_VERSION同步为0.18.4，协议24、SQLite10保持。上文源码、构建与部署证据来自0.18.3候选实现；提交阶段只同步版本和发布记录，不重新生成桌面应用目录或扩大验收范围。提交钩子的实际执行结果另由提交时报告。
