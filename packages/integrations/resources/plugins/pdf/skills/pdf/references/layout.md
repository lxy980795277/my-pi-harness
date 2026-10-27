# PDF 排版与创建

长文本使用 `flow`：正文和表格会在页边距内自动换行、分页，表格可跨页并重复表头。内容是普通文字，`<b>` 等输入按字面量显示，不作为 HTML 执行或排版标记。每次创建只选择 `flow` 或 `pages`，不能与 `source` 编辑混用。

## 自动分页

`layout` 的尺寸与间距均为点（72 点等于 1 英寸）。可设置页宽高、四边距、`fontSize`、`lineSpacing`、页眉、页脚和 `pageNumbers`。默认 A4 附近尺寸、11 点正文、1.5 倍行距。可用字体为 `STSong-Light`、`Helvetica`、`Times-Roman` 和 `Courier`；中文使用 `STSong-Light` 并实际检查字形。该范围不包含任意字体文件加载。

`flow` 条目按顺序排列：

- `heading`：`text` 与 1–3 的 `level`，默认与后续内容同页。
- `paragraph`：`text`，可单独设置 `fontSize`、`lineSpacing`、`alignment` 和 `spaceAfter`。换行符保留，超长文本自动分页。
- `table`：等长 `rows`，可设置 `columnWidths`、`headerRows`、字号和行距。列宽总和不能超过可用页宽，单元格文字自动折行，长表格跨页。默认重复第一行。
- `page_break`：明确开始下一页，仅用于需要人工分节的地方。

```json
{
  "output": "report.pdf",
  "layout": {
    "font": "STSong-Light",
    "fontSize": 11,
    "margins": { "top": 48, "right": 42, "bottom": 48, "left": 42 },
    "pageNumbers": true
  },
  "flow": [
    { "kind": "heading", "text": "项目报告", "level": 1 },
    { "kind": "paragraph", "text": "正文可自动换行和分页。" },
    {
      "kind": "table",
      "headerRows": 1,
      "rows": [
        ["事项", "状态"],
        ["文档生成", "完成"]
      ]
    }
  ]
}
```

一次调用最多 300 个内容块，每表最多 500 行、20 列；整体请求、输出字节、页数和执行时长仍有上限。复杂长表格或紧凑布局可能需要拆分内容块或调整字号、列宽后重试，不绕过限制。

## 固定页面

`pages` 适合每页内容已明确的简单文件，条目包含 `text`、可选 `tables` 及页宽高。该模式不自动把溢出内容放到下一页，也不消费 `layout`。溢出会失败，长报告应选择 `flow`。两种模式都必须重开文件并查看页图；成功生成不意味着没有缺字或版式问题。
