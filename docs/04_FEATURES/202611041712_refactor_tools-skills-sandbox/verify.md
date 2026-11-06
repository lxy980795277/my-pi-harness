# 工具体系重构验证

实现及本机工程验收完成。原方案于2026-11-04建立，后续执行和收口由用户授权；本记录只列真实检查，不将受控模型HTTP服务、Node生产部署或PDF图片检查替代真实供应商、Electron安装包及全部办公格式验收。产品版本保持0.17.1，协议24，SQLite10；未提交、推送或清理用户会话和配置。

## 实现结果

新增tools及sandbox两个实际workspace，删除execution及其源码、资源、依赖、路径和旧构建残留。daemon继续位于apps/daemon，负责API、账号及生命周期装配；runtime保留Pi、审批和会话/任务事实；integrations保留MCP、OAuth及远端协议。当前工具清单、分层和行为分别由[能力协议](../../03_API/capability-runtime.md)、[工具技术设计](../../09_TECHNICAL/工具体系与沙箱.md)、[tools](../../../packages/tools/README.md)和[sandbox](../../../packages/sandbox/README.md)拥有。

- 注册项关联schema、效果策略、可用条件及执行工厂，运行时使用绑定闭包，不保留工具族switch或按名字的执行总线。每Run缓存使用工具名称与定义指纹，避免两个MCP Server相同schema串用执行器。
- Skill初始激活和load_skill均物化精确资源；模型可见resourceDirectory经run.tools_loaded持久化，正文/权限不变且同Run目录不能替换。命令独立retain租约，Run结束不提前删除仍使用的资源。
- 命令短等待与进程生命周期分开，保留增量输出、取消、时限和物理回收；写租约覆盖进程与资源结算，跨Run的活跃写入不能因另建任务树绕过。16个未回收命令与128个终态缓存是资源上限，未增加累计调用/Token预算。
- 四办公Skill使用本项目CLI与共享格式库；read_file专注UTF-8，文档/图片/页图分别读取。通用publish_artifact写入不可变blob，与工具终态及canonical结果同批，下载不依赖原文件继续存在。

## 实际检查

| 命令或验证                                                                          | 实际结果                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node24下`pnpm exec vitest run`                                                      | 211文件通过、1文件跳过；2009项通过、2项条件跳过。覆盖现有M1–M5源码、API、SQLite/JSONL及新资源/命令/产物回归。                                                                            |
| `pnpm lint`、`pnpm typecheck`、`pnpm format:check`、`pnpm build`                    | 全workspace通过；lint包含a11y、依赖边界、源码声明顺序、文档和版本同步。新增变更后另跑对应聚焦检查，命令生命周期7个回归全部通过，包括Session关闭期间的新派发拒绝。                        |
| `pnpm --filter @my-pi-harness/daemon test:built test/tools-resources.built.test.ts` | 真实独立临时生产deploy通过：部署目录内解析dist、加载四Skill及共享资源、只读sandbox运行CLI help/dependencies，文档worker读取真实PDF，release后资源删除。没有使用源码别名替代生产exports。 |
| 配置已准备Python后`playwright test tests/e2e/office-artifact.spec.ts --workers=1`   | 主、子两个场景通过。使用受控HTTP模型服务，命令、文件、审批、SQLite、JSONL、浏览器和下载均真实执行。                                                                                      |
| `playwright test tests/e2e/m2-completion.spec.ts --workers=1`                       | 完整目录/搜索/读取/预像编辑、逐次审批、run_command、Web及持久历史链路通过。测试适配新名称和结构化命令结果。                                                                              |
| sandbox真实进程与watchdog回归                                                       | macOS三种访问范围、敏感/profile/精确资源、并发、输出和时限、双向管道、leader/descendant以及daemon SIGKILL后的所属组与临时目录收束通过。                                                  |
| Office格式及图像验证                                                                | 八组Python高级格式回归通过；真实PDFium输出中文长表，实际查看首末页的表头、换行和页码；浏览器主卡片及任务详情下载卡片已目视检查。                                                         |

测试曾发现并修正旧测试的shell名称/原始输出断言、工具绑定过早拒绝、相同MCP定义hash缓存冲突、成功终态早于资源回收及写租约随yield提前释放。失败不计入通过结果；修复后相关回归通过。

## 主子交付证据

主流程实际安装Documents、load_skill、四次批准命令，经过依赖检查、普通脚本创作、run/wait、read_document和结构检查后发布。浏览器下载后修改源文件，再下载仍为原始字节。

子流程由父加载Skill并委派写角色。子模型首个请求包含继承版本及自己的资源目录，未重复load_skill；实际生成、等待、读取并检查DOCX后发布。下载JSONL核对其accepted Skill id/contentHash，产物分别绑定子task/run/producer与父taskId=null。删除源文件后，主卡片和任务详情均下载同一原始DOCX字节。

## AC与保留范围

AC-01至AC-10、AC-13的实现及上述本机回归通过。AC-11通过独立Node生产deploy、真实exports/资源及worker路径验证，未制作或启动正式Electron安装包；AC-12通过格式结构、PDF页图和未验证状态表达，不代表全部Office视觉质量通过。

- 本机缺LibreOffice：DOCX/XLSX/PPTX实际转换、XLSX实际重算和这些格式的逐页视觉检查为Not verified。没有隐式安装转换器或Python依赖。
- 真实模型供应商、GitHub/Google真实授权、正式Electron安装包及签名流程本轮未执行。浏览器测试使用独立profile和受控模型，不读取真实凭据。
- Windows/Linux本地进程后端未实现且明确拒绝；没有隔离失败后的宿主回退。full-access仍是宿主用户权限，不能声称任意宿主Shell受资源/profile的OS只读规则约束。
- M6及既有M2/M4平台、账号与办公质量缺口保持原里程碑归属；本次架构收口不关闭这些缺口。

## 单工具文件整理（2026-11-05）

AC-14通过。27个原生工具按名称平铺为独立文件，每个文件同时拥有Schema、描述、可用性、加载方式、策略和执行入口。tools/index.ts聚合导出，registry/catalog.ts按原顺序装配；共享文件操作、文档输入、HTTP传输、Python解释器解析、端口检查和结果格式分别归lib，命令、Skill、插件及正文提取继续由原领域服务拥有。

删除旧工具组目录、分散的Schema/定义数组、按工具名区分write/edit的执行函数和无消费者的stringArgument。WorkspaceToolContext、WebFetchGatewayAccess及领域输入类型归ports，端口不再引用工具Schema。documents叶出口只保留授权字节提取；部署探针改用真实注册的read_document。产物生产命令校验保留宿主API，不再暴露到模型命令端口。注册工厂将同步和异步实现统一为异步绑定，实际主子Run回归同时覆盖同步领域贡献。

| 检查                                                                                | 实际结果                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 最终聚焦Vitest                                                                      | 28文件、244项全部通过；覆盖tools全部测试及主子工具绑定、目录加载、权限、交互/计划/Todo、长结果、协作和失败事实。                                           |
| `pnpm typecheck`、`pnpm build`                                                      | 各9个workspace任务全部通过；tools旧dist已清理，重新构建不包含旧工具组或commands/runtime残留。                                                              |
| `pnpm lint`、`pnpm format:check`                                                    | 全仓通过；静态检查覆盖970个导入文件、1038个源码约定文件及245份文档，包含依赖边界、声明顺序、a11y和版本同步。                                               |
| 重构前后构建声明对照                                                                | 27个工具的序列化声明逐字节相同，包含目录顺序、完整Schema、描述、来源、默认/按需加载及readOnly；另核对每工具384组平台/能力可用条件及6组策略输入，结果相同。 |
| `pnpm --filter @my-pi-harness/daemon test:built test/tools-resources.built.test.ts` | 1项通过；真实独立生产deploy使用dist/exports，经注册工具读取PDF，发现、物化并运行四个办公Skill的CLI，正确释放资源。                                         |

最终聚焦命令如下，均在Node24环境执行：

```sh
pnpm exec vitest run packages/tools/test \
  packages/agent-runtime/test/tool-contributions.test.ts \
  packages/agent-runtime/test/tool-binding-identity.test.ts \
  packages/agent-runtime/test/tool-runtime.test.ts \
  packages/agent-runtime/test/task-toolset.test.ts \
  packages/agent-runtime/test/run-toolset-pipeline.test.ts \
  packages/agent-runtime/test/tool-selection.test.ts \
  packages/agent-runtime/test/agent-permissions.test.ts \
  packages/agent-runtime/test/work-runtime.test.ts \
  packages/agent-runtime/test/agent-collaboration.test.ts \
  packages/agent-runtime/test/agents-failures.test.ts \
  packages/agent-runtime/test/task-work.test.ts \
  packages/agent-runtime/test/tool-result-reading.test.ts \
  packages/agent-runtime/test/capabilities.test.ts --maxWorkers=2
```

首轮类型检查与回归并行时出现两项超时和一项资源释放时序断言失败；未放宽超时或修改命令清理逻辑。三份失败文件单独复测22项通过，最终上述28文件244项再次全部通过。首次静态检查还发现四个同步适配器误加async，已由注册工厂统一异步绑定，不在工具中制造空await或逐个包装Promise。

本次未重复浏览器、真实供应商或正式桌面安装验收；以上原专题证据和Not verified范围保持。产品版本0.17.1、协议24、SQLite10不因文件整理变化，未提交、推送或清理用户数据。

## 配套源码组织对齐（2026-11-06）

AC-15通过。删除tools/src/documents、ports、registry；正文解析及DocumentError归utils/document-text.ts，工具检索归utils/tool-search.ts，注册类型、工厂和注册器归lib/tool-registry.ts，原生工具装配归根workspace-tool-registry.ts。旧ports接口拆分为各工具拥有的Schema派生输入和回调类型，lib/tool-context.ts只组合当前Run身份、宿主访问输入与领域回调，并拥有缺失回调的明确拒绝；移除重复的lib/tool-ports.ts。公共ToolContext及领域Handlers名称和所有消费者已同步，不保留旧类型别名。

| 检查                                                                                                        | 实际结果                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 上节聚焦Vitest再加入apps/daemon/test/attachments.test.ts、tests/unit/boundaries.test.js，保持--maxWorkers=2 | 30文件、318项全部通过；覆盖正文/PDF/页图、实际附件、目录加载、权限、主子任务、调用事实及真实正反依赖fixture。                                                        |
| `pnpm typecheck`、`pnpm build`                                                                              | 各9个workspace任务通过。重建前清理tools/dist，源码及dist均无documents、ports、registry旧目录。                                                                       |
| `pnpm lint`                                                                                                 | 全仓通过；961个导入文件、1029个源码约定文件、244份文档，包含a11y及版本检查；部署探针新增断言后定向ESLint也通过。                                                     |
| 原生工具声明及策略对照                                                                                      | 27个序列化声明与整理前逐字节一致；每工具384组可用条件及6组策略输入结果不变，目录顺序及加载方式保持。                                                                 |
| `pnpm --filter @my-pi-harness/daemon test:built test/tools-resources.built.test.ts`                         | 独立生产deploy的1项复测通过：新document-text叶出口实际提取PDF，注册工具读取PDF，四个Skill的物化资源与CLI执行/回收通过；旧documents、registry叶出口均被Node明确拒绝。 |

tsconfig、Vitest及生产exports均指向实际文件。document-text不加载原生工具目录；注册器对上下文、上下文对专属回调的引用为类型导入，没有引入值依赖循环。独立审查未发现遗漏消费者或需要保留的兼容入口。

独立部署首次遇到办公CLI受管进程TIMEOUT；未改动进程策略或放宽10秒限时，保持命令不变、单独复测后1项通过，耗时9.80秒。首次失败不计作通过，未将环境时序推测写作已确认根因。

本次未改动模型消息、协议24或SQLite10，也未重跑浏览器、真实模型或正式安装器；原有Not verified范围保持。未提交、推送或清理用户数据。

## 提交前生命周期复核（2026-11-06）

发现命令物理关闭后，周期资源校验仍可能在途；立即释放资源会令该校验将正常结束误判为授权失效。命令服务现先停止周期调度并等待在途校验，再释放资源和写入租约。真实撤销继续报告失败。

受控回归分别覆盖成功校验及真实撤销，不依赖sleep；旧实现两项均在资源提前释放处失败。修复后lifecycle的9项、两文件ESLint/Prettier及tools类型检查通过。提交8b62195的强制钩子完成lint-staged、全仓lint、9个workspace类型任务及完整Vitest：211文件通过、1文件跳过，2012项通过、2项按既有条件跳过。产品版本和APP_VERSION同步为0.18.0，协议24、SQLite10保持；未推送或清理用户数据。
