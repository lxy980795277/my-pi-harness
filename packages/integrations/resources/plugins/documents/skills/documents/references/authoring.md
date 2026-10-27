# DOCX 排版与创建

`office_docx` 的尺寸、缩进和间距均使用点（point，72 点等于 1 英寸）。例如 A4 约为 595 × 842 点。选择符合内容密度的页边距，避免用缩小字体弥补过宽表格。字体名称不会安装字体；最终仍需检查渲染环境的中文和符号覆盖。

## 页面、样式与正文

- `layout` 可设置 `width`、`height`、四边 `margins` 及 `headerDistance`、`footerDistance`。设置作用于文档各节；需要逐节不同版式的文档不在当前参数范围内。
- `defaultFont` 设置 Normal 样式的 `name`、`size`、`color`、`bold`、`italic`、`underline`。`styles` 可创建或调整命名段落样式，`basedOn` 指向已经存在的段落样式。不要创建循环继承。
- 每个 `paragraphs` 条目只选 `text` 或 `runs`。`runs` 的各段可以有独立 `font`，适合一句话内的强调。`heading` 使用真实标题样式，`style` 选择命名样式。
- 段落 `format` 支持 `alignment`、`lineSpacing`、`spaceBefore`、`spaceAfter`、左右与首行缩进、`keepWithNext`、`keepTogether` 和 `pageBreakBefore`。首行缩进为负时产生悬挂缩进。标题可设置与下段同页，正文不应全部锁成一页。

以下参数示例创建有明确版式的文档：

```json
{
  "output": "report.docx",
  "layout": {
    "width": 595,
    "height": 842,
    "margins": { "top": 54, "right": 48, "bottom": 54, "left": 48 }
  },
  "defaultFont": { "name": "Arial", "size": 11 },
  "styles": [
    {
      "name": "Report Body",
      "basedOn": "Normal",
      "format": { "lineSpacing": 1.5, "spaceAfter": 8 }
    }
  ],
  "header": { "text": "项目报告", "alignment": "right", "font": { "size": 9 } },
  "footer": { "text": "页码 ", "alignment": "center", "pageNumber": true },
  "paragraphs": [
    { "text": "进展报告", "heading": 1, "font": { "size": 22 } },
    {
      "style": "Report Body",
      "runs": [{ "text": "结论：" }, { "text": "通过", "font": { "bold": true } }]
    }
  ]
}
```

示例中的字体仅为参数演示，应根据用户模板和实际可用字体选择。样式名称使用 Word 的真实名称或当前请求新建的名称，未知样式会失败。

## 表格、页眉页脚与图片

`tables` 使用等长的 `rows` 创建可编辑表格；可指定现有表格 `style`（例如 `Table Grid`）和 `headerRows` 重复表头。复杂合并单元格、逐列宽度控制和嵌套表格不在创建参数范围内。长表格要用真实数据长度检查跨页结果。

`header`、`footer` 设置各节的默认页眉页脚文本、字体和对齐；`pageNumber: true` 插入真实 PAGE 域。原有首页、奇偶页专用内容不等于默认页眉页脚。显式替换默认内容前先确认用户意图，随后检查各节。

`images` 仅用于新建文档，按段落、表格、图片的顺序追加。每个条目包含工作区相对 `source`、点数 `width`、可选 `height`、必填 `altText` 和可选 `alignment`。仅支持 PNG/JPEG、单图最多 5 MiB 和 1600 万像素；图片由宿主复制到临时目录后检查，不能使用 URL、SVG、工作区外路径或源文档编辑中的追加图片。未指定高度时保留比例，尺寸不能超过页面可用区域。
