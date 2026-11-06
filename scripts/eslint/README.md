# 仓库ESLint规则

根`eslint.config.js`从本目录的`config.js`加载`createConfig(rootDirectory)`，为全部 JS/TS、测试及构建配置提供 ESLint flat config。类型感知程序明确区分宿主、Web 和 Web 测试编译面，no-floating-promises、no-misused-promises和no-deprecated始终开启；弃用判断使用当前依赖的类型声明。

Renderer检查具名FC、完整箭头函数、Hook、Store选择器、HTTP/SSE所有者，以及全面禁三目、void运算符和异步方法链。`presentation-only`检查业务TSX的Service/Query导入、裸控件、内联事件及多步map；QueryClientProvider、类型导入和基础UI原生实现保留。状态与资源所有权仍需审查，不做完整别名分析。

`check-source-conventions.mjs` 检查命名、组件目录、helper聚合、样式导入顺序、1000行上限和TS模块无后缀/原生脚本与资源显式扩展；types目录拒绝冗余的`*-view`文件名，其他目录可保留有实际视图职责的名称。唯一异步事件桥仅允许一条具名、说明责任的Promise启动豁免。输出目录不检查，生成源码只按明确路径豁免。工作区依赖由 `check-boundaries.mjs` 执行，Oxlint负责a11y。

全部入口接入根 `pnpm lint`，合法/非法fixture和真实配置覆盖检查位于 `tests/unit/`。规则适用面见 [规范入口](../../docs/05_CONSTRAINTS/overview.md)，不能将lint通过当完整设计或用户验收证明。

本目录是仓库工程工具，不作为workspace包；自定义规则位于frontend-rules.js，直接由config.js加载，相关依赖在根devDependencies维护。普通Node加载这些JavaScript模块，引用保留实际.js扩展。
