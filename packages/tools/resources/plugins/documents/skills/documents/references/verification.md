# DOCX 验证

运行 inspect 检查 ZIP/XML、内部关系、备注引用、书签、表格和字段；重新打开输出。域和目录需要 Word 或 LibreOffice 实际更新，脚本保存只证明字段存在。

`python convert_pdf.py report.docx preview.pdf` 使用独立 LibreOffice 用户目录实际转换。等命令成功，再用 view_pdf_page 检查所有页面或明确声明抽查范围。检查最新渲染中的字体、缺字、标题分页、长表、页码和页眉页脚；不能把历史页图当新结果证据。

发布前分别报告结构通过、实际渲染范围、视觉查看页码和未验证的域计算/字体问题。保留中间 PDF 便于复验，需要交付时再单独 publish_artifact。
