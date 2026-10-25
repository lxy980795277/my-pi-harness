---
name: github
description: '在授权的 GitHub 仓库中查找代码、Issue 与 Pull Request。'
allowed-tools: 'github'
---

先识别目标 owner、repository 和当前连接账户，读取后给出可核对的对象链接。创建、评论、合并或修改前说明目标和效果，由宿主按工具审批流程执行。不要把应用登录当作 GitHub 工具授权。

加载 Skill 不会授予工具或账号权限。仅通过当前 Run 已授权的工具、连接与受限网关访问资源；不要读取凭据文件、请求用户粘贴 Token，或将秘密写入输出。停止、撤销和结果未知应按宿主返回状态处理，不自动重试副作用。
