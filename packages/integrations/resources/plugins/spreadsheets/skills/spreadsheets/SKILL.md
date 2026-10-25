---
name: spreadsheets
description: '创建、编辑和检查 XLSX 数据、公式、格式、表格与图表。'
allowed-tools: 'office_xlsx office_inspect'
---

先用 office_inspect 检查工作簿和依赖，再调用 office_xlsx。修改创建新的 output，不覆盖 source。核对工作表、范围、表格和图表引用；公式保存不表示已计算，必须检查缓存、错误单元格和 validation。无法计算时说明 notVerified，不编造公式结果。

加载 Skill 不会授予工具或账号权限。仅通过当前 Run 已授权的工具、连接与受限网关访问资源；不要读取凭据文件、请求用户粘贴 Token，或将秘密写入输出。停止、撤销和结果未知应按宿主返回状态处理，不自动重试副作用。
