---
name: presentations
description: '创建与检查 PPTX 原生文本、表格、图表及页面布局。'
allowed-tools: 'office_pptx office_inspect'
---

先使用 office_inspect 核对模板结构、页面尺寸和依赖，再调用 office_pptx。每次修改创建新的 output，不覆盖 source。保持未涉及模板部分，检查内部引用、表格内容、空系列与越界对象；需要视觉复验时完成渲染，不能以保存成功代替版式验收。报告 validation 与 notVerified。

加载 Skill 不会授予工具或账号权限。仅通过当前 Run 已授权的工具、连接与受限网关访问资源；不要读取凭据文件、请求用户粘贴 Token，或将秘密写入输出。停止、撤销和结果未知应按宿主返回状态处理，不自动重试副作用。
