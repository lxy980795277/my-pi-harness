# Google 只读网关与 Workspace Apps

当前Skill的gatewayUrl连接插件市场中授权的唯一Google账号。使用web_fetch GET请求drive/v3/files及单个文件、导出和评论路径，或calendar/v3/users/{user}/calendarList与calendar/v3/calendars/{calendar}/events。保留分页标记，按URL编码对象ID和查询值，不自行附加认证头。

Docs、Sheets、Slides的正文读取与修改，以及Drive或Calendar写操作，使用tool_search搜索对应的Workspace MCP工具；命中会自动加载，下一次请求按返回的真实名称调用。每个App单独开启；插件授权成功不代表App已经启用。

写入前读取对象与必要版本。支持writeControl、revision或ETag时使用并发条件；冲突后重新读取，不能无条件覆盖他人修改。取消批量任务时记录已完成部分，不自动重跑全部。

区分授权scope不足、App停用、账号断开与供应商API未启用。请用户在插件详情授权或启用App，不读取浏览器Cookie、系统凭据或让用户把秘密发进对话。
