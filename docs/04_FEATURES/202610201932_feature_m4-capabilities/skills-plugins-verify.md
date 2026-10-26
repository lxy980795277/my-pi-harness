# M4.4–M4.6 Skills 与插件验证

环境：macOS arm64、固定 Node24.20.0、pnpm10.34.6。使用临时目录、SQLite、动态端口、合成应用身份和受控模型；没有读取真实凭据、根 `.env` 或用户工作区数据。本文件记录模块定向证据，M4 整体静态检查和交付结论见最终验证。

## 实际检查

| 命令                                                                                                                                                                      | 结果                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm exec vitest run --config packages/integrations/vitest.config.ts packages/integrations/test/skills/catalog.test.ts packages/integrations/test/skills/github.test.ts` | 14 项通过：本地目录与 GitHub 安装源。                                    |
| `pnpm exec vitest run apps/daemon/test/skills-plugins.test.ts`                                                                                                            | 8 项通过：真实文件、SQLite、服务生命周期和 Fastify HTTP。                |
| `pnpm exec playwright test tests/e2e/skills-plugins.spec.ts --workers=1`                                                                                                  | 2 个浏览器场景通过，13.2 秒；使用构建后的 daemon、真实 Pi 请求及 JSONL。 |

合计为 22 项源码测试和 2 个浏览器场景；不与全仓复跑数量相加。

## 覆盖结果

- Skill frontmatter 必填项、重复 YAML 字段、别名、自定义标签和名称校验；项目、用户和插件来源优先级及同名遮蔽；无工作区时不隐式访问项目目录。
- 目录软链、路径穿越、缺失资源、超限内容、损坏快照拒绝；冻结后源文件改变不影响既有正文与资源；资源读取校验实际内容 hash。
- GitHub 安装固定到提交，校验 tree/blob 身份；截断目录、软链、超大响应和取消拒绝。安装不覆盖同名目录，取消清理所属 staging。
- 禁用、重新启用、卸载和重装不能恢复旧授权；活动 Run 租用阻止删除资源；卸载前持久禁用记录，插件重装使用新 generation。
- 九个插件 manifest 和独立资源可枚举；App 以准确引用归属安装和删除，同名手动资源不会按名称删除。App 与同名 Skill 的组件控制相互独立。
- 插件安装互斥，取消和关闭等待所属操作清理；关闭后拒绝新操作。HTTP 校验实际请求，目录接口只接受注册 Skill ID。

第一个浏览器场景在设置中创建 Skill，从输入框选择后发送；模型请求和下载的 JSONL 均含同一冻结正文，刷新后历史可读且不会重新请求模型。第二个场景安装 Documents 插件，检查 Skills 目录同步出现、停用后隐藏、卸载后恢复安装入口。

实际查看两个场景的 `skill-selected.png` 和 `plugin-management.png`：设置、选择计数和插件管理可见，工具沿用单行交互。截图在各次 Playwright 输出目录中，不作为仓库资源提交。

## 未验证及限制

真实 GitHub 网络下载、第三方 App OAuth、收费服务、Electron 新安装包中的目录打开，以及 Windows/Linux 未在本模块浏览器验证中执行。GitHub HTTP fixture 验证安装协议和失败处理，不替代真实网络可用性；App 安装完成也不等于账户已经连接或工具已经授权。Runtime 动态 Skill 激活、压缩保留和排队消费由 M4 Runtime 验证另行记录。

## 插件市场三级导航（2026-10-26）

本次为M4.6界面收尾，产品0.7.0、通信协议15，SQLite与JSONL格式不变。市场使用图标、名称、简介和独立安装/启停/卸载操作；插件详情按应用和Skills分组，Skill正文在同一设置内容区只读渲染Markdown。未安装或停用时可预览随包正文，预览不安装、创建快照或授予运行权限。M5尚未开发。

实际检查环境仍为macOS arm64、Node24.20.0、pnpm10.34.6与Chromium，沿用隔离profile、动态端口、合成身份和受控模型，没有读取根 `.env` 或触碰用户开发服务。

- 后端定向Vitest覆盖 `packages/integrations/test/plugin-preview.test.ts`、`apps/daemon/test/plugin-preview.test.ts` 与既有 `apps/daemon/test/skills-plugins.test.ts`：首轮14项通过；随后将符号链接边界分为平台定向用例，重跑资源预览4项通过。15个不同用例均有通过记录，两轮重叠不累加。覆盖九个插件预览、未安装/停用、鉴权、未知ID/额外query、零安装/快照/凭据读取、取消/关闭、坏UTF-8、超限与符号链接。
- `pnpm build`：8个任务通过，含Web三个类型编译面、daemon与所有依赖；最后配置读取失败文案修正后另跑Web生产构建、类型和该Hook的ESLint通过。保留既有Vite大chunk与Electron独立renderer配置提示，不将构建视为打包验收。
- 所改Web和宿主文件的定向ESLint、protocol/integrations/daemon类型、E2E类型、a11y、源码约定、依赖边界、文档及格式检查通过。
- `pnpm exec playwright test tests/e2e/skills-plugins.spec.ts --workers=1 --output=output/playwright/plugin-market-navigation`：3个场景通过，17.3秒。既有Skill选择进入模型/JSONL路径保留；Documents覆盖未安装预览、安装不展开、两处Skill开关同步、刷新后的偏好、整体停用、卸载；Google覆盖真实多App目录、一次503后真实API重试、焦点/滚动复位、分类保留及深色展示。

实际查看市场、Skill正文及Google深色详情截图，图标、简介和层级清晰，正文不是原始文本编辑器。截图位于未追踪的 `output/playwright/plugin-market-navigation/`，不提交浏览器输出。现有内置插件均包含一个Skill，分组与导航按数组处理；没有伪造多Skill插件作为真实目录证据。

最后视觉复核修正了卸载按钮将背景token用作文字色的低对比问题，改用成对的error/error-foreground，并重建Web。随后的Documents复测在reload后目录断言失败：trace明确显示组件控制revision2/false已持久化，GET Skills也返回enabled:false；管理目录本来保留禁用项。原测试误用hidden断言，且可能在列表尚未加载时提前通过。现明确等待并校验真实Skills响应，区分组件停用后的管理行保留和插件整体停用后的目录移除；不为通过测试改变产品目录语义。

修正后仅重跑Documents场景，1项通过、6.7秒，不与前述场景累加。最后Web三编译面/构建、所改组件ESLint以及测试ESLint/E2E类型通过。最终截图位于 `output/playwright/plugin-market-final-verified/`，实际查看 `plugin-details.png` 确认卸载文字清晰；此前失败trace保留在 `output/playwright/plugin-market-final-contrast/`。未重复全仓源码、全部浏览器或桌面验收。

本次未启动新的Electron应用、重新打包安装目录或进行真实第三方账户授权。已有M4的Office视觉、真实账号、Windows执行与安装验收缺口保持原状态。协议15要求开发服务与共享Renderer同步更新；没有提交或推送代码。
