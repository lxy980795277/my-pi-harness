# 工作区导航验证

2026-10-15，应用0.1.0，macOS arm64/Chromium。改动完成，未提交或推送。

- AC-01 Pass：文件夹与箭头共用16×16位置。按用户反馈修复focus-within造成的鼠标点击后箭头常驻；实际点击收起再移出，普通焦点仍保留但focus-visible为false，显示FolderClosed而隐藏ChevronRight；重新hover切回箭头。再次展开移出显示FolderOpen，真实Tab/Shift+Tab键盘聚焦时focus-visible为true并显示箭头。浅深主题颜色在前一轮已查看，本次未改变颜色。
- AC-02 Pass：当前窗口中目录行和会话行均位于x=12px、宽232px、高32px；本次增加会话内部左侧padding后，目录名和会话标题横坐标均为45px，选中背景仍占满列表宽度，创建时间保留。
- AC-03 Pass（检查范围）：鼠标收起、Enter展开及选择已有会话已实际执行；管理按钮原事件绑定保留，本轮未重复管理表单业务验收。

实际检查：Web build及其三个类型编译面通过，改动TS/TSX定向ESLint、a11y与格式检查通过；Playwright CLI实际操作与DOM测量覆盖上述反馈复现。使用独立临时profile和无Key示例模型，只创建会话元数据，没有调用模型；浏览器、daemon和临时授权/目录已清理。未重新打包Electron或执行Windows实机验证。

本次对齐截图为`output/playwright/workspace-nav-aligned.png`；前一轮截图为`workspace-nav-hover.png`、`workspace-nav-dark.png`、`workspace-nav-selected.png`。

## 即时hover与显式新对话入口

后续反馈已完成，2026-10-15，当前应用0.2.1、macOS arm64、Node24.20.0与Chromium。仅调整Web导航与既有管理入口，wire7及SQLite迁移5未变化，未提交或推送。

- AC-04 Pass：目录主按钮和父行的x/width实测差不超过1px；操作层为absolute，更多与加号均16px，显示/隐藏不占主行宽度。工作区与会话条目transition-duration均为0s；hover、键盘focus-visible及菜单打开时显示动作，普通鼠标焦点不使hover状态滞留。标题保留操作区内边距和截断。
- AC-05 Pass：已有会话中点击另一目录只展开/收起，不改变当前会话；新对话草稿中展开其他目录保留草稿和工作区；运行状态页点击目录仍留该页。鼠标或Tab/Enter点击加号才回输入首页并预选对应工作区，草稿清空且发送前没有新增Session；实际发送后只创建1个Session，workspaceId准确。无真实模型调用发生在目录展开和管理操作中。
- AC-06 Pass：更多弹层仅含重命名、删除，菜单打开后移出目录仍可操作，Escape关闭回到触发者。重命名经真实API保存并刷新保留，编辑B时草稿目标A不变。删除先确认，可取消；确认后仅移除空工作区登记，测试目录的keep.txt保留，已有会话未减少。原工作区图标编辑、更名与刷新持久化用例已改走更多菜单并继续通过。

实际检查（命令均使用仓库缓存的Node24.20.0）：

| 命令或操作                                                                                              | 结果                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 修改的Web源码及两份E2E文件定向ESLint、Prettier                                                          | Pass；未运行全仓lint。                                                                                                                                                           |
| `pnpm exec tsc -p tests/e2e/tsconfig.json --noEmit`                                                     | Pass；E2E通过，Web三个编译面由前置类型检查及下一行构建覆盖。                                                                                                                     |
| `pnpm --filter @my-pi-harness/web build`                                                                | Pass；包含三个Web类型编译面及Vite生产构建。                                                                                                                                      |
| `pnpm exec vitest run apps/web/test/workspace-tree.test.ts apps/web/test/input-recovery.test.ts`        | Pass；2文件4项既有分组与输入生命周期回归。                                                                                                                                       |
| `pnpm exec playwright test tests/e2e/workspace-navigation.spec.ts tests/e2e/workspace-creation.spec.ts` | Pass；5项，其中2项新导航流程、3项原工作区创建/编辑流程。使用隔离profile、临时项目目录与合成模型，没有调用真实供应商或访问用户文件。                                              |
| 视觉观察                                                                                                | 已实际查看新导航用例生成的workspace-row-hover.png和workspace-actions-menu.png，确认主行背景宽度、右侧悬浮图标及紧凑菜单；截图包含键盘focus-visible反馈，不将其称为普通鼠标焦点。 |

收尾运行文档门禁、目标格式检查及`git diff --check`。本次未重复全仓源码/浏览器测试、daemon重启集成或桌面打包；Windows实机和用户实际体验未验证。删除限制仍由既有服务负责，没有修改为删除工作区目录或自动处理其会话。

## 路径tooltip与向右展开

本节记录当轮实现与验证，路径tooltip已按后续要求移除，当前结果见下文。

2026-10-15，应用仍0.2.1、macOS arm64、Node24.20.0与Chromium。新增共享Radix Tooltip，应用级一个Provider管理时序，Portal位于Select/Popover之上；工作区选项的完整路径不进入ItemText或常驻description。Select与Popover明确默认bottom/start，工作区更多移除唯一的end覆盖；附件添加、图标选择与审批等调用沿用相同默认，保留视口碰撞避让。

- AC-07 Pass：真实鼠标依次悬停两项，tooltip分别展示完整rootPath，选项本身只有目录图标与名称；选中后触发器仅名称。键盘打开、Home/方向键移动、路径提示及Enter选择通过，已有审批description与关闭回焦继续通过。
- AC-08 Pass：1280×900下工作区更多与工作区Select面板均位于触发器下方，左边缘差不超过1px，向右铺开。760×460下Select面板保持视口内且可选择。审计所有Popover/Select调用，没有其他end或left覆盖。已实际查看`output/playwright/workspace-menu-right.png`与`output/playwright/workspace-option-path-tooltip.png`，确认紧凑选项和悬停路径提示。

实际检查（Node24）：

| 命令或操作                                                                                                                         | 结果                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 修改的Web源码与E2E定向ESLint、Prettier、E2E类型检查                                                                                | Pass；Web三个编译面另由下一行覆盖。                                                                                             |
| `pnpm --filter @my-pi-harness/web build`                                                                                           | Pass；Web三个类型编译面与Vite生产构建通过。                                                                                     |
| `pnpm exec playwright test tests/e2e/workspace-navigation.spec.ts tests/e2e/workspace-creation.spec.ts tests/e2e/approval.spec.ts` | 首轮10项通过，新tooltip用例1项失败：在Select打开后用默认role定位背景触发器，因aria-hidden无法定位，尚未实际比较几何。           |
| `pnpm exec playwright test tests/e2e/workspace-navigation.spec.ts -g "工作区选项仅展示"`                                           | Pass；改为打开前记录触发器边界，并逐步等待键盘焦点。保留1px对齐和下方断言，产品没有为测试放宽行为。与首轮其余10项合计覆盖11项。 |
| `pnpm lint:a11y`、源码约定及依赖门禁                                                                                               | Pass；399份源码约定与361份依赖检查通过。                                                                                        |

本次检查使用隔离profile、临时工作区与合成模型，未调用真实供应商。目标文档格式、文档门禁及`git diff --check`收尾；未重复全仓测试或桌面打包、未commit或push。

## 移除工作区路径tooltip

按用户要求，工作区选项保留图标和名称，悬停与键盘聚焦不再显示路径tooltip；同时移除输入栏工作区祖先的原生title提示及无消费者的workspacePath视图字段。仅为该功能引入的Tooltip组件、应用Provider、Select包装与依赖已清理，Select描述项和菜单向右展开保留。

AC-07本机复验通过：工作区选项hover/focus后没有tooltip或title，输入栏触发器及祖先没有title；鼠标和逐步键盘选择仍只显示名称。既有整行hover、更多菜单、更名/删除、明确加号新建与窄视口避让继续通过。应用仍0.2.1，macOS arm64、Node24.20.0与Chromium，未提交或推送。

实际检查：修改的8份Web源码及E2E定向ESLint、Prettier、E2E类型检查通过；`pnpm --filter @my-pi-harness/web build`包含三个Web类型编译面与Vite构建通过；`pnpm exec playwright test tests/e2e/workspace-navigation.spec.ts tests/e2e/approval.spec.ts -g "目录只展开|工作区选项仅展示|工作区加号|权限菜单展示"`通过4项。源码约定394份通过，源码及依赖清单/锁文件已无Tooltip、workspacePath或Tooltip专用Select包装引用。收尾执行文档门禁与`git diff --check`，未重复全仓测试、daemon构建或桌面打包。
