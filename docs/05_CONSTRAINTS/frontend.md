# 前端规范

适用于 `apps/web/src/`，浏览器与 Electron Renderer 共用。TSX 负责布局、组件组合和简单绑定；纯计算放 `.ts` 函数，请求、Query、状态转换及副作用放 `.ts` Hook。进程和依赖方向见 [架构](../01_ARCHITECTURE/overview.md)，交互与视觉见 [设计](../02_DESIGN/overview.md)。

## 类型、导入与目录

- 使用 strict、noUncheckedIndexedAccess、exactOptionalPropertyTypes。禁止 any、非空断言、双重 unknown 断言或 ts-ignore 掩盖输入问题；未知输入先用 unknown，再解析。
- 参数和返回值有准确类型；FC、已声明回调与库接口的上下文可提供类型，不重复同一签名。interface 描述对象，type 描述联合与组合；可辨识联合表达生命周期。
- DTO/schema 使用 `@my-pi-harness/protocol`，不重复声明，不共享数据库 Entity、宿主配置、凭据或 Pi 内部对象。HTTP、SSE、IPC 和本地持久化读取必须实际校验；同进程已声明类型不堆猜测性可选链、typeof 和空值兜底。
- Web 源码及其独立 test 编译面由 Bundler 解析，相对与 `@/` 模块导入不写 `.js/.ts/.tsx` 后缀，样式和静态资源保留实际扩展。深路径优先用 `@/`，类型使用 import type。NodeNext 宿主及根 E2E 的 `.js` 规则不适用于 Renderer。
- 组件 PascalCase，文件与目录 kebab-case，函数与值 camelCase，固定数据常量 UPPER_SNAKE_CASE，Store Hook 为 useXxxStore。
- 页面只组合布局与 Feature。业务代码放 `features/<domain>/`，跨域组件放 `components/`；不反向导入另一 Feature 的私有组件。
- 每个手写组件独占目录，入口 `index.tsx`；按实际需要放私有 Hook、类型、样式和子组件，不创建空文件。`config/services/stores/constants/hooks/utils` 不建 index 聚合导出；types 可有类型入口。不建 lib，工具放 utils，context 使用单文件。
- 文件名不加冗余 `.store/.service` 后缀。一个类型由真实所有者定义，只有跨端共享类型进入 protocol，不建万能 types 包。

## React 与 TSX 分工

- 手写组件使用具名 `export const Xxx: FC<Props>`；无 Props 使用 FC，不写默认导出、类组件或函数声明组件。箭头函数使用完整函数体与显式 return。
- TSX 不直接导入业务 Service、HTTP/SSE 客户端或 Query 编排 API。QueryClientProvider 等 Provider 组合与 type 导入允许；QueryClient 创建、useQuery/useMutation/useQueryClient 以及缓存动作放 `.ts`。
- 复杂选项、查找、筛选、多条件文案和类名构建放 `.ts` 函数或所属 Hook。JSX 的 map 只返回已准备数据的界面，不在回调里塞多步计算；不为每个简单表达式新建工具。
- JSX 事件绑定具名函数，不写内联箭头或函数表达式。简单局部状态绑定可留组件内，多步业务动作与异步流程放 Hook。
- 手写 TS/TSX 全面禁止三目运算符，使用 if、提前返回或准确映射。条件渲染使用布尔值与 `&&`，不把数字直接放左侧，以免渲染 0。
- 复杂渲染拆子组件，业务逻辑拆 Hook；按职责拆分，不用空转发组件规避规则。组件超过 200 行检查职责，超过 500 行评估拆分；所有手写源文件超过 1000 行必须先拆分。200/500 是 review 提醒，1000 由 gate 拒绝。
- 第三方生成控件的例外必须登记具体路径及原因；不能将整个 UI 目录视为生成代码。当前手写基础组件同样遵守 FC、命名与异步规则。

## Hooks、异步与资源

- Hook 只在组件或自定义 Hook 顶层调用。Effect 只同步外部系统，可派生的值直接计算，不用 Effect 复制状态；依赖完整，不禁用依赖检查掩盖陈旧闭包。
- 请求、订阅、计时器和实例由所属 Hook 清理，卸载、目标切换和重试时取消或忽略过期结果。StrictMode 的额外 setup/cleanup 必须正常，不用全局初始化标记跳过清理。
- 异步使用具名 async 函数与 await，需要处理错误时使用 try/catch/finally。禁止 void 运算符以及 then/catch/finally 方法链；返回类型 void、Promise<void> 与 try 的 catch/finally 正常保留。
- Promise 必须 await、返回或交给明确拥有异常与取消的事件桥；不关闭 no-floating-promises/no-misused-promises。唯一 `hooks/use-async-event.ts` 同步入口允许一条有责任说明的启动豁免，execute 内处理异常与取消；不能复制到其他文件或扩展为通用后台任务入口。
- 普通服务写入由 Query mutation/领域 Hook 管理。秘密表单使用局部 Hook，立即清空提交值，不能把 Key、Token 或秘密回复放入 mutation variables、Query、Zustand、浏览器持久化或诊断。
- catch 输入为 unknown，保留具体错误；不把失败转换为空集合或成功。结果未知的写操作不自动重试，关闭 UI 不代表后台任务已停止。
- 自定义 Hook 返回的函数、memo 子组件回调及 Effect 的函数依赖按需要 useCallback；普通组件事件无需机械缓存。useMemo/useCallback 只处理实际稳定引用或重复计算问题，依赖反映真实读取。

## Query、Service 与 Zustand

- REST 统一经 `services/base-request.ts`，SSE 经 `services/base-sse.ts`；Feature Service 负责领域调用、解析及错误，传输所有者负责连接与清理。组件和 Store 不直接 fetch 或创建 EventSource。
- Query 拥有服务器快照与缓存；Zustand 只持有跨组件客户端状态，例如导航、选择、Dialog 和未提交草稿。局部 UI 用 useState，不复制 Query 数据形成第二份可写事实。
- API 公共前缀放 constants/api；仅一个 Service 使用的路径留在该 Service，不把每个字符串变全局常量。
- Store 按真实业务域拆，State/Actions 准确类型。组件通过窄选择器分别订阅状态与动作；禁止无参 useXxxStore、返回整个 state、组件/Hook 调用 getState，以及 get().member 链式读取。Store 内需要快照时在动作入口命名 get() 结果。
- 普通选择器不创建临时对象、数组或新引用的兜底。多值优先独立选择器；确实需要组合时用 useShallow，并稳定嵌套引用。稳定常量默认值可用，不能借默认值掩盖无效协议。
- State 通过 set 或实际已使用的 produce 更新，不直接修改。跨 Store 协作经明确参数或事件，不彼此读取或改写快照；不为范式预装 Immer。
- Store Action 只管理其客户端状态，领域请求经 Service/Query 所有者。服务写入成功采用服务返回或刷新缓存；乐观更新有失败回滚，异步动作防止旧结果覆盖新目标。
- Store 持久化只保存明确偏好，不用 LocalStorage 推断会话、授权或任务存在；后台事实以服务为准。SSE 断线只改变连接状态，停止必须来自控制请求及服务事实。

## shadcn、样式与可访问性

- 弹窗标题和字段已能表达的操作不重复解释；说明用于必要条件、权限、风险或恢复。删除冗余描述时同步维护aria-describedby，保留有意义的标题与键盘焦点。

- 业务交互控件使用 `components/ui/` 的 shadcn 实现，不裸写 button/input/textarea/select/option/optgroup/label/fieldset/legend，不直接导入 Radix。基础 UI 内允许必要 HTML 与 Radix 原语。
- 普通布局优先 div/span；form、真实 a 链接、details/summary 和必要语义保留。不把可点击 div/span 当按钮，不能牺牲键盘、焦点、禁用或表单行为来满足标签偏好。
- 动作图标使用 lucide-react，尺寸用相等 width/height，不用 size，装饰图标 aria-hidden。Provider 品牌仅允许已引入的 `@lobehub/icons-static-svg` 静态资产，不因此引入第二套动作图标库。
- 样式用 Tailwind 与语义 token；复杂样式可用本组件 index.scss，BEM 命名、嵌套不超过三层、不写 &-xxx 拼接。不写 JSX style、硬编码颜色或 CSS 变量 fallback；背景与 foreground 成对，维护浅/深主题，样式 import 最后。
- Dialog、Select、ScrollArea 等基础组件的动态样式使用页面 nonce；生产 style-src 与 nonce 由宿主生成，不用 unsafe-inline/unsafe-eval 绕过 CSP。
- Select统一以轻微背景表示焦点，不因关闭菜单后的自动回焦新增边框或光圈；保留焦点恢复与键盘选择。对话输入容器仅在文本输入聚焦时改变边框，不由底部工具栏选择器触发。
- Select和Popover下拉默认从触发器下方开始边对齐，向右展开，保留视口碰撞避让；工作区选项只显示图标和名称，不添加路径说明行或路径悬停提示。
- 大列表虚拟滚动，流式事件批量更新。动态行高可在所属 ref 中设置有限数值 CSS 变量用于总高度与偏移；不允许业务数据或颜色进入 style，不开放 JSX style。
- 动画以 transform/opacity 为主，尊重减少动态效果；适配桌面和平板。控件有名称、错误说明和焦点状态，Dialog 支持键盘与关闭后的焦点恢复。
- 注释只说明非显然行为、失败、时间和所有权，不逐行翻译或保留开发过程。公共 Hook/函数提供调用者需要的 JSDoc；删除注释掉实现与无职责副本。

机械检查的范围和人工判断见 [测试规范](testing.md)。库行为参考 [React Effect](https://react.dev/reference/react/useEffect)、[useCallback](https://react.dev/reference/react/useCallback)、[Zustand useShallow](https://zustand.docs.pmnd.rs/learn/guides/prevent-rerenders-with-use-shallow.html)；具名 FC、无三目和 TSX 分工属于本仓库约定。

领域类型命名、业务联合抽离、弃用API和空值表达式可读性统一遵守[代码治理](../10_GOVERNANCE/code.md)；不在此维护第二份通用规则。
