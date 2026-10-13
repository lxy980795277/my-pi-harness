# 前端约束

本文件适用于 `apps/web/src/`。Web 与 Electron Renderer 共用 React + Vite 页面，组件只通过 API 客户端或有限桌面桥访问外部能力。Renderer 不导入 Node、Electron main、daemon 源码、Pi、数据库或凭据存储；进程和源码依赖见 [架构](../01_ARCHITECTURE/overview.md)。

React 写法、组件目录和 Hooks 规则以 [React 约束](react.md) 为准；Store 划分、选择器、Actions 和更新规则以 [Zustand 约束](zustand.md) 为准。当前页面的状态与视觉行为见 [设计](../02_DESIGN/overview.md)。

## TypeScript 与输入校验

- 禁止使用 `any`，未知输入先声明为 `unknown`，通过校验后再进入业务层。
- 函数参数和返回值必须有明确类型；`FC<Props>`、已声明的回调类型和库接口上下文可提供准确类型，无需重复同一签名。
- 跨端 DTO、事件和桌面桥优先使用 `@my-pi-harness/protocol`，不在前端重复声明，不共享数据库 Entity、后台实现类型、环境配置或密钥。
- HTTP、SSE、IPC、配置和本地存储读取属于外部输入，执行实际解析与校验。接口缺字段或协议不兼容时显示错误，不用 `?? []`、`?? ''` 等默认数据伪装正常结果。
- 静态类型已保证的同进程值直接访问，不添加无依据的可选链、`typeof` 或 `instanceof`。类型本身声明为可选、可空或联合的值按其实际状态处理。
- 详细 ESM、导入和错误约束见 [TypeScript](typescript.md)。

## UI 与样式

- 通用控件优先复用 `components/ui/` 的 shadcn 组件；业务组件不得直接导入 Radix 原语，基础控件实现层可使用其对应原语。
- 图标统一使用 `lucide-react`，不引入第二套图标库；使用相等的 `width` / `height` 控制图标尺寸，禁止图标的 `size` 属性，纯装饰图标标记 `aria-hidden`。
- 引入另一套 UI 组件库须先确认；已经授权的依赖和既有基础组件正常使用。
- 样式优先使用 Tailwind CSS；复杂样式使用 SCSS，语义 CSS 变量提供共享 token。禁止 JSX 内联样式和硬编码颜色，不使用 CSS 变量 fallback。
- SCSS 使用 BEM 命名，禁止 `&-xxx` 拼接类名，嵌套不超过三层；普通组件的样式文件为本组件目录中的 `index.scss`。
- 使用背景 token 时配套对应 foreground token；新增语义颜色同时维护浅、深主题，避免在业务组件复制色值。
- 样式导入置于其他导入之后。基础适配覆盖桌面与平板，不预设移动端专属交互。
- 键盘焦点、按钮名称、错误说明和减少动态效果偏好遵循 [设计](../02_DESIGN/overview.md)。

## API、SSE 与状态所有者

- REST 统一经过 `services/base-request.ts`，SSE 统一经过 `services/base-sse.ts`；组件和 Store 不直接调用 `fetch` 或创建 `EventSource`。
- Feature 的 Service 定义领域调用、解析和错误；HTTP/SSE 的生命周期和传输细节由统一客户端负责。
- 跨 Service 共用的 API 前缀、Base URL 或 WebSocket 路径放 `constants/api.ts`。仅被一个 Service 使用的接口路径可在该 Service 内声明，不为每个字符串建立全局常量。
- TanStack Query 负责服务器快照与请求缓存；Zustand 负责客户端交互和跨组件 UI 状态，不保存 Query 已拥有的第二份可写缓存。当前 M0 没有独立 Store，不提前创建空 Store 或安装未使用依赖。
- Store 的业务动作调用 Service；如果请求属于 Query 管理的数据，则通过对应 Query / mutation 入口刷新其缓存，结果仍以服务返回为准。
- SSE 断线只改变连接状态，不代表后台任务已中止；任务停止必须来自明确控制请求。异步请求、订阅、计时器和第三方实例按 [React 约束](react.md) 清理。

## 性能与注释

- 大型列表使用虚拟滚动；流式事件批量更新，避免每个增量重渲染整个工作台。
- 通过 `React.memo` 减少实际存在的重复渲染，`useCallback` / `useMemo` 的使用范围见 [React 约束](react.md)。
- 动画使用 `transform` / `opacity`，避免复杂选择器，尊重减少动态效果设置。
- 组件文件超过 200 行时检查职责；超过 500 行必须评估拆分，超过 1000 行必须先拆分再提交。行数不能代替职责判断。
- 删除逐行解释代码的注释；保留非显然的决策、失败、资源归属和已知限制。公共 Hook / 工具函数用 JSDoc 说明调用者需要的行为。

Vite 配置属于 Node 构建程序，不是 Renderer 组件。此项目没有 Next App Router、SSR、`'use client'` 或 Tiptap 编辑器专属规则；重型界面按需使用 `React.lazy` 和动态 `import()`。
