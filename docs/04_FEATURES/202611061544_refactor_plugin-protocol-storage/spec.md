# 插件、协议与存储职责治理

## Spec

### Roadmap Alignment

属于M0与既有M1–M5维护。M6继续仅规划，既有平台、真实账号与办公质量验收缺口保持；不新增产品能力，不改变公开HTTP/SSE字段、会话落盘格式、协议24或SQLite10。

### Intent

建立独立plugins包统一插件资源、贡献和生命周期，收紧integrations的外部接入职责；明确protocol公开与宿主内部入口，统一提交数据类型；拆清ProfileStore中的查询、恢复和资源职责，同时保持单一事务与提交顺序。

### Constraints

- 用户已授权按确认方案连续实施，并在后续明确要求本地提交；按0.18.4同步版本和发布记录，不推送，不读取真实.env、凭据或会话数据。
- Skills保持tools/src/skills，不新增skills包。插件提供的SKILL.md及脚本随plugins包保存，通用发现、安装、冻结和资源租约继续由tools拥有。
- plugins拥有插件声明、资源、安装/启停/更新/卸载与授权生命周期；通用OAuth机制、MCP协议和受控网络由integrations拥有；daemon保留HTTP、配置、持久化适配与应用装配。
- tools不反向依赖plugins；plugins不直接导入storage、agent-runtime、Fastify或Renderer。宿主通过窄接口注入状态、凭据、Skill与MCP操作。
- 本地搜索实现移出integrations，不改变搜索、模型或回退行为；不为两份Worker文件新增package。
- protocol根入口只导出公开跨端数据；宿主内部数据通过显式internal出口消费，Renderer不能导入internal。共享EventInput与RequestAcceptance只有一个定义。
- 保留日志提交、fsync、SQLite事务、写入失败冻结与提交后发布顺序；拆分依据职责，不拆空壳转发，不引入第二份状态或恢复流程。
- 后端保持源码exports与Node/tsx运行；同步实际资源、部署、测试和规则入口，不保留旧路径兼容文件。

### Acceptance Criteria

- AC-1：plugins包拥有全部插件声明/资源与领域行为；tools与integrations不再保留第二份插件模块，Skills功能及工具声明保持。
- AC-2：插件OAuth与高级账户复用通用授权机制，账户归属、安装代、撤销、刷新、错误脱敏及网关限制保持；MCP仍由原协议层拥有。
- AC-3：本地向量Worker归正确宿主模块，首次加载、取消、关闭及搜索回退的现有行为通过回归。
- AC-4：公开protocol入口不导出宿主私有恢复/授权/流式覆盖类型；宿主消费者迁移internal入口，合法导入通过、Renderer和未声明入口实际拒绝。
- AC-5：EventInput与RequestAcceptance定义唯一，runtime与storage不互相依赖具体实现。
- AC-6：ProfileStore保留profile生命周期和单一事务编排，独立会话查询/恢复职责由对应模块拥有；真实临时JSONL/SQLite的提交、失败、重建、分支、任务、附件与产物回归通过。
- AC-7：依赖、锁文件、源码/规则覆盖、随包资源和当前架构/技术文档同步；静态、类型、相关行为及独立生产部署检查通过。

## UseCase

- UC-1：安装并启停内置插件，查看插件和Skill详情，注册对应Skill/MCP贡献；独立用户与工作区Skills仍可管理。
- UC-2：启动插件授权、完成回调、刷新和撤销；高级账户使用相同OAuth机制并保持独立账户状态，非法回调、网络和秘密响应继续拒绝。
- UC-3：运行中搜索并加载工具/Skill，使用冻结资源；取消或关闭回收Worker与资源，已撤销插件不能继续新派发。
- UC-4：主子Run提交完整事件，前端接收公开快照；重启从同一日志重建，损坏/未提交批次及持久化失败继续明确处理。
- UC-5：隔离部署仅携带生产依赖与源码资源，从临时cwd启动后能读取插件与办公Skill，不回退源码仓库。

## Tasks

- [x] T0：核对真实目录、消费者、当前约束与干净工作区，记录确认范围。
- [x] T1：抽取plugins资源与领域服务，定义宿主注入接口，统一通用OAuth机制。
- [x] T2：分离protocol公开/internal入口，归一提交类型并迁移全部消费者。
- [x] T3：拆分Store会话查询与恢复，保持唯一提交/锁/失败冻结所有权。
- [x] T4：迁移本地搜索，调整Skill资源装配与依赖/规则/部署入口。
- [x] T5：同步当前架构、包README与技术文档，执行针对性回归与部署检查。
- [x] T6：独立复核冗余、依赖方向和行为保持，实际验证结束后记录verify。

## Issues

实施中发现并修复OAuth认证/响应校验差异、资源根耦合及固定诊断覆盖；并发检查的超时与扫描竞态经分离执行复核。根因、实际检查和未验证范围见[验证记录](verify.md)。
