# Zustand 约束

Zustand Store 按明确业务域拆分，只保存需要跨组件共享的客户端状态；局部 UI 状态使用 `useState`。服务器快照与 Query 缓存的职责见 [前端约束](frontend.md)，不在 Store 复制同一服务器数据的第二个可写来源。

## 读取 State 与 Actions

- 组件必须通过选择器读取 State 和 Actions。禁止 `useXxxStore()` 无参调用，禁止从整个 Store 直接解构；每次订阅只读取当前组件需要的值。
- Actions 也通过选择器取得；禁止在组件中通过 `useXxxStore.getState()` 读取状态或 Actions。
- 禁止在函数中间临时调用 `xxxStore.getState()`，禁止用 `get().xxx` 链式访问。需要快照时在允许的 Store 内动作入口明确读取并命名；组件保持选择器订阅。
- 禁止 State 使用 `any`；状态与 Actions 使用准确类型。箭头函数和 Hook 写法遵守 [React 约束](react.md)。

```typescript
const activeSessionId = useSessionStore((state: SessionState): string | null => {
  return state.activeSessionId;
});
const selectSession = useSessionStore((state: SessionState): SessionState['selectSession'] => {
  return state.selectSession;
});
```

## 选择器结果稳定

- 不在普通选择器中返回临时创建的默认对象或数组，例如 `state.items ?? []`、`state.item ?? {}`。这些表达式可能反复产生新引用；默认值必须是稳定常量，实际缺失状态按类型定义处理。
- 多字段组合优先拆成独立选择器；需要浅比较的组合值可使用 `useShallow`。不要把这个官方用法误判为禁止的新对象返回。
- `useShallow` 只比较第一层，组合结果含有新建的嵌套对象、数组或函数时仍需稳定引用，不能靠包装隐藏不稳定默认值。

[Zustand 的 useShallow 文档](https://zustand.docs.pmnd.rs/learn/guides/prevent-rerenders-with-use-shallow.html) 给出组合选择器的浅比较方式；本仓库禁止的是没有稳定化处理的选择器结果与默认值。

## 更新与跨域协作

- Store Action 调用 Service，不在组件或 Store 内直接 `fetch`；调用链为组件触发 Action、Action 调用 Service、Service 使用统一 HTTP/SSE 客户端、Action 更新自身状态。
- 不直接修改 State；通过 `set` 或 `produce` 更新。只有实际使用 Immer 时才引入它，不为规范预装依赖。
- 禁止跨 Store 直接读写。跨域通信通过显式参数或事件传递，不在一个 Store 中查询或修改另一个 Store 的快照。
- 可回滚的 UI 操作先乐观更新自身交互状态，后端失败时回滚。服务数据的乐观修改在其 Query / mutation 所有者内进行，不创建另一个缓存。
- 写操作成功后以后台返回值覆盖或刷新对应状态，不能把未经确认的本地修改永久当作已保存结果。
- 异步 Action 对关闭、切换目标或重试后的过期响应进行取消或版本判断，避免旧结果覆盖新状态。
- Store 持久化只保存实际需要恢复的客户端偏好，不用 LocalStorage 推断后台任务、会话或资源是否存在；这些事实由服务状态确定。

当前 M0 的连接由一个页面 Hook 管理，没有独立的 Zustand Store。功能产生真实跨组件客户端状态后，再建立对应 Store 和依赖；本规范不要求创建演示 Store。
