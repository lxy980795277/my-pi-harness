# M1.6 统一验证

日期：2026-10-15。应用0.1.0；macOS26.5.1 / arm64、Node24.20.0、pnpm10.34.6、Electron43.7.9。本次模型设置、四份规范与现有代码整改已完成本机自测，交付用户统一体验验收；未提交或推送。既有M1工作区改动保留，没有重建或迁移用户真实profile。

后续六厂商目录与侧栏调整的增量证据见[Provider与侧栏验证](../202610150900_refactor_provider-navigation/verify.md)；本页保留当时执行结果。

## 已交付与验收覆盖

| 条件               | 结果与证据                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 设置与会话   | Pass；shadcn设置Dialog和Provider/模型二级Dialog，关闭恢复焦点，保留未发送聊天草稿。真实Chromium和macOS发布包均打开设置，浅深及900×700窗口实际查看。              |
| AC-02 Provider粒度 | Pass；20个内置厂商固定顺序与单例入口，仅custom可创建/删除；自定义允许先保存空模型并明确关闭Key要求。                                                             |
| AC-03 模型管理     | Pass；内置目录只读，custom独立编辑与逐模型测试，批量原子保存、revision冲突和高级字段保留有服务测试；草稿提交使用初始revision。                                   |
| AC-04 默认选择     | Pass；默认模型/思考等级持久化，新会话在服务中解析并保存明确选择。重启测试、禁用/删除后拒绝创建且不新增Session；浏览器刷新和无额外模型请求已验证。                |
| AC-05 认证         | Pass（受控协议）；Key提交、移除确认、重新输入及OAuth关闭取消/成功关闭均有回归。公开DTO仅状态和掩码，秘密局部持有。真实供应商账号未验证。                         |
| AC-06 升级兼容     | Pass；真实v1 SQLite追加0002，保留ID、credentialRef、历史Session/events、provider_versions原始JSON字节与0001校验值。旧代理会话继续走旧端点，官方入口不借用旧Key。 |
| AC-07 四份规范     | Pass；05目录仅前端、后端、desktop、testing及导航overview；删除六份重复规范并更新引用。新规则的非法fixture在真实ESLint/源码gate中被拒绝。                         |
| AC-08 现有代码整改 | Pass（本机范围）；全仓格式、ESLint、a11y、导入/源码/文档/版本gate、独立TS编译面与行为回归通过；Windows及真实账户范围单列下文。                                   |

产品布局和交互参考标杆，使用本仓库shadcn组件、Hook、协议与存储独立实现。没有复制标杆业务源码；本次也没有引入Computer Use或其他后续功能的假入口。

## 实际执行

| 命令或操作               | 结果                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm check               | Pass；Prettier、全仓ESLint/a11y、217源码导入检查、243文件源码约定、48份文档检查、版本同步检查、根/E2E及全部workspace类型检查；406项源码测试通过，2项明确skip。    |
| pnpm build               | Pass；6个workspace构建成功。设置按需加载，React独立chunk；Web最大JS块333.95kB，无超阈值警告。                                                                     |
| pnpm test:artifact       | Pass；4项实际构建产物测试，包含真实daemon正常退出和强杀恢复。                                                                                                     |
| pnpm test:e2e            | Pass；Chromium10项，覆盖M0连接、M1流式/队列/分支及本次设置。                                                                                                      |
| pnpm package:desktop     | Pass；生成macOS arm64未签名应用目录，使用随包Node24。                                                                                                             |
| pnpm smoke:desktop       | Pass；从隔离临时目录启动真实发布包，打开设置/内置配置，验证20厂商、CSP、私有授权、IPC权限、原生模块与退出回收；即使父环境设置开发Origin，发布服务仍拒绝5174来源。 |
| Playwright CLI真实页面   | Pass；1440×1000浅深设置、Provider编辑及900×700布局实际截图查看；通用设置的深色开关实际操作。该会话console为0 errors / 0 warnings。                                |
| pnpm audit --prod --json | Pass；381项生产依赖，0条告警；此结果不代表全部开发依赖无告警。                                                                                                    |

命令均在项目锁定Node24下执行。两项skip分别为Windows专用进程行为和缺少显式测试凭据的真实Provider用例。当前源码套件包含隔离命名空间的macOS系统凭据存储检查；没有读取或删除现有用户凭据。

最终源码检查后只更新本次验收、索引、里程碑和用户指南，再执行对应格式与文档门禁，不重复声明一次全套检查覆盖后续文档修改。

## 关键行为证据

- `packages/storage/test/model-settings.test.ts`验证真实v1升级、官方槽位绑定、旧引用与字节保留、默认设置revision及重启。官方候选仅限未覆盖端点/模型的旧内置配置；代理配置留作legacy读取，不静默合并凭据。
- `packages/agent-runtime/test/model-settings.test.ts`验证20厂商目录、只读内置、自定义空模型、整份模型原子保存、协议变化和默认失效。`model-gateway.test.ts`通过真实Pi Agent与本机HTTP服务验证三个协议的有Key隔离及无Key请求；不发送内部占位Authorization，也不读取已保存但未启用的Key。
- `apps/daemon/test/model-environment.test.ts`在独立Node子进程中注入合成SDK环境认证、租户、自定义头、端点和日志变量，经过实际三个SDK发送请求；环境值不外带，显式配置header保留。生产bootstrap集中清理，未按请求修改共享进程环境。
- `tests/e2e/m1.spec.ts`通过实际设置UI创建Provider、保存/移除/重输Key、编辑模型、测试连接和选择默认值，再执行流式对话、刷新、分支、停止与队列。`settings.spec.ts`验证20厂商、只读、焦点、动态style nonce、错误nonce仍被拒绝、无Key和默认失效。
- OAuth浏览器用例使用公开wire fixture验证视图对flow的清理与取消、秘密输入和空文本挑战；SDK授权生命周期另由运行时测试验证，不能将两者写成真实供应商登录成功。

回归修复了Dialog焦点恢复、OAuth嵌套表单、OAuth-only厂商无效Key入口及旧草稿携新revision覆盖风险。动态style通过每次HTML响应的新nonce授权，文档禁止缓存；script-src仍只允许self，不引入unsafe-inline/eval。首次设置回归曾发现焦点问题，修复后最终10项通过；中途一次运行因新daemon模块尚未build而无法启动，重新构建后通过，未放宽断言。

## 未验证范围

Windows真实运行、凭据库、打包安装和退出未执行；本次跨平台路径与进程用例通过不等于Windows验收。真实DeepSeek/OpenAI及其他供应商API、真实Provider OAuth和GitHub应用注册仍需用户账号验证，本轮没有真实供应商计费。签名、公证、正式安装器与自动更新尚未实现，当前产物为未签名应用目录。

本轮只审计生产依赖；M1已有记录中的开发依赖告警不因此清零。Computer Use、本机工具、附件、MCP等仍按后续里程碑推进。设置界面有模型目录与认证状态，不意味着每个厂商在所有区域和账号条件下都已实测。

## 用户验收入口

运行 `pnpm dev:desktop`，或启动 `release/mac-arm64/My Pi Harness.app`；浏览器入口运行 `pnpm dev` 后使用终端配对码。打开「设置 → 模型」，配置内置厂商或添加自定义Provider，在独立模型弹窗添加/测试模型，再选择默认模型与思考等级。关闭设置创建会话并对话，刷新和重启检查默认值与历史；打开/关闭设置检查未发送草稿保留；已有会话可在会话设置修改后续模型。

本地截图为 `output/playwright/m16-settings-light.png`、`m16-settings-dark.png`、`m16-settings-compact.png`、`m16-provider-editor.png` 和 `desktop-settings.png`。截图与合成profile仅作为本地验证产物，不加入源码提交；临时profile与测试授权已在验证后清理。
