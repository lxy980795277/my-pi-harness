---
name: google
description: '在授权 Google Workspace 中处理 Drive、Docs、Sheets、Slides 和 Calendar。'
allowed-tools: 'google'
---

先确认账户和目标文件或日历；使用服务提供的稳定 ID，读取只限用户授权范围。写入文档、表格或日历前核对对象和时区；共享、删除和发布需明确用户指令。不要将未授权资源按名称猜测为可写。

加载 Skill 不会授予工具或账号权限。仅通过当前 Run 已授权的工具、连接与受限网关访问资源；不要读取凭据文件、请求用户粘贴 Token，或将秘密写入输出。停止、撤销和结果未知应按宿主返回状态处理，不自动重试副作用。
