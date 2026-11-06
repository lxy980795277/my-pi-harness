# XLSX 原生对象与计算

工作区脚本使用 openpyxl，写入新文件；保留数字为数字、公式以 = 开头、格式用 number_format，表格和图表使用原生对象。可导入 `spreadsheets.xlsx(settings, temporaryOutput)` 和 `cli_support.new_output`：settings 包含可选 source 和 sheets，各 sheet 含 name、rows、startCell、cells、tables、charts。cells 支持 cell/value、bold、fontSize、fill、numberFormat；tables 使用 name/range；charts 使用 anchor 及 chart 的 kind、categories、series。先阅读这些具体辅助函数，不能向未知参数猜测调用。

```python
from cli_support import new_output
from spreadsheets import xlsx
settings = {'sheets': [{'name': 'Data', 'rows': [['项目', '金额'], ['甲', 10], ['乙', 20]],
    'cells': [{'cell': 'B4', 'value': '=SUM(B2:B3)', 'numberFormat': '0.00'}],
    'tables': [{'name': 'Sales', 'range': 'A1:B3'}],
    'charts': [{'anchor': 'D2', 'chart': {'kind': 'bar', 'categories': ['甲', '乙'],
        'series': [{'name': '金额', 'values': [10, 20]}]}}]}]}
print(new_output('report.xlsx', '.xlsx', lambda path: xlsx(settings, path)))
```

inspect_xlsx 限制 20 个工作表、总单元格面积 20000，检查外链、关系、宏、嵌入对象和公式缓存。编辑辅助库拒绝 VML/slicer 和外部/网络/DDE 公式。openpyxl 不执行公式；recalculate 命令只在实际安装 LibreOffice 时运行，检查保存缓存及错误，仍需对关键结果做独立业务核对。需要保留复杂 Excel 特性时明确说明软件转换风险，不能宣称任意模板无损。
