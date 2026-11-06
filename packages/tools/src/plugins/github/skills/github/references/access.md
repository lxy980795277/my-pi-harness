# GitHub 只读访问与写入工具

将当前Skill记录中的gatewayUrl作为API根地址，用web_fetch GET访问user、user/repos、users/{login}、users/{login}/repos、search/{类型}及repos/{owner}/{repo}/...。例如读取PR使用repos/{owner}/{repo}/pulls/{number}，读取Actions运行使用repos/{owner}/{repo}/actions/runs。路径片段和查询值按URL编码，不填写认证头。

网关使用插件市场中授权的唯一GitHub账号。未连接时提示用户在插件详情授权；应用登录不代表插件已授权。列表核对分页、仓库、编号和状态，返回API中的真实对象链接。

评论、创建、关闭、合并或发布通过tool_search查询已启用并信任的GitHub MCP，命中会自动加载，下一次请求按返回的真实名称调用。不存在可用工具时报告缺项，不能把GET网关变成写请求。

写请求结果未知时先停止并查询结果，不自动重发。账户断开或插件停用后不能继续使用旧授权。
