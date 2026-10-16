# 共享静态规则

`createConfig(rootDirectory)` 为全部 JS/TS、测试及构建配置提供 ESLint flat config。类型感知程序明确区分 NodeNext 宿主、Web Bundler 和 Web 测试面，no-floating-promises、no-misused-promises和no-deprecated始终开启；弃用判断使用当前依赖的类型声明。

Renderer检查具名FC、完整箭头函数、Hook、Store选择器、HTTP/SSE所有者，以及全面禁三目、void运算符和异步方法链。`presentation-only`检查业务TSX的Service/Query导入、裸控件、内联事件及多步map；QueryClientProvider、类型导入和基础UI原生实现保留。状态与资源所有权仍需审查，不做完整别名分析。

`check-source-conventions.mjs` 检查命名、组件目录、helper聚合、样式导入顺序、1000行上限和Web无后缀/Node显式扩展；types目录拒绝冗余的`*-view`文件名，其他目录可保留有实际视图职责的名称。唯一异步事件桥仅允许一条具名、说明责任的Promise启动豁免。输出目录不检查，生成源码只按明确路径豁免。工作区依赖由 `check-boundaries.mjs` 执行，Oxlint负责a11y。

全部入口接入根 `pnpm lint`，合法/非法fixture和真实配置覆盖检查位于 `tests/unit/`。规则适用面见 [四份规范](../../docs/05_CONSTRAINTS/overview.md)，不能将lint通过当完整设计或用户验收证明。
