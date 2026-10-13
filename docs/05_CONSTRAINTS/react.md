# React 约束

本文件规定 `apps/web/src/` 的通用组件、Hook 和文件组织。外部能力、类型和样式以 [前端约束](frontend.md) 为准。

## 组件与函数

- 使用函数组件和 `FC<Props>`，统一声明为 `export const Xxx: FC<Props>`，禁止默认导出。没有 Props 的组件使用 `FC`。
- 组件使用 PascalCase；文件与目录使用 kebab-case；变量、函数使用 camelCase；数据常量使用 UPPER_SNAKE_CASE；Store Hook 使用 `useXxxStore`。
- 箭头函数必须写完整函数体。返回表达式写显式 `return`，禁止 `() => expression`；返回 `void` 的动作在函数体内执行，不添加无意义的返回值。
- 复杂渲染拆为子组件，业务逻辑和副作用拆为自定义 Hook；优先复用已有组件，避免重新实现相同 UI。
- 不在 JSX 中执行复杂转换、副作用或请求；多条件文本和类名使用有明确类型的映射对象。
- 禁止 JSX 三目条件渲染，使用 `&&` 和明确的反向条件；不要把数字直接作为 `&&` 的左侧，以免渲染数字 `0`。

## 组件目录

页面只组合布局与 Feature。业务代码按域放在 `features/<domain>/`，私有组件留在本域；跨域复用组件放在 `components/`，不反向导入 Feature 的私有实现。

每个手写组件使用独立 kebab-case 目录，入口为 `index.tsx`。组件内部需要的样式、Hook、私有类型和子组件放在同一目录；没有需要时不创建空文件。通用的组件私有 Props 可直接留在组件文件内，不要求单独建立类型文件。

```text
component-name/
  index.tsx
  index.scss
  hooks.ts
  types.ts
  sub-component/
    index.tsx
```

- `config/services/stores/constants/hooks/utils` 禁止建立 `index.ts` 聚合导出，调用方直接导入叶文件；`types/` 可使用类型入口。
- 不创建 `lib/` 目录，通用工具使用 `utils/`；`context/` 使用单文件，不创建额外层级。
- Service 的 API DTO 使用 protocol；其前端内部参数类型放在对应 `types/`，不在 Service 中重复定义共享类型。
- 文件名不加冗余 `.store.ts` / `.service.ts` 后缀；深层路径通过 `@/` 别名导入，保持显式 `.js` 文件入口。
- 第三方 CLI 生成的未修改 shadcn 控件可保留其上游导出、类型与文件布局；例外仅适用于生成的基础控件，不扩展到业务组件。项目手写基础控件同样遵守组件规则。

## Hooks 与生命周期

- Hook 只在组件或自定义 Hook 顶层调用，禁止在条件、循环、事件处理函数中调用。
- 局部 UI 状态使用 `useState`；跨组件客户端状态按 [Zustand 约束](zustand.md) 归属，不把可派生值保存为第二份状态。
- Effect 的依赖数组完整列出实际读取的响应式值，不禁用依赖检查掩盖陈旧闭包。
- 异步 Effect 支持取消或丢弃过期响应；卸载、切换资源和重试前清理请求、订阅、计时器和第三方实例，防止旧结果覆盖当前状态。
- Effect 只同步外部系统；可以在渲染时计算的值不通过 Effect 再写入 state。开发 StrictMode 的额外 setup / cleanup 必须正常工作，不能通过全局“只初始化一次”标记跳过清理。
- 自定义 Hook 返回的函数使用 `useCallback`；传递给 `React.memo` 子组件的回调、作为 Effect 依赖的函数使用 `useCallback`。组件内普通事件处理函数无需包装。
- `useCallback` / `useMemo` 非必要不使用，不将所有函数或计算机械地缓存；依赖必须反映实际使用的值。

React 的 [Effect 文档](https://react.dev/reference/react/useEffect) 说明依赖和 setup / cleanup 的行为；[useCallback 文档](https://react.dev/reference/react/useCallback) 说明函数缓存。项目的箭头函数体、组件导出和 JSX 条件写法属于本仓库约定。
