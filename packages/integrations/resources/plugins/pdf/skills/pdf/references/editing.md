# PDF 页面与表单

先 `office_inspect`，再按用户请求提交 `office_pdf`。`source` 保持原样，`output` 必须不存在。不要把 PDF 提取文本重新排成新文件后宣称保留原版式。

## 页面处理

`selectPages` 为从 1 开始的页码列表，按所列顺序提取和重排；`rotations` 指定页码及 90/180/270 度旋转；`appendSources` 追加普通 PDF。交互表单与选页、合并需要额外关系处理，工具不支持的组合会拒绝。核对输出页数、页序、旋转和需要保留的导航行为，静态页图不能证明交互链接正常。

`overlays` 使用从页面左下角起算的点数坐标，指定 `page`、`x`、`y`、`width`、`height`，可加 `text` 或 `cover`。只支持未旋转页面，不能超出页面边界。这是叠加内容，不删除底层文字、图像或历史信息；需要不可恢复脱敏时明确说明当前工具不支持。

## 字段填写

`office_inspect.fields` 提供字段名、类型、值和 flags；选择字段还提供 `options` 的 `export` 和 `label`。`fields` 参数使用真实字段名：

- `/Tx`：字符串，遵守只读和最大长度限制；密码字段拒绝。
- 简单 checkbox `/Btn`：布尔值，由工具核对唯一的选中 appearance；单选按钮和普通按钮不支持。
- `/Ch`：用选项的 `export` 字符串；多选列表可用非空字符串数组。数组仅用于明确允许多选的列表，不能用于 combo box。未知导出值、重复值和含歧义标签的选项会拒绝。

```json
{
  "source": "form.pdf",
  "output": "form-filled.pdf",
  "fields": {
    "applicant": "张三",
    "consent": true,
    "region": "east",
    "topics": ["design", "testing"]
  }
}
```

选项标签和导出值可以不同；按检查结果构造输入，不根据视觉文字猜值。保存后工具会复读字段值。appearance 存在仍不证明用户在查看器中看到正确值，必须用页图检查受影响字段；其他查看器行为没有实际检查就不宣称通过。

`repairFields` 只修复缺失或空字段树中简单、唯一命名的文本/checkbox 控件，不猜测复杂父子关系。`flatten` 仅限为所有简单文本字段提供明确值的场景，会将 appearance 画入页面并移除交互控件；不支持 choice/checkbox 扁平化。先确认用户需要静态副本，保留交互源文件。

最终按批次查看每个新建或受影响页面，每次 `pdf_read_pages` 最多 4 页。核对文字、表格分页、表单显示值和图像质量；缺依赖、无视觉模型、未检查的页或未验证的查看器行为应如实保留。
