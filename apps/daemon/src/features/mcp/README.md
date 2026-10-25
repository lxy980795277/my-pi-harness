# 本地MCP宿主

`McpService`拥有本地Server配置用例、系统秘密槽位、按隔离范围记录的启动授权和工具目录缓存。持久配置通过`ProfileStore.mcp`写入SQLite，秘密字节通过独立系统凭据ref保存；响应逐字段组成安全DTO，不返回ref、秘密、协议原文或异常cause。管理HTTP沿用统一登录、Origin与CSRF保护，路径见[管理协议](../../../../../docs/04_FEATURES/202610201932_feature_m4-capabilities/local-mcp-contracts.md#8-管理api与界面)。

GET列表、详情和缓存工具目录不启动进程。用户明确预览后，trust重新解析有效程序、显式文件入口、工作根和环境指纹；保存匹配revision/accessEpoch的作用域授权并启用。sandboxed与full-access分别确认。发现与测试是明确启动动作，短租约结束即关闭；目录缓存在内存中，重启后需要重新发现供新输入选择。

普通配置和秘密轮换拒绝活动租约，写入新ref后CAS保存，冲突或写入失败回滚新ref。停用、撤销和凭据删除先持久封禁旧授权，再回收连接；重新信任不会复活原Run或队列绑定。浏览器退出登录保留profile级授权和已接受Run；显式profile身份撤销使用独立identity epoch。

`ExternalTools`适配接受输入时冻结的定义与非秘密授权。队列恢复先核对原授权，再从持久JSON schema恢复真实TypeBox元信息，不启动Server或重绑最新选择。实际调用取得新租约后核对完整工具定义指纹，在runtime派发屏障前后再次校验授权；审批、JSONL调用事实与unknown停止策略由agent-runtime拥有，连接和真实进程由integrations/execution拥有。

服务关闭先拒绝新操作，由应用服务停止Run并结算结果，然后等待MCP连接关闭，最后关闭模型与存储。当前stdio正向验收限macOS；其他平台明确不提供受监管本地MCP执行。
