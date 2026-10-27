# 功能文档

每个功能、修复或重构使用 `YYYYMMDDHHmm_category_name/` 目录。前12位连续写日期与24小时制分钟，中间不加分隔符，采用北京时间 `Asia/Shanghai`；category为 `feature`、`fix` 或 `refactor`，name使用kebab-case，例如 `202610150930_feature_workspace-execution/`。分钟取建立Spec时的时间，不随修改或验收重命名；同一功能的后续小修更新原Spec，独立范围另建目录。

已迁移历史目录的分钟是按任务先后补齐的排序估计，不代表已核实的开发开始时间；原有正文中的验证日期与证据保持原样。历史估时和本次迁移证据见[目录迁移Spec](202610151511_refactor_feature-document-timestamps/spec.md)。文档检查拒绝旧格式、非法日期/分钟或缺少spec.md的目录。

目录先有 `spec.md`，验证结束后才有 `verify.md`。用户补充或调整需求时更新Spec及相关任务，不让后续实现依赖遗漏的口头约定。

## spec.md

按以下顺序维护：

| 部分    | 内容                                                                                |
| ------- | ----------------------------------------------------------------------------------- |
| Spec    | Roadmap Alignment、Intent、Constraints、Acceptance Criteria；状态、范围及已接受决定 |
| UseCase | 每条UC的前置条件、操作步骤、预期结果和异常路径                                      |
| Tasks   | 按依赖顺序排列的可执行checkbox，与AC或UC关联                                        |
| Issues  | 已发生问题的根因、复现、解决方案和预防规则                                          |

AC写可观察结果，不用「完善」「支持全部」代替具体条件。Task完成只表示工作已实施，不能代替AC验证通过。

## verify.md

验证结束后由执行者记录日期、应用版本、环境、UC/AC结果、实际检查命令、人工观察证据与未验证项。用 `Pass / Fail / Not verified` 区分结果；整体结论反映剩余必要验收项。

不提前创建成功记录，不将用户尚未执行的体验检查写成已通过，不用静态检查冒充安装包或真实Provider验证。

## 当前Spec

- [后端模块组织与职责治理](202610271743_refactor_backend-module-governance/spec.md)

- [应用初始化与统一加载](202610221610_feature_application-initialization/spec.md)

- [前端状态职责整理](202610201707_refactor_frontend-state/spec.md)

- [M4前代码治理](202610201450_refactor_m4-readiness-governance/spec.md)

- [对话渲染与交互](202610191647_feature_conversation-rendering/spec.md)

- [M0 工程底座](202610130900_feature_project-foundation/spec.md)
- [M0 验证证据与平台限制](202610130900_feature_project-foundation/verify.md)
- [M0 规范与架构审计](202610131000_refactor_m0-standards-audit/spec.md)
- [M0 规范审计验证](202610131000_refactor_m0-standards-audit/verify.md)
- [M1 模型与会话](202610131100_feature_model-session/spec.md)
- [M1 验证证据与平台限制](202610131100_feature_model-session/verify.md)
- [M1.6 模型设置与代码规范](202610140900_feature_model-settings/spec.md)
- [M1.6 验证证据与平台限制](202610140900_feature_model-settings/verify.md)
- [Provider与侧栏精简](202610150900_refactor_provider-navigation/spec.md)
- [Provider与侧栏验证](202610150900_refactor_provider-navigation/verify.md)
- [M2 工作区、交互基线与工具执行](202610150930_feature_workspace-execution/spec.md)
- [M2 验证证据与平台限制](202610150930_feature_workspace-execution/verify.md)
- [设置加载态与滚动条修复](202610151300_fix_settings-loading-scroll/spec.md)
- [设置界面修复验证](202610151300_fix_settings-loading-scroll/verify.md)
- [工作区导航密度与图标](202610151400_refactor_workspace-navigation/spec.md)
- [工作区导航验证](202610151400_refactor_workspace-navigation/verify.md)
- [功能文档分钟目录迁移](202610151511_refactor_feature-document-timestamps/spec.md)
- [功能文档目录迁移验证](202610151511_refactor_feature-document-timestamps/verify.md)
- [M2 剩余功能与执行收尾](202610151515_feature_m2-completion/spec.md)
- [M2分步收尾验证](202610151515_feature_m2-completion/verify.md)
- [工作区选择与自定义图标](202610151534_feature_workspace-creation/spec.md)
- [工作区选择与图标验证](202610151534_feature_workspace-creation/verify.md)
- [M2最终检查与提交](202610151555_refactor_m2-finalization/spec.md)
- [M2最终验证与暂缓项](202610151555_refactor_m2-finalization/verify.md)
- [输入框回车发送](202610151621_fix_composer-enter-send/spec.md)
- [输入框回车发送验证](202610151621_fix_composer-enter-send/verify.md)
- [M3 上下文与交互](202610151655_feature_m3-context-interaction/spec.md)
- [M3统一验证与平台限制](202610151655_feature_m3-context-interaction/verify.md)
- [审批模式与会话JSONL镜像](202610151800_feature_approval-session-jsonl/spec.md)
- [审批与JSONL验证](202610151800_feature_approval-session-jsonl/verify.md)

- [代码治理与可读性](202610161244_refactor_code-governance/spec.md)
- [M3收尾复核与核心技术文档](202610161259_refactor_m3-review-technical-docs/spec.md)
- [M4 MCP、Skills与插件任务拆分](202610201932_feature_m4-capabilities/spec.md)
- [M4实施任务、模块归属与完成门槛](202610201932_feature_m4-capabilities/tasks.md)
- [M4.1本地MCP验证](202610201932_feature_m4-capabilities/verify.md)
- [M4工程实现与本机联调验证](202610201932_feature_m4-capabilities/m4-completion-verify.md)
- [M4插件连接与任务工作流补齐验证](202610201932_feature_m4-capabilities/plugin-completion-verify.md)
- [M4前置：用户身份与应用登录](202610161500_feature_application-login/spec.md)

- [应用登录验证与真实账号review](202610161500_feature_application-login/verify.md)

- [M3复核与M4前代码治理](202610191506_refactor_m3-readiness-governance/spec.md)
- [M3复核、治理修复与M4准备结论](202610191506_refactor_m3-readiness-governance/verify.md)
