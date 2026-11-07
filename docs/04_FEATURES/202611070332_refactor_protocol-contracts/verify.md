# 共享协议与模块数据归属整理验证

实现验证日期：2026-11-07。环境：macOS arm64、Node 24.20.0、pnpm 10.34.6。候选产品版本0.18.4，公开协议25，SQLite10，现有Session JSONL格式不变；后续提交版本见下方收口记录。

## 结论

本轮工程实现与本机源码、类型、静态、构建及隔离生产部署验证通过。只调整实际重复或归属明确不合理的内容；不推送、读取真实凭据或清理用户数据，M6及原有账号、Office视觉和平台验收状态保持。

## 实际调整与保留

- 统一配对、登录、模型认证挑战与Provider操作请求；统一高级账户和MCP各自的OAuth启动响应、Skill目录响应和ApiError。三类OAuth响应保持独立，界面窗口状态、原生路径检查及错误映射仍归原模块。
- 公开ProviderConfig去掉credentialRef；internal的ProviderRecord保留原持久字段和布局。Gateway明确选择公开字段，宿主凭据定位及配置更新/重启语义保持，不增加数据库迁移。
- 默认子Agent角色、指令和限制原样移到agent-runtime/subagents/default-settings；daemon向ProfileStoreOptions显式注入。ProfileStoreOptions归profile模块。默认读取不写库，缺配置且未注入时明确失败；完整配置首写只依赖已存revision，仍由0递增到1。
- ToolContentSchema/type统一执行、MCP投影和持久文本/图像块；保留原字符串与块数限制，外层ToolResult/McpCallOutcome及MCP特有安全处理继续独立。删除仅用于类型推导的ResolvedSessionCreateInputSchema，使用Required类型表达已解析输入。
- 保留initialWorkState、parseExternalUrl、公开事件数据、工具参数schema、领域运行接口、UI状态及合理的schema/type成对导出；不机械集中空请求、路由ID包装或IPC参数。

## 验收结果

| 范围                                | 结果与证据                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 / UC-1、UC-2：跨端请求与响应   | Pass；实际HTTP拒绝空值、越界、非法认证方式及附加字段；独立账户/MCP启动结果通过共享schema，目录响应在三端复用。非JSON和畸形错误保留HTTP兜底，401仍触发授权失效通知。 |
| AC-2 / UC-3：Provider公开与内部数据 | Pass；Gateway对象及HTTP创建/详情/列表/密钥响应无credentialRef，内部引用跨更新和重启保持，合成Key/OAuth读写与删除回归通过。原记录通过内部schema并被公开schema拒绝。  |
| AC-3 / UC-4：默认Agent策略          | Pass；原函数体原样迁移，真实临时SQLite读取不seed，无factory的缺配置读取失败，完整配置首写、旧revision拒绝和已存配置重读通过；主子执行及权限回归通过。               |
| AC-4 / UC-5：工具内容               | Pass；MCP结果、canonical工具结果落盘/回放及原边界拒绝回归通过，公共protocol不导出宿主内容schema。                                                                   |
| AC-5：无效schema与合理保留项        | Pass；无ResolvedSessionCreateInputSchema运行时消费者或旧导入，已解析输入类型及真实内部出口通过类型与部署检查。独立只读复核确认未混合不同授权流程或新增运行层依赖。  |
| AC-6：装配与文档                    | Pass；全仓类型、lint、Web/Electron构建和隔离部署通过，相关架构、API、技术说明与包README已同步。                                                                     |

## 实际检查

命令从仓库根运行，PATH优先使用缓存的Node 24.20.0。caffeinate只在命令执行期间防止闲置休眠；不修改项目配置或测试时限。

| 命令/检查                                     | 结果                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Provider定向回归                              | Pass；6文件53项。                                                                                                                 |
| 默认配置、子Agent、工具内容及任务展示定向回归 | Pass；8文件71项。                                                                                                                 |
| HTTP/OAuth、Desktop目录及Web错误处理定向回归  | Pass；8文件90项。以上范围部分重叠，不累加为全仓数量。                                                                             |
| `pnpm lint`                                   | Pass；含ESLint、a11y、980个源码导入边界、1050个源码约定文件、文档及版本检查。                                                     |
| `caffeinate -i pnpm typecheck`                | Pass；根源码、E2E及10个workspace任务全部通过，14.995秒。                                                                          |
| `pnpm build`                                  | Pass；Web与Electron main/preload构建通过，12.456秒。保留既有大chunk与renderer配置提示，不据此扩大本轮范围。                       |
| `caffeinate -i pnpm test --maxWorkers=2`      | Pass；212文件通过、1文件跳过，2108项通过、2项按原条件跳过，133.54秒。                                                             |
| `caffeinate -i pnpm test:artifact`            | Pass；3文件7项，13.98秒。临时生产deploy从源码exports/tsx启动，宿主私有schema不进入公开出口，随包插件及办公Skill资源可读取和运行。 |
| `pnpm format:check`                           | Pass；全仓文件符合Prettier格式。                                                                                                  |
| `node scripts/check-docs.mjs`                 | Pass；260份文档的结构和链接检查通过。                                                                                             |
| `git diff --check`                            | Pass。                                                                                                                            |

## 超时复核

首次默认4个worker运行有4项超时，其余2104项通过：长工具循环达到fixture的7秒期限，两个实际ESLint编译用例达到10秒期限。两个文件单worker复测中44项通过，仅一个ESLint用例仍超时。没有出现对应的数据或行为断言失败。

随后2个worker全量运行时，原4项全部通过，但另外4项出现约913至1012秒的异常耗时。pmset记录确认运行期间04:04:40休眠914秒、04:20:40休眠1012秒，与异常耗时一致。最终在命令期间防止闲置休眠，保持2个worker及原时限/断言，整套源码测试通过。仓库默认worker设置仍为4，没有放宽测试、增加跳过或修改产品逻辑处理这些环境超时。

## 未验证

未执行真实外部OAuth/Provider、浏览器或Electron视觉体验、正式安装器、签名、公证及Windows/Linux验收。自动HTTP与临时部署证据不代替这些外部和平台结果。本轮不清理数据库、会话或用户工作区。

## 提交收口（2026-11-08）

用户后续明确要求本地提交，根产品版本与APP_VERSION同步为0.19.0，发布记录见[0.19.0](../../06_RELEASES/0.19.0.md)。公开协议25、SQLite10与上述会话格式保持；Provider公开字段移除要求客户端同步更新，不需要清理现有数据。

上述行为与构建证据来自0.18.4候选实现，提交阶段只同步版本和发布元数据，不重新生成桌面应用目录或扩大平台验收范围。提交钩子的实际执行结果由提交完成时报告。
