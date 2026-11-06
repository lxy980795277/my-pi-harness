# DOCX 精确编辑与审阅

所有命令形如 `python docx_edit.py <operation> input.docx output.docx ...`，不会覆盖已有目标。段落索引从零开始，包括表格内段落；每一步以最新 inspect 报告为准。

- `replace input.docx output.docx '旧文本' '新文本'`：唯一普通段落匹配，可跨普通 run，不跨字段、链接、修订或复杂对象。
- `track input.docx output.docx '旧文本' '新文本' --author '审阅者'`：真实 w:del/w:ins，旧文本须在一个普通 run 中唯一匹配。
- `revisions input.docx output.docx accept` 或 reject：仅普通段落 run 的插入/删除；结构、移动、属性或嵌套修订拒绝。
- `comment input.docx output.docx --paragraph 1 --text '核对依据' --author '审阅者'`；`remove-comment ... --id 0` 删除真实批注。
- `note ... --paragraph 1 --type footnote --text '注释'`：type 也可为 endnote。
- `bookmark ... --paragraph 1 --name Anchor` 与 `field ... --type ref --target Anchor`：真实书签和 REF 域；field type 也可为 toc 或 caption。
- `control ... --tag status --text '已核对'`：真实文本内容控件。
- `merge base.docx result.docx appendix.docx`：只接受无图片、链接、编号、备注、修订或关系对象且样式已存在于基础文档的简单段落/表格。

字体、样式、元数据和段落格式可以在工作区脚本中调用 `documents.docx` 或 `word_layout` 的明确函数完成；先读函数参数，再以新文件输出。保留不涉及部件不等于支持所有复杂模板编辑，辅助库拒绝的操作不能通过重建文档后声称等价。
