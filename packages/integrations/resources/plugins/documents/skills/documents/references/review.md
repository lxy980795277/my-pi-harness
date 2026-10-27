# DOCX 编辑与审阅

先用 `office_inspect` 获取已有段落和原生对象信息。编辑始终传 `source` 与全新的 `output`；输出已存在会失败。源文档编辑不能同时提交新建用的 `paragraphs`、`tables` 或 `images`。页面设置、默认字体、命名样式和默认页眉页脚可显式调整，未请求的 OOXML 部件保留。

## 选择明确操作

| 操作                             | 用途与限制                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `replace_text`                   | 原文必须在一个普通段落里唯一出现；可跨普通文字 run，不能跨字段、超链接、已有修订或复杂对象。它不生成修订记录。                                     |
| `tracked_replace`                | 使用 `old`、`replacement`、`author` 创建真实删除/插入修订并保留原 run 格式。匹配必须唯一且完全位于一个普通 run 中；拆分 run 或复杂对象会明确拒绝。 |
| `revisions`                      | `action` 为 `accept` 或 `reject`，仅处理普通段落的插入删除修订；移动、格式、表格等复杂修订不支持。                                                 |
| `format_paragraph`               | 用从零开始的 `paragraph` 索引指定段落，设置 `style`、`font` 或 `format`，不替换其正文。索引按正文中包含表格单元格的段落顺序计算。                  |
| `comment_add` / `comment_remove` | 按段落添加批注，或按现有批注 ID 删除。不要把批注当成正文。                                                                                         |
| `note` / `bookmark` / `field`    | 添加脚注尾注、书签及 TOC/REF/SEQ 域。引用目标必须存在；域结果仍需 Office 引擎更新。                                                                |
| `content_control` / `metadata`   | 添加纯文字内容控件或设置受支持的核心元数据；不提供任意嵌入或表单脚本。                                                                             |

```json
{
  "source": "report.docx",
  "output": "report-reviewed.docx",
  "operations": [
    { "kind": "tracked_replace", "old": "待审核", "replacement": "已审核", "author": "Reviewer" },
    {
      "kind": "format_paragraph",
      "paragraph": 0,
      "font": { "size": 20 },
      "format": { "keepWithNext": true }
    }
  ]
}
```

`mergeSources` 仅适用于简单段落和表格文档。图片、编号、超链接、修订、字段、批注、脚注等需要迁移关系或 ID 的结构会拒绝；目标缺失的样式也会拒绝。不要把简单合并描述成复杂模板合并，或删除不支持的对象来让工具通过。

完成后检查原文是否保留、预期内容是否出现、批注/修订数量和引用关系是否符合请求。渲染图只显示一个外观状态，不能替代对真实修订、批注、字段和内容控件的结构核查。
