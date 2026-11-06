# ESLint配置归入仓库工程工具

## Spec

### Roadmap Alignment

属于M0仓库治理。既有M1–M5功能、协议24、SQLite10及M6规划状态保持，不改变平台、账号或办公能力验收范围。

### Intent

将仅由根配置和本仓测试使用的ESLint配置及自定义规则迁入scripts/eslint，取消没有独立复用需求的workspace包。根eslint.config.js保持唯一配置入口，原有规则与验证能力保留。

### Constraints

- 用户已授权实施并在后续明确要求本地提交，按0.18.3同步版本与发布记录，不推送。
- 配置和规则分为config.js、frontend-rules.js，不将全部实现合并到根配置，也不改规则行为、开关、覆盖面或TypeScript编译程序。
- 四个lint实现依赖归根devDependencies，继续使用原catalog版本；根已声明的eslint保持，不创建新的兼容包或转发入口。
- JavaScript配置由普通Node加载，保留相对引用的实际.js扩展；不引入tsx启动要求。
- 不更改业务代码、模型/工具声明、持久化格式或用户数据，不读取真实.env与凭据。

### Acceptance Criteria

- AC-1：scripts/eslint拥有原配置及自定义规则，根配置和测试引用真实文件；packages/eslint-config及其workspace引用、依赖记录移除，无残留安装链接。
- AC-2：四个实现依赖仅按职责移动到根devDependencies，lockfile依赖版本及生产依赖语义保持，安装与frozen校验通过。
- AC-3：配置和自定义规则内容保持；现有前端合法/拒绝fixture、各类文件覆盖测试及必要的workspace配置继承验证通过，根pnpm lint实际加载新位置并通过。
- AC-4：架构、当前入口文档及README同步，历史Spec/验证保留事实；格式、文档和变更范围检查通过。

## UseCase

- UC-1：从根执行pnpm lint，通过新的本地JS模块加载相同ESLint/React/Zustand规则，原有非法用例仍拒绝。
- UC-2：workspace的eslint执行继承根配置，parser tsconfigRootDir仍指向仓库根，不受规则文件迁入scripts影响。
- UC-3：按新manifest安装后移除旧workspace链接，普通Node可导入本地配置及规则，无需旧包或loader。

## Tasks

- [x] T0：核对真实消费者、当前边界和干净工作区。
- [x] T1：迁移本地配置与规则，更新根入口和测试。
- [x] T2：迁移开发依赖、刷新锁文件并清理旧包。
- [x] T3：同步文档、运行针对性测试和根lint。
- [x] T4：记录行为保持证据及验证范围。
