# 技术专题拆分与全仓治理验证

日期：2026-10-28，北京时间。实现验证使用产品版本0.10.0；macOS arm64、Node24.20.0、pnpm10.34.6。AC1–AC4及UC1–UC3在本轮文档、代码治理和本机工程验证范围内通过，不包含真实账号或Windows验收。用户随后授权本地提交，提交版本同步为0.10.1；不push，不修改用户数据。

## 技术文档

新增[插件体系](../../09_TECHNICAL/插件体系设计.md)与[MCP连接](../../09_TECHNICAL/MCP连接设计.md)，按源码核对声明、组件、Skills、OAuth、网关、目录、冻结、租约和unknown语义。旧能力扩展篇混合两个主题，并残留已移除的逐Run服务grant及固定服务目录描述，现删除；有效内容已分别承接，技术总览、架构、Runtime和工作区专题的引用全部同步。

另行交叉审查将allowed-tools自动加载与request_skill_tools明确批准区分：前者只暂存冻结的本地Office候选，后者可以申请本Run已有MCP候选，均不能替代逐次执行审批。没有以文档重写改变产品能力或验收状态。

## 治理范围与发现

按docs/10的code、server、web及desktop四类清单检查源码、相关测试、工具脚本、workspace依赖和文档。分级采用治理入口定义：2项高风险生命周期缺陷、3项中风险可靠性/规范缺口、4项低风险清理或文档问题，均已处理；这表示本轮有证据的发现，不表示已证明全仓不存在其他问题。

| 级别 | 位置                                                                              | 问题、证据与处理                                                                                                                                                | 验证                                                                                                                |
| ---- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 高   | apps/daemon/src/application/services.ts:376                                       | 启动失败后某个close拒绝，顺序await使后续服务不再清理。改为逐项收集清理失败，继续释放所有已取得资源并最后关闭store；双重失败保留原启动错误。                     | 新application-services.test.ts先复现未调用后续close，修复后全部调用且真实临时profile可重新打开。                    |
| 高   | apps/daemon/src/plugin-connections/service.ts:344                                 | 首个close取消并等待OAuth时，第二个close因closed标记提前完成。改为共享同一关闭Promise，拒绝新任务并等待在途操作与凭据排空。                                      | plugin-oauth-parity.test.ts门控Token交换；修复前第二次关闭已完成，修复后共同等待、凭据仅关闭一次且取消Token不落盘。 |
| 中   | apps/web/src/features/connections/hooks/use-connections-settings.ts:83–131        | 保存A时Escape关闭并编辑B，旧成功会关闭B，旧失败会污染B。切换/关闭显式取消UI任务，旧controller不能改变新任务；finally仍刷新服务事实，不声称取消撤销写入。        | async-event.test.ts覆盖旧成功/失败和新任务在途；新增真实浏览器用例观察请求取消、A服务事实刷新及B正常保存。          |
| 中   | apps/web/src/features/skills/hooks/use-skills-settings.ts:65–80、131–137、168–213 | 已加载正文及在途结果没有所选Skill归属，切B仍显示A；旧卸载完成也会清除新选择。资源读取单独拥有取消/错误，预览绑定id/hash/workspace，卸载只清自身仍被选中的状态。 | skill-resource-preview.test.ts校验归属；浏览器真实加载资源、切Skill、取消旧请求并抑制迟到失败。                     |
| 中   | apps/web/package.json、apps/desktop/package.json                                  | 两个workspace的测试直接导入vitest，Web编译配置也使用其类型，却只依赖根解析。补声明现有catalog开发依赖。                                                         | rg核对直接消费者；更新lockfile，源码/类型及构建通过。                                                               |
| 低   | packages/integrations/src/mcp/remote.ts:38                                        | RemoteMcpManagerOptions.fetch从未读取且全仓没有消费者，错误暗示可注入传输。删除字段与无效类型导入，保留真实fixtureOrigin入口。                                  | remote/remote-oauth定向25项及整仓源码/类型检查通过。                                                                |
| 低   | packages/integrations/package.json                                                | @modelcontextprotocol/node只由根fixture消费且根已声明，integrations无静态/动态/配置/资源消费者，SDK也不要求该peer。移除本包冗余开发依赖。                       | 对照源码、资源、配置及已安装SDK manifests；lockfile仅调整所属importer。                                             |
| 低   | packages/execution/src/office/process.ts:105–130                                  | stderr字符串只累计、从不读取。移除无消费者缓存；字节限额、安全错误及进程回收保留。                                                                              | 现有Office取消与真实macOS隔离用例通过；execution类型和源码测试通过。                                                |
| 低   | docs/09_TECHNICAL及apps/daemon/README.md                                          | 旧篇职责重叠并有过期服务grant；daemon README将所有凭据概括为OS存储，遗漏插件专属文件。拆分并删除旧篇，更新全部链接和存储归属。                                  | 源码交叉复核及文档链接检查通过。                                                                                    |

## 保留判断与未发现新增确证问题的范围

- Renderer：Query/Store事实来源、注销清理、session/branch key隔离、SSE世代/合批/缺口恢复、附件请求取消与零保留缓存、Provider/MCP编辑器挂载、Markdown安全、基础控件名称/焦点委托及减少动效声明。未因静态未引用删掉动态控件或公开入口。
- daemon及扩展：HTTP输入/安全DTO、来源/登录/CSRF、限时一次性启动ticket、两类OAuth的独立凭据所有者、目录单飞及单调用方取消、刷新发布的epoch复核、SDK连接与实际执行权限分离。插件和独立MCP OAuth不能合并为一个凭据来源。
- Runtime/存储：队列原生冻结绑定、可见revision与派发屏障、终态及canonical结果同批；JSONL v3按Run/branch引用、fsync后推进游标、Run结束释放基线、原字节下载。未发现新字符串兼容层或重复审计正文；snapshotPrivateData的JSON规范化与脱离SDK引用有实际用途，保留。
- Desktop/执行/工具：主frame与来源、固定IPC、导航/窗口、daemon监督、文件/网络/Worker/Office、受管进程、开发进程树、Node下载缓存和发布资源。Office sandbox括号疑点通过现存真实隔离用例排除，未凭观感改动权限策略。
- Remote SDK close可能拒绝的候选未证实：锁定版本只进行本地abort/事件清理，没有生产可复现的新增远端关闭失败路径；不凭假设增加一套生命周期重写。

本轮没有新增静态硬规则；既有合法/非法fixture随整仓test执行。未配置Knip或声称做完全死代码证明，删除项均核对实际消费者及构建/资源入口。

## 实际检查

所有正式命令使用仓库固定Node24.20.0的PATH。

| 命令或检查                                                                                                                                                                             | 结果                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| pnpm install --lockfile-only --ignore-scripts                                                                                                                                          | 通过；仅同步两个vitest声明和一项移除，无版本升级。既有五项传递依赖弃用提示未作为本轮升级依据。                                                         |
| pnpm format:check && pnpm lint && pnpm typecheck && pnpm test                                                                                                                          | 通过；756源码导入、817文件约定及当时180文件文档检查；8项类型任务通过，3项缓存；1595测试通过、2项跳过，159文件通过、1文件跳过，62.67秒。                |
| pnpm build                                                                                                                                                                             | 8项实际任务通过，0缓存，14.711秒。Vite仍有既有大chunk提示，本轮未放宽阈值或更改打包策略。                                                              |
| pnpm test:artifact                                                                                                                                                                     | 2文件、6项通过，13.29秒；使用真实构建daemon临时启动/恢复/退出。                                                                                        |
| pnpm exec playwright test tests/e2e/settings-lifecycle.spec.ts tests/e2e/connections.spec.ts tests/e2e/skills-plugins.spec.ts --output=output/playwright/technical-governance-20261028 | 首次5通过、1测试定位失败；Skill切换/取消和既有连接、模型指令、插件开关与深色导航通过。                                                                 |
| pnpm exec playwright test tests/e2e/settings-lifecycle.spec.ts -g '关闭在途账户编辑' --output=output/playwright/technical-governance-connection-20261028                               | 修正背景标题定位后1项通过，6.8秒；共6个不同浏览器场景通过。                                                                                            |
| pnpm exec eslint tests/e2e/settings-lifecycle.spec.ts；pnpm exec prettier --check tests/e2e/settings-lifecycle.spec.ts                                                                 | 最终浏览器测试文件通过。                                                                                                                               |
| 定向检查                                                                                                                                                                               | 后端2文件15项、远端2文件25项、Web8文件56项、Desktop/执行/脚本13文件93项通过，1项Windows专属跳过；Office取消与隔离2项通过。与整仓测试重叠，不累加总数。 |
| git diff --check                                                                                                                                                                       | 实现验证阶段通过，当时未stage或提交；未修改运行数据、.env、协议、schema，后续提交版本同步见下文。                                                      |

浏览器失败的原因是B的模态编辑框打开后，Radix按可访问性要求隐藏背景A的标题，默认getByRole不能查询背景节点；调整为显式includeHidden后保留A已提交事实、B未被关闭、B可保存的断言。没有增加等待时限或通过删除业务断言掩盖失败。

后端首次红测使用pnpm脚本透传参数错误，实际执行了daemon源码37文件，299项既有测试通过、1项跳过、2项新回归准确失败；之后改用明确的exec vitest文件选择，修复后定向及整仓均通过。该次红测不记为最终通过结果。

## 限制

浏览器使用真实构建Web/daemon及临时profile，模型和OAuth采用合成fixture，不访问用户凭据或产生模型费用。页面截图由既有用例生成，本轮未将其当作人工视觉/焦点验收；新增验证只声明所断言的真实取消和状态行为。

未新打包或启动Electron，未执行真实GitHub/Google账号、Windows、系统钥匙串、安装、签名或公证验收。这些既有缺口保留原里程碑，不以本轮治理通过宣称整个M4验收完成或进入M5。

## 本地提交准备

用户明确要求提交后，按八步流程核对并精确暂存本轮代码、配置、测试及文档。复用上述实现、构建、产物和浏览器证据，另外同步根产品版本及生成APP_VERSION为0.10.1，添加发布记录；不因提交手动重复完整测试，仓库提交钩子仍按原配置执行lint-staged、lint、typecheck和test。

公开协议17、SQLite schema8、JSONL批次3和事件envelope1不变，没有数据迁移、清理或新增兼容分支。此前构建及浏览器证据来自0.10.0业务实现，不将提交元数据同步宣称为新的桌面包或平台验收。
