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
