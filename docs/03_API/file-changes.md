# 文件变更与撤销重做

原生write_file和edit_file通过daemon的文件变更服务执行。宿主把前后原始字节存入不可变blob，先持久化准备事实，再发布文件并记录实际结果。工具保留文本编辑语义，sandbox负责路径、稳定读取、原子发布及受控删除，storage拥有日志、投影和资源引用。

## 查询

接口沿用应用登录、来源和CSRF规则，公开数据由[文件变更DTO](../../packages/protocol/src/sessions/file-changes.ts)定义，不包含宿主绝对路径、inode或内部目标键。

| 接口                                                       | 行为                            |
| ---------------------------------------------------------- | ------------------------------- |
| GET /api/sessions/:id/file-changes                         | 按seq倒序读取全部分支的受管变更 |
| GET /api/sessions/:id/file-changes/:changeId               | 分段读取diff、before或after     |
| GET /api/sessions/:id/file-changes/operations              | 分页读取用户操作历史            |
| GET /api/sessions/:id/file-changes/operations/:operationId | 查询一个持久批次及每项结果      |

列表支持cursor、limit、toolCallId和inputMessageId，limit范围1至50。inputMessageId是根回答输入锚点，包含该回答发起的子任务修改。单项详情支持side、offset及maxBytes，最大内容预算60 KiB；offset按UTF-16字符推进且不拆开代理对。diff超过比较限制时仍可读取修改前后正文。

每项包含存在性、hash、字节数、受支持的0777权限位、来源、实际结果、local及当前undoAvailable/redoAvailable。local表示当前宿主拥有的原生变更，导入历史为false，即使后续绑定本机工作区也不改变旧记录的资格。批量选择只接受local且state为applied或undone的项；同文件较早的变更可以在后续项先撤销后变得可操作，不能只按单项undoAvailable筛选。

列表另返回canOperate，表示完整查询范围内存在local且写入结果已确认为applied的原生变更；其范围包含toolCallId或inputMessageId筛选，不受当前cursor页影响。整回答和批量入口消费该字段，纯导入历史仅供阅读。不存在与零字节文件分别记录。展示资格来自历史操作链，真正操作仍重新核对磁盘，不能把按钮可用视为当前文件未被外部修改。

## 用户操作

POST /api/sessions/:id/file-changes/operations接收operationId、action及selection。action为undo或redo，selection为具体changeIds，或kind为answer的inputMessageId。宿主冻结完整选择集合，超过50项明确拒绝，不只操作当前列表页。

接收事实持久后返回202，已终结的相同请求返回200。相同operationId和相同选择返回原回执，改变请求内容返回FILE_CHANGE_OPERATION_CONFLICT。网络响应丢失不表示操作未发生，客户端通过原ID查询，只有明确用户重提才再次POST同一个请求。

撤销按实际修改链逆序，重做按正序；连续选中同一文件的多次修改会先模拟完整链。所有目标先预检，每项执行前再检查。不同会话、嵌套工作区及主子任务共用profile短写入锁，目标按canonical路径和父目录身份关联；撤销后的新写入使旧重做链失效。文件内容、存在性、权限、工作区身份或顺序不符时报告冲突，其他独立项可以继续完成。

POST /api/sessions/:id/file-changes/operations/:operationId/cancel接收空对象，只阻止未开始项；已开始的原子操作结算后再停止。关闭面板或HTTP连接不隐式取消已接收任务。回执保留成功、冲突、未应用、取消及未知结果，刷新后可通过操作历史找回。

## 故障与范围

文件发布前有持久屏障。只有sandbox证明目标系统调用尚未开始时才能记录未应用；尝试发布后出错保持未知。磁盘已写而终态日志失败时冻结持久写入，重启按权威日志重建。恢复只读核对当前文件；即使当前字节匹配前像或后像，也不能单凭它证明历史是否执行。已归档会话的未结算操作仍参与观察，只允许追加单条file.operation.observed以释放共享待发布锁，不恢复会话可见性或执行权限。已有单文件终态可用于补齐未更新的批次进度，剩余项不会自动续跑。

已有文件保留受支持权限位，新文件使用0600。原始BOM、换行和空文件均可精确恢复。符号链接、多重硬链接和受保护路径拒绝。外部程序不受应用锁控制，复查与目标系统调用之间仍有竞态窗口，不承诺任意进程之间严格CAS。

分支与checkpoint切换不写磁盘。Shell、MCP及办公脚本的任意修改不具备可靠原生前像，不纳入本功能。产物继续指向已发布的不可变快照，撤销工作区文件不会改写产物历史；导入的历史前后像仅供阅读，不自动获得本机撤销资格。
