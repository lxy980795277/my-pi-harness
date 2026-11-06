# PDF 版式

长报告使用 ReportLab Platypus，固定坐标的页面使用 Canvas。可导入 `pdf_layout.build_flow(settings, stream)`：settings 包含 flow 列表和 layout。flow 的块可为 heading（text、level）、paragraph（text）、table（rows、columnWidths、headerRows）或 page_break。layout 使用 PDF 点，支持 width、height、margins、font、fontSize、lineSpacing、header、footer、pageNumbers。中文默认 STSong-Light 不代表当前机器所有字形都已验证。

```python
from cli_support import new_output
from pdfs import pdf
settings = {'flow': [
    {'kind': 'heading', 'text': '季度报告', 'level': 1},
    {'kind': 'paragraph', 'text': '数据说明。'},
    {'kind': 'table', 'rows': [['项目', '金额'], ['收入', 120]], 'headerRows': 1},
], 'layout': {'pageNumbers': True}}
report = new_output('report.pdf', '.pdf', lambda output: pdf(settings, output))
print(report)
```

固定布局可组合 pdfs.pdf 的 pages 辅助参数（text、tables），或自行用 Canvas 排版并调用 inspect_pdf。采用安全的新目标并检查对象范围。段落/单元格内容是文字，避免把用户正文解释为标记语言。长行、中文、表头重复、跨页行和页数必须用最终页图检查。
