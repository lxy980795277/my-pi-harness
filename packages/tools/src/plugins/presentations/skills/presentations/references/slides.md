# PPTX 原生对象与模板

使用 python-pptx 创建文字、原生表格和图表，坐标使用英寸或明确 EMU 转换。可组合 `presentations.pptx(settings, temporaryOutput)` 与 `cli_support.new_output`，其中 settings 的 slides 包含 shapes，shape 的 kind 为 text/table/chart，坐标字段为 x/y/width/height。chart 使用 kind、categories 和 series；series 含 name/values。模板 source 不允许更改 width/height。

```python
from cli_support import new_output
from presentations import pptx
settings = {'width': 13.333333, 'height': 7.5, 'slides': [{'shapes': [
    {'kind': 'text', 'x': 0.6, 'y': 0.5, 'width': 11, 'height': 0.8, 'text': '项目进展', 'fontSize': 30},
    {'kind': 'table', 'x': 0.6, 'y': 2, 'width': 6, 'height': 2, 'rows': [['阶段', '状态'], ['设计', '完成']]},
]}]}
print(new_output('brief.pptx', '.pptx', lambda path: pptx(settings, path)))
```

模板编辑使用 source 和 edits。edit 含从零开始的 slide/shape；text 修改 text，table_cell 加 row/column/text，chart 修改 chart 数据但不改变既有图表种类。原生图表类别和值长度必须一致，饼图只允许一个系列。保存后检查部件集合和页尺寸，并逐页查看渲染。部件名存在不能证明所有 PowerPoint 语义无损，视觉重叠与文字适配必须实际检查。
