# DOCX 创建与版式

脚本可使用 python-docx 的 Document、Cm、Pt、表格和图片 API。模板先用 `documents.inspect_docx(path)` 校验，再打开；保留原文件。可通过 `documents.docx(settings, temporaryOutput)` 一次创建与应用受支持的版式，再由 `cli_support.new_output` 发布新文件。settings 是本地 Python 辅助函数参数，不是工具请求或脚本总派发协议。

```python
from cli_support import new_output
from documents import docx
settings = {
    'paragraphs': [{'text': '项目说明', 'heading': 1}, {'text': '正文内容'}],
    'tables': [{'rows': [['项目', '数量'], ['样例', '1']]}],
    'layout': {'width': 595, 'height': 842, 'margins': {'top': 56, 'right': 56, 'bottom': 56, 'left': 56}},
}
report = new_output('report.docx', '.docx', lambda path: docx(settings, path))
print(report)
```

高级格式通过 python-docx 或 `word_layout` 的具体函数配置；读取当前 `word_layout.py` 再使用参数，页尺寸、边距、字号和图片尺寸使用点（1 点为 1/72 英寸）。页眉页脚可含真实 PAGE/NUMPAGES 域，目录/引用可通过 docx_edit 的 field 子命令添加。内嵌 PNG/JPEG 图片先核对大小和比例。不要把占位文字当作已更新的域值。
