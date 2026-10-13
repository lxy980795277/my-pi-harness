# 功能文档

每个功能、修复或重构使用 `YYYYMMDD_category_name/` 目录，category为 `feature`、`fix` 或 `refactor`。保留已确认的目录格式；普通文件使用kebab-case。

目录先有 `spec.md`，验证结束后才有 `verify.md`。用户补充或调整需求时更新Spec及相关任务，不让后续实现依赖遗漏的口头约定。

## spec.md

按以下顺序维护：

| 部分    | 内容                                                             |
| ------- | ---------------------------------------------------------------- |
| Spec    | Intent、Constraints、Acceptance Criteria；状态、范围及已接受决定 |
| UseCase | 每条UC的前置条件、操作步骤、预期结果和异常路径                   |
| Tasks   | 按依赖顺序排列的可执行checkbox，与AC或UC关联                     |
| Issues  | 已发生问题的根因、复现、解决方案和预防规则                       |

AC写可观察结果，不用「完善」「支持全部」代替具体条件。Task完成只表示工作已实施，不能代替AC验证通过。

## verify.md

验证结束后由执行者记录日期、应用版本、环境、UC/AC结果、实际检查命令、人工观察证据与未验证项。用 `Pass / Fail / Not verified` 区分结果；整体结论反映剩余必要验收项。

不提前创建成功记录，不将用户尚未执行的体验检查写成已通过，不用静态检查冒充安装包或真实Provider验证。

## 当前Spec

- [M0 工程底座](20261013_feature_project-foundation/spec.md)
- [M0 验证证据与平台限制](20261013_feature_project-foundation/verify.md)
