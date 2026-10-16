# 附件

AttachmentService拥有上传和显式工作区引用的校验、解析、取消与冻结；存储通过ProfileStore不可变附件文件和可重建索引实现。GET内容接口需本机授权，普通快照和SSE只返回元数据/ID。

支持UTF-8文本、PNG/JPEG/GIF/WebP、PDF，以及DOCX/DOCM、XLSX/XLSM、PPTX/PPTM、ODT/ODS/ODP、RTF、EPUB文本提取；不提供OCR或宏执行。解析复用execution的受限worker，关闭等待在途解析结束。文件名/MIME、大小、签名、UTF-8、解压和输出预算在保存前检查，损坏和超限明确失败。

引用执行工作区真实路径和敏感目录检查；冻结后预览不重新打开源文件。前端添加菜单按产品决定不提供引用入口，宿主API和已有引用预览保留。字段、限额和HTTP语义统一见[协议](../../../../../docs/03_API/context-interaction.md)。
