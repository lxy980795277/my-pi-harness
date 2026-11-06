# TypeScript模块导入统一无后缀

## Spec

### Roadmap Alignment

属于M0源码约定治理，承接已完成的源码Node/tsx运行。既有M1–M5功能、协议24、SQLite10和资源权限保持；M6及其他平台/账号缺口继续保留原状态。

### Intent

统一前后端由tsx或构建器加载的TS/TSX模块导入：普通模块路径不写源码或编译扩展名，避免TS源码长期引用虚拟.js名称。同步真实消费者、规范与可执行门禁。

### Constraints

- 用户已明确授权，替代此前暂缓.js后缀修改的决定；用户后续已明确要求本地提交，按0.18.2同步版本与记录，不推送。
- 按TypeScript AST和实际目标修改import、export、import type及字面量动态import，不正则替换所有字符串。
- 真实JS/MJS/CJS模块、JSON、CSS、图像等静态资源保留实际扩展；普通Node直接运行的脚本仍按原生解析要求书写路径。
- Worker源码、子进程入口、new URL、import.meta.resolve等按真实运行方式检查，不因出现.js字样机械删除。包名导入及package exports的实际文件路径保持。
- 不更改业务行为、依赖版本、权限、持久格式、资源hash或用户数据，不读取真实.env及凭据。
- 不新增扩展名猜测运行时、兼容转发文件或源码别名；使用现有tsx/Vite加载能力。

### Acceptance Criteria

- AC-1：所有相关TS/TSX真实模块导入统一无后缀，静态/动态/类型引用及公开重导出完整覆盖，转换前后实际目标相同。
- AC-2：普通Node脚本及真实资源的扩展保留，嵌入脚本和动态启动入口逐项核对，生产exports和入口可正常解析。
- AC-3：门禁区分TS模块与真实JS/资源，正向fixture接受无后缀及必要资源扩展，反向fixture拒绝旧TS后缀和原生脚本的无扩展导入，不依赖不存在的目标得出结论。
- AC-4：类型、静态、完整源码回归、真实Web/Electron构建及CLI/隔离部署检查通过；实际macOS应用目录启动提供生产解析证据。
- AC-5：规范和当前入口文档同步，历史验证命令保持原事实；验证记录列明实际执行范围及平台限制。

## UseCase

- UC-1：daemon/runtime/protocol中的TS相对模块改无后缀，类型检查与Node/tsx执行解析到原文件，工具定义与消息行为保持。
- UC-2：动态import、类型import和目录index引用采用无后缀，构建与源码运行可解析；真实.mjs/.cjs/JSON与URL资源仍正常加载。
- UC-3：对真实磁盘fixture运行门禁：带.js的TS引用被拒绝，真实JS引用被接受，plain Node无扩展ESM被拒绝，包名出口不受影响。
- UC-4：隔离生产deploy中的包出口、插件资源、PDF及四个Skill执行通过；Electron JS/CJS与源码daemon共同启动，退出及安全检查保持。

## Tasks

- [x] T0：核对干净工作区、已有运行方式和本轮授权范围。
- [x] T1：AST转换真实TS模块引用并核对目标一致。
- [x] T2：审查普通Node、tsx辅助脚本和嵌入/动态入口。
- [x] T3：更新门禁及真实正反fixture。
- [x] T4：同步规范与架构说明，运行源码、构建、部署及桌面验证。
- [x] T5：记录验证结果及未覆盖事项。
