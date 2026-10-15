# 审批模式与会话JSONL验证

日期：2026-10-15，北京时间。应用0.2.1，wire7、SQLite迁移5，事件信封1；未commit或push。环境为macOS arm64、Node24.20.0、pnpm10.34.6与Chromium。所有模型测试使用受控Pi faux或本机合成HTTP服务及隔离profile，没有使用用户凭据或真实供应商。

## 验收结果

| 条件  | 结果与证据                                                                                                                                                                                                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | Pass；三个选项、说明、16px图标、当前勾选和完全访问警示色通过浏览器验证；实际查看`output/playwright/approval-menu.png`。旧read-only会话打开菜单不提权，明确选择后才更新，旧只读工具仍拒绝写盘。                                                                                                 |
| AC-02 | Pass；真实Pi与SQLite验证AI允许、拒绝、明确ask、无效返回、认证解析失败、超预算、未知toolCall和超时。超时等待底层请求实际结算后才转人工并释放lease，停止取消复核且不写文件；主对话不混入复核消息，公开事件不含私有输入。浏览器验证AI允许实际创建文件、无效结果转人工后执行与刷新后保留审批来源。 |
| AC-03 | Pass（macOS范围）；full-access自动执行且不调用复核模型。真实macOS命令验证工作区外受控文件读写和网络可用，ask/auto保持默认沙箱及隔离失败拒绝；两种策略均覆盖取消、超时、输出上限、leader提前退出和TERM升级。三种模式的Plan均拒绝变更。所属进程组以外的恶意后代不在现有回收保证内。              |
| AC-04 | Pass；18条JSONL专项覆盖公开事件镜像与历史/归档补齐、嵌套回滚、幂等、缺失文件、部分末行与缺换行修复、完整坏行/额外记录拒绝、链接/目录替换/文件权限、写后fsync失败和启动失败资源清理。API故障注入验证503明确提示数据库已保存，读快照仍可用。                                                     |
| AC-05 | Pass（本机范围）；静态、源码、真实构建daemon、浏览器验收完成。构建daemon停止后人工追加不完整末行，重启后JSONL逐行通过HarnessEvent校验并与SSE完整重放逐项一致，私有列和附件字节未泄露。JSONL是公开事件镜像，不提供独立完整恢复或导入。                                                          |

## 实际检查

命令使用仓库`.cache/node/node-v24.20.0-darwin-arm64/bin`置于PATH前部。最终运行如下；前置定向检查不替代下列整体验证。

| 命令                                                                                  | 结果                                                                                                                 |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                                   | Pass；全仓通过，后续验收文档及两份浏览器夹具另做定向格式检查。                                                       |
| `pnpm lint`                                                                           | Pass；ESLint、Oxlint、353份源码依赖检查、390份源码约定、当时78份文档及版本门禁通过。                                 |
| `pnpm typecheck`                                                                      | Pass；根工具、E2E及7个workspace编译任务通过。                                                                        |
| `pnpm test`                                                                           | Pass；65文件通过、1文件跳过，685项通过、2项跳过；跳过为没有显式凭据的真实Provider与当前平台不执行的Windows进程用例。 |
| `pnpm build`                                                                          | Pass；7个workspace构建成功，真实产物使用wire7及迁移5。                                                               |
| `pnpm test:e2e`                                                                       | 首轮27项通过、2项失败；两条新增旧只读API夹具遗漏显式模型选择所需thinkingLevel，被服务正确拒绝，随后仅补齐夹具字段。  |
| `pnpm exec playwright test tests/e2e/approval.spec.ts tests/e2e/m2.spec.ts -g '只读'` | Pass；修复夹具后2项通过。与首轮其余27项合计覆盖29个用例，未修改或放宽产品校验，未将首轮聚合命令记作成功。            |
| `pnpm exec eslint tests/e2e/approval.spec.ts tests/e2e/m2.spec.ts`                    | Pass；上述夹具修正后的定向静态检查。                                                                                 |
| `pnpm exec tsc -p tests/e2e/tsconfig.json --noEmit`                                   | Pass；夹具修正后的E2E类型检查。                                                                                      |
| `pnpm test:artifact`                                                                  | Pass；2文件5项，包含真实构建daemon重启、JSONL末行修复与SSE对账。                                                     |

最终文档另执行目标Prettier、文档门禁和`git diff --check`。未运行组合命令`pnpm check`，上表分别记录实际执行的检查。

## 未验证与使用说明

- 本轮未重新打包或运行桌面smoke；共享Web/daemon产物、真实macOS执行适配器及浏览器链路已验证，不把前次wire6桌面包当成当前wire7的包验收证据。更新后需重启开发服务，使客户端与daemon共同使用wire7。
- Windows/Linux实机、Windows ACL和目录持久化、真实供应商AI复核尚未验证；Windows Shell继续按用户决定暂缓，MCP/Skill仍为占位，未进入M4或宣布M7完成。
- JSONL位于应用profile的`sessions/<sessionId>.jsonl`，旧会话包括归档在启动时补齐；工作区只保存Agent实际操作的文件。SQLite仍是唯一恢复事实，JSONL不包含privateData、Provider私有codec或附件字节。
- 完全访问由用户明确选择，macOS Shell使用当前用户权限、没有OS沙箱，不进行系统提权；文件工具仍限工作区。AI复核使用当前会话模型并产生额外模型请求，不明确的结果交回人工。

## Select焦点与隐藏JSONL目录调整

后续反馈已实现并验证，应用仍0.2.1、wire7、迁移5。共享SelectTrigger改用轻微背景反馈，不新增聚焦边框或光圈；ComposerSurface只响应textarea聚焦。Radix关闭回焦、键盘打开及选择仍保留，不通过主动blur丢弃焦点。

该轮JSONL路径为`<logRoot>/sessions/<SHA256(canonicalProfilePath)>/<sessionId>.jsonl`，当时开发默认仓库、正式默认home，显式profile也能改变默认根。该默认策略已被下文“统一仓库日志根”取代。`MY_PI_HARNESS_SESSION_LOG_ROOT`须为末级固定`.my-pi-harness`的绝对目录，其既有父目录须存在。SQLite、系统凭据和授权位置未迁移，旧日志保留，新位置从SQLite补齐。

AC-06 Pass：浏览器验证鼠标选择后trigger仍保有焦点，border/shadow与选择前一致，输入外框不变；textarea聚焦仍有输入反馈，键盘Home/方向键/Enter选择正常且具有背景反馈。实际查看`output/playwright/approval-focus.png`，确认选择后没有聚焦边框。

AC-07 Pass（本机范围）：配置和桌面路径用例验证开发/正式/显式临时根；storage验证换根补齐归档、保留旧日志、两个profile同名Session隔离、拒绝不安全根/链接及失败后释放资源。真实macOS文件与Shell用例确认隐藏目录不能通过普通工具读取、写入、列出或搜索，父项目仍可注册；full-access Shell保留显式宿主权限语义。构建daemon在新路径通过停止/重启、损坏末行修复及SSE逐项对账。仓库隐藏目录已创建，`git check-ignore .my-pi-harness/`通过；`.workspace`仍保持可进入Git。

| 实际命令或检查                                                                                                                                                                                           | 结果                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`                                                                                                                                                                                         | Pass；根/E2E与7个workspace任务通过。修改涉及的宿主、组件、脚本、测试另做定向ESLint与Prettier，通过。                     |
| `pnpm exec vitest run apps/daemon/test/config.test.ts apps/daemon/test/work-api.test.ts apps/desktop/test/profile-directory.test.ts tests/unit/boundaries.test.js tests/unit/source-conventions.test.js` | Pass；5文件118项，包含新路径JSONL失败后的数据库保留与503说明。                                                           |
| `pnpm --filter @my-pi-harness/storage test`                                                                                                                                                              | Pass；新布局下原9文件64项通过；新增根目录专项加入后再执行下一行。                                                        |
| `pnpm exec vitest run packages/storage/test/session-log-directory.test.ts packages/storage/test/session-jsonl.test.ts`                                                                                   | Pass；2文件27项，其中9项为路径、换根、隔离及失败清理新用例。storage包类型与6文件定向ESLint通过。                         |
| `pnpm exec vitest run packages/execution/test/execution.test.ts packages/execution/test/workspace-path.test.ts packages/execution/test/shell.test.ts`                                                    | Pass；3文件75项，含真实macOS沙箱与隐藏目录保护；execution包类型与定向ESLint通过。                                        |
| `pnpm build`                                                                                                                                                                                             | Pass；7个workspace成功。                                                                                                 |
| `pnpm exec playwright test tests/e2e/approval.spec.ts`                                                                                                                                                   | 首轮4项通过、焦点用例的连续键盘操作1项失败：测试未等待Radix异步焦点移动，已补逐步焦点断言，未改产品行为或增加固定sleep。 |
| `pnpm exec playwright test tests/e2e/approval.spec.ts -g '权限菜单展示'`                                                                                                                                 | Pass；修正后的1项通过，与首轮其余4项覆盖全部5条审批用例。                                                                |
| `pnpm test:artifact`                                                                                                                                                                                     | Pass；2文件5项，真实daemon的新隐藏路径补尾与重启对账通过。                                                               |

收尾执行文档门禁、目标Prettier与`git diff --check`。本次仅做相关源码/浏览器/产物验证，未重复全仓685项或全部29条浏览器测试，也未重新打包/桌面smoke；正式桌面路径的证据为构建与纯路径用例，不声称已运行该桌面安装包。Windows实机及ACL、真实账号等未验证项继续保留。未commit或push。

## 统一仓库日志根

按用户最后确认，开发和正式运行均使用仓库根的`.my-pi-harness/`。源码和仓库内dist按模块位置确定根并核对仓库标记，cwd与自定义数据库profile不改变默认根。独立安装包启动前要求显式配置`MY_PI_HARNESS_SESSION_LOG_ROOT`，指向该仓库中的隐藏目录；没有回退用户主目录。测试均显式临时根，已有日志保留，SQLite和凭据位置不变。

AC-07本机复验通过：配置、桌面路径及使用服务的API测试7文件53项；daemon和desktop类型检查、13文件定向ESLint及Prettier通过。`pnpm --filter @my-pi-harness/daemon build`成功，随后`pnpm --filter @my-pi-harness/daemon test:built`通过2文件6项，含非法日志根在ready前拒绝，以及实际JSONL补尾与重启对账。从`/tmp`用Node24直接导入构建后的配置，默认结果仍为本仓库`.my-pi-harness`；该操作未打开数据库或写日志。`git check-ignore .my-pi-harness/`通过。

本轮未实际打包或启动独立Electron安装包，打包分支仅有配置拒绝和显式根的源码测试；没有新增Windows实机证据。应用仍0.2.1、wire7、迁移5，未提交或推送。
