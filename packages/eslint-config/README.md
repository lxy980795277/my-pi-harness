# 共享静态规则

`createConfig(rootDirectory)` 为全部JS/TS、测试和构建配置提供ESLint flat config。TypeScript parser显式列出实际程序，执行类型感知规则；Renderer仅使用browser globals，Node脚本、main与daemon使用其宿主配置。

ESLint负责类型、Promise、Hook、具名FC、箭头函数体、JSX条件/样式、Store选择器与HTTP/SSE调用位置。`frontend-rules.js`检查显然的声明和调用写法，不执行别名分析或证明跨Store状态所有权；生成源码例外必须明确登记，当前手写基础控件没有例外。

可访问性由根Oxlint配置补充，避免使用不支持ESLint10的插件。源文件命名、组件目录、样式导入、helper聚合导出、1000行上限和ESM扩展由 `scripts/check-source-conventions.mjs` 执行；进程/工作区依赖由 `scripts/check-boundaries.mjs` 执行。全部入口接入根 `pnpm lint`，非法与合法fixture及配置覆盖测试位于 `tests/unit/`。

适用规范见 [约束](../../docs/05_CONSTRAINTS/overview.md)。设计复杂度、状态归属、取消责任与UI语义仍需review，不能把lint通过当作完整架构证明。
