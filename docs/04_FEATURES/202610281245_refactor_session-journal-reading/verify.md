# 会话日志去版本与持久读取验证

日期：2026-10-28，北京时间。macOS arm64、Node24.20.0、pnpm10.34.6、产品0.11.0。AC1–AC5及UC1–UC5在以下范围通过，未提交、推送、清理或迁移用户数据。

## 实现与精简

新写入SessionBatch只有records/checksum。唯一批次schema声明必要字段并允许附加元数据，读写复用原文checksum计算；没有批次version字段、分版本decoder或旧mode字段名单。原批次、record和envelope的附加字段先以原始解析对象参与checksum，再按当前字段投影；原日志不重写，新追加只保存当前字段。

event-validation集中Session/Run/Message/Work/Checkpoint/Tool/Capability公开payload定义，持久读取与业务投影使用同一schema。删掉散落的等价声明，RunAccepted.run及MessageCompleted.message直接使用实际子schema，SessionCreated整体解析session/branch，消费者不再逐处重复解析相同子对象。私有请求schema由codec和工作投影共用，字段子集通过Pick派生，不复制字段规则。

stored-event只在codec完整解引用及保存原baseline后，对自有clone的公开envelope/data选择字段；不填默认值、不转换类型、不清理privateData或模型原文。核心payload和业务关系继续由原投影校验，HTTP与新写仍严格。未登记progress/audit数据语义保持，ReadonlyMap避免constructor等名称命中对象继承属性。

## 实际验证

正式命令使用仓库固定Node24.20.0的PATH，重叠测试不累加。

| 命令或检查                                                                                        | 实际结果                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| journal及codec两文件定向Vitest                                                                    | 63项通过，2.27秒；含旧批次/record/envelope元数据、原字节保留、新追加无version、元数据篡改checksum拒绝及新写严格性。                                                           |
| 持久投影、工作状态、codec、工具及storage五文件定向Vitest                                          | 79项通过；覆盖旧工作/检查点mode、required/type/union/关系错误、private原文数字引用及RecordUnknown工具参数不丢失。                                                             |
| pnpm build                                                                                        | 8项成功、5缓存，实际重建storage/runtime/daemon，8.001秒；Web与其他未变产物沿用缓存。                                                                                          |
| daemon test:built，筛选preserves frozen attachments, tasks and restored session snapshot branches | 1项通过，另5项因筛选跳过；受控profile在三次真实产物启动之间读旧元数据/旧工作字段、继续追加无version批次并再恢复，检查历史原字节及附件/任务/分支。                             |
| pnpm exec playwright test tests/e2e/session-log.spec.ts tests/e2e/composer-model.spec.ts          | 5项全部通过，17.1秒；固定前缀下载、完成后下载、取消旧下载、模型菜单及旧模式HTTP参数拒绝均通过。                                                                               |
| pnpm check                                                                                        | 全仓格式、ESLint、a11y、778源码导入、842文件约定、当时190文件文档及版本检查通过；8workspace类型成功、6缓存。161个源码测试文件1667项通过、2项跳过，55.02秒。                   |
| 收尾共享SessionCreatedSchema后的定向检查                                                          | 该文件ESLint/格式、storage类型通过；stored-event/storage/journal/context-work四文件72项通过，3.76秒。重建8项成功、5缓存，8.325秒；三次启动产物恢复用例再次通过，1项、6.00秒。 |

全仓check发生在最后将SessionCreated的两个子解析合为共享父schema之前，收尾覆盖由最后一行单独提供；没有为同一内容重复跑全仓测试。补齐本verify后另执行文档和diff检查。

## 现有桌面会话的隔离回放

针对此前启动失败的桌面profile，以readonly SQLite连接调用backup API创建临时数据库副本，复制所属JSONL及附件到独占临时目录，用构建后的storage打开副本。仅输出恢复数量和原文件哈希一致性，不输出消息正文或凭据；未打开独立凭据文件或向外部服务发请求。

实际恢复1份原日志、1个会话、14条消息、12条工具记录；公开工作状态没有mode，原始用户日志的SHA-256在副本回放前后保持一致。临时副本finally清理，原数据库未被打开为写连接，没有删除或迁移原会话。该次现有数据回放在最后的SessionCreated共享解析收尾前完成，后续同类创建和恢复路径由上述定向源码及产物用例覆盖。

因此原有日志无需改version、重算checksum或清空，完整重启项目后可按新读取路径回放。结构本身不可读、必要字段损坏或codec不符合要求的任意历史数据仍可能被拒绝，不把本次成功描述为支持所有历史格式。

## 未验证范围

没有启动用户实际桌面窗口或操作其登录、配置和授权；未新增真实供应商、Windows、安装包、签名或公证验收。公开协议18、SQLite schema8、事件envelope1及私有codec版本保持，本轮仅删除JSONL外层批次版本。此前输入栏和模型菜单的未提交修改完整保留，没有自动管理已有开发端口。
