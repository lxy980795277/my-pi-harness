---
name: documents
description: '在工作区创建、检查和受控修改 DOCX 文档。'
allowed-tools: 'office_docx office_inspect'
---

使用 office_inspect 确认输入结构、支持操作和依赖，再调用 office_docx。每次修改使用新的 output，不覆盖 source。保留文档未涉及结构，按支持范围处理段落、批注、修订和引用；复杂结构不支持时明确说明。检查 validation 和 notVerified；需要视觉确认的输出使用可用渲染流程核查。

加载 Skill 不会授予工具或账号权限。仅通过当前 Run 已授权的工具、连接与受限网关访问资源；不要读取凭据文件、请求用户粘贴 Token，或将秘密写入输出。停止、撤销和结果未知应按宿主返回状态处理，不自动重试副作用。
