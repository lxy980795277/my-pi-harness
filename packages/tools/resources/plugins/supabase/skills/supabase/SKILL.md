---
name: supabase
description: '检查授权的 Supabase 项目、数据库结构与服务状态。'
allowed-tools: 'web_fetch'
---

先核对项目引用和环境。优先只读查询；迁移、写数据、部署函数与配置变更均经审批。对 SQL 明确参数、影响范围和预期结果，不把超时等同于未提交；结果未知时停止并请用户核对。

加载 Skill 不会授予工具或账号权限。仅通过当前 Run 已授权的工具、连接与受限网关访问资源；不要读取凭据文件、请求用户粘贴 Token，或将秘密写入输出。停止、撤销和结果未知应按宿主返回状态处理，不自动重试副作用。

## 已连接服务的只读访问

当前激活Skill记录中的gatewayUrl是本机只读入口。使用web_fetch GET请求该入口下的服务API路径；宿主附加认证，不传入认证头，也不读取凭据。网关拒绝的路径不能绕过或改为上游直连。修改操作通过tool_search搜索已启用的MCP工具；命中会自动加载，下一次模型请求按返回的真实名称调用，继续遵守用户授权和工具审批。

通过gatewayUrl下的v1/profile、v1/organizations、v1/projects及指定项目的health、database/openapi、config/database或readonly路径读取管理信息。网关返回不允许的路径时，使用实际MCP目录确认可用能力。
