# 工作区选择与图标验证

日期：2026-10-15，北京时间。应用0.1.0，wire协议4，SQLite迁移4；macOS arm64、Node24.20.0、Electron43.7.9。用户确认本轮完整支持Electron，浏览器新增目录后续补齐；实现与本机验证通过，待用户体验。未提交或推送。

## 验收结果

| 条件                | 结果与证据                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-01 简化表单      | Pass；添加弹窗仅有标题、图标/名称、目录选择区与操作；只有一个文本输入，无手工路径字段或指定重复说明。模型配置、模型管理的重复说明同步精简；必要安全提示保留。                                                                                                                  |
| AC-02 目录选择/拖放 | Pass（macOS）；实际最终包的系统目录选择器选取“示例 项目”，回填canonical路径，再次选择后取消保留原值，省略名称保存后显示目录名。打包smoke通过Chromium CDP投递真实磁盘目录，经实际preload/webUtils/main回填并保存；合成File拒绝。来源/参数、普通文件与多项拒绝另由聚焦测试覆盖。 |
| AC-03 图标与迁移    | Pass；18个固定Lucide图标，面板搜索/重置可用。真实HTTP/SQLite创建、编辑、刷新和重开保留图标，旧v3数据库的active/archived记录补folder且原事件/关联保留。非法icon400，revision冲突409。侧栏与输入栏/选项使用同一图标。                                                            |
| AC-04 布局与键盘    | Pass；900×700浏览器实际测量面板位于视口内，Esc仅关闭图标面板且焦点回触发者，Enter重开。浅色截图与真实桌面深色面板已查看；默认文件夹展开/收起及hover箭头类保持原规则。                                                                                                          |
| AC-05 浏览器范围    | Pass（已确认范围）；无bridge页面显示桌面添加提示，不要求路径或提交虚假目录；已有工作区可使用和编辑。浏览器新增目录尚未实现。                                                                                                                                                   |

## 实际检查

| 命令或操作                                                                                                                                                                                                                                                                  | 结果                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --ignore-scripts`                                                                                                                                                                                                                                             | Pass；新增Popover1.1.23，与已采用Radix依赖同线，锁文件同步。                                                       |
| `pnpm exec vitest run apps/web/test apps/desktop/test/security.test.ts apps/desktop/test/preload.test.ts packages/storage/test/workspaces.test.ts packages/storage/test/model-settings.test.ts apps/daemon/test/workspaces.test.ts apps/daemon/test/workspaces-api.test.ts` | Pass；14文件55项通过。                                                                                             |
| `pnpm typecheck`                                                                                                                                                                                                                                                            | Pass；根、E2E和7个workspace。初次整合发现旧Web测试fixture缺icon，修正后通过。                                      |
| `pnpm lint`                                                                                                                                                                                                                                                                 | Pass；ESLint、a11y、依赖、源码、文档与版本检查。                                                                   |
| `pnpm format:check`                                                                                                                                                                                                                                                         | Pass；全仓格式检查通过，末尾文档另做定向格式与链接检查。                                                           |
| `pnpm build`                                                                                                                                                                                                                                                                | Pass；7个workspace构建完成。                                                                                       |
| `pnpm exec playwright test tests/e2e/workspace-creation.spec.ts tests/e2e/m2.spec.ts tests/e2e/m2-completion.spec.ts tests/e2e/settings.spec.ts`                                                                                                                            | Pass；11项Chromium用例通过，包含新交互、工具链和设置回归。                                                         |
| `pnpm exec playwright test tests/e2e/workspace-creation.spec.ts`                                                                                                                                                                                                            | Pass；补入900×700面板尺寸与键盘断言后，3项再次通过；该文件ESLint和E2E类型检查同步通过。                            |
| `pnpm test:artifact`                                                                                                                                                                                                                                                        | Pass；4项构建后启动、退出与持久恢复检查。                                                                          |
| `pnpm package:desktop` / `pnpm smoke:desktop`                                                                                                                                                                                                                               | Pass；最终macOS arm64未签名包实际启动，验证真实目录拖放、图标面板CSP、工作区保存、合成File拒绝、有限桥与退出回收。 |
| 系统目录选择器与深色界面                                                                                                                                                                                                                                                    | Pass；通过真实macOS控件操作选择、取消与保存，查看深色图标面板并验证Esc恢复焦点。                                   |

浏览器新交互用例明确替换desktop选择接口，HTTP、daemon和SQLite保持真实；真实桌面桥证据由最终包smoke提供，系统选择器另实际操作。拖放自动化投递真实目录，没有声称进行Finder人工拖动。未执行全仓Vitest、完整M1套件、真实模型调用或Windows实机验证。

浅色900×700截图位于新建工作区用例的`test-results/`目录；桌面深色通过实际截图查看。目录选择和smoke使用独立临时profile及测试目录，应用和daemon正常退出，临时数据已清理，没有修改用户已有工作区或凭据。

## 用户入口

重新运行`pnpm dev:desktop`或打开本轮生成的`release/mac-arm64/My Pi Harness.app`。在侧栏加号打开添加弹窗，点击名称前图标选择；点击目录容器中央“添加”按钮选择目录，已有目录后通过“更换文件夹”按钮重新选择；也可拖入一个目录，再保存。已有工作区的编辑按钮可修改名称和图标，根目录保持固定。

## 紧凑尺寸调整

按用户反馈，常规弹窗收紧至约324px高，名称输入36px、目录选择区112px，图标面板宽256px、图标按钮32px。长路径单行省略并在容器保留完整title；表单min-width限制避免长路径撑宽grid，横向留白与操作按钮正常保留。错误提示仍可自然增高。

本次仅调整四个工作区组件样式：Web构建及三编译面类型检查通过；已有工作区浏览器用例3项通过，900×700截图已查看，图标面板边界/键盘、目录取消及保存场景无回归。没有新增测试文件或重跑其他里程碑测试，也未重新打包桌面产物；开发模式通过Web热更新查看。

默认初始焦点仍在图标按钮，组合容器的focus-within会点亮整体边框；该状态不是文字输入框获得焦点，不显示文字光标。此轮尺寸调整没有改变弹窗焦点策略。

## 目录按钮交互调整

源文件夹容器保留112px高度与拖拽监听，容器空白不绑定点击；中央独立shadcn按钮显示“添加”，已有目录后显示“更换文件夹”，通过原有Electron桥打开目录选择器。浏览器保留桌面提示并禁用按钮，没有新增目录API或手工路径输入。目录选择、取消与拖放Hook未修改。

定向ESLint（目录组件与既有workspace-creation浏览器用例）、Web三编译面类型检查及E2E类型检查通过；补充断言覆盖空白点击不调用桥、112px高度、添加/更换文案及浏览器禁用按钮。`pnpm --filter @my-pi-harness/web build`通过，包含Web三编译面类型检查。`pnpm exec playwright test tests/e2e/m3.spec.ts tests/e2e/workspace-creation.spec.ts`通过，8项用例耗时9.7秒，其中工作区3项通过；使用真实构建Web与daemon，目录选择桥仍按既有用例替换，不将其视作新的真实系统目录选择证据。已查看工作区创建截图，中央“更换文件夹”按钮与紧凑容器显示正常。没有重新打包桌面产物；历史macOS选择/拖放证据保持上文原范围。
