# 会话日志去版本与持久读取整理

## Spec

### Roadmap Alignment

本轮属于M1会话存储可靠性及既有M3工作状态、M4收尾维护，沿用[roadmap](../../00_OVERVIEW/roadmap.md)，不进入M5。承接[输入栏模式清理](../202610281140_refactor_composer-model-controls/spec.md)，替换其引入的JSONL批次4门禁。

### Intent

移除Session JSONL外层批次version。新写入仅保留records与checksum；读取按必要字段和完整性解析，不因旧版附加元数据或已删除业务字段阻断旧会话。统一持久事件字段投影和业务校验schema，清除本次调整产生的重复及失效实现。

### Constraints

- 仅去掉外层批次version，不删除事件envelope、私有codec、附件格式、HTTP协议或SQLite迁移各自独立的版本。
- 保留命令批次原子性、checksum、连续seq、Session归属、大小限制、尾行恢复及私有请求引用解码；读取额外元数据前先以原始解析字段验证checksum，不能先删字段导致绕过原文完整性。
- 不分version3/4等分支，不新增旧字段名单或逐处delete mode补丁。结构可读的原有批次元数据通用选择，格式本身不可读的数据仍拒绝。
- 完整恢复引用及记录原codec baseline后，再将已登记公开事件数据按当前声明字段投影；privateData和模型原文保持，原日志不改写。
- 持久读取可丢弃未使用的额外字段，缺失必要字段、类型/范围错误和关系错误继续由所属解析器/投影拒绝。HTTP、新写业务及秘密输入仍严格校验，既有progress/audit扩展事件语义不变。
- 共享已存在的payload schema，不复制第二套字段定义；保留有实际输入职责的校验，不以删除校验换取简短代码。
- 保留尚未提交的输入栏与模型菜单改动，不清空会话、数据库、凭据或工作区，不主动管理用户已有开发进程；本轮不提交或推送。

### Acceptance Criteria

- AC1：新JSONL行只有records/checksum，生产代码不再包含外层批次version或版本分支；消费者与文档一致。
- AC2：原含额外批次/record/envelope元数据及旧WorkState.mode、嵌套checkpoint.state.mode的可读日志恢复成功，公开工作状态不带废弃字段，原日志字节保持。
- AC3：原文checksum不符、非法seq/Session归属、缺失/错误必要数据仍失败，未完整末行按原规则恢复；未知附加字段不改变既有权限或执行关系。
- AC4：持久事件字段选择与运行时payload校验共享声明，清除同域重复schema/重复nested checked与过时版本测试；HTTP仍拒绝已删除参数。
- AC5：真实构建后跨多次重启恢复、新旧批次混合追加、原始日志下载及所需源码/静态检查通过，记录实际结果和边界。

## UseCase

- UC1：重新启动含旧元数据与工作模式字段的受控profile，保留会话、附件、任务和检查点；无需迁移、清空或伪造新版version。
- UC2：恢复后继续对话，旧行保留，新行没有version；再次重启仍能恢复混合日志。
- UC3：修改原批次任一元数据但不重算checksum、破坏必要event字段或工作状态时，恢复被拒绝；不能通过容忍额外字段掩盖坏数据。
- UC4：下载固定已提交日志前缀，保持原字节与全部分支，读取投影不会改变原始导出。
- UC5：输入栏仍无执行/Plan模式，旧模式HTTP参数继续被拒绝；计划审核、Todo、模型菜单及审批行为保持。

## Tasks

- [x] 移除批次版本门禁，统一原文checksum与字段选择路径。
- [x] 集中持久事件payload schema和读取投影，清除重复声明与校验。
- [x] 补充旧元数据、旧工作字段、必要数据损坏及混合追加/多次重启回归。
- [x] 同步消费者和当前文档，完成定向/全仓检查及[验证记录](verify.md)。

## Issues

当前报错由旧批次3与固定批次4schema不匹配触发；单独删version仍会因旧mode等多余字段被当前WorkState严格校验拒绝。本轮分别处理外层原文解析与公开持久事件投影，不通过数据清空或跳过校验解决。

原始批次metadata必须先参与checksum再选择字段；codec原请求baseline必须先保存再投影公开字段，避免破坏后续数字引用。schema登记改为ReadonlyMap，未登记的constructor/toString等名称仍保留扩展事件语义。初始化session/branch、Run与完成消息均复用父payload schema，清除散落子对象解析。
