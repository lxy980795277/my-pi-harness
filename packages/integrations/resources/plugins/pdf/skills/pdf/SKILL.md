---
name: pdf
description: '创建 PDF，选择与修改页面、填写字段，并读取指定页图。'
allowed-tools: 'office_pdf office_inspect pdf_read_pages'
---

使用 office_inspect 核对加密、签名、XFA 和字段状态，再用 office_pdf 处理支持的操作。每次修改写入新的 output，不覆盖 source。通过 pdf_read_pages 读取指定页面并检查内容与版式。视觉遮盖不能称为不可恢复脱敏；检查 validation 与 notVerified，缺少渲染依赖时明确报告。

加载 Skill 不会授予工具或账号权限。仅通过当前 Run 已授权的工具、连接与受限网关访问资源；不要读取凭据文件、请求用户粘贴 Token，或将秘密写入输出。停止、撤销和结果未知应按宿主返回状态处理，不自动重试副作用。
