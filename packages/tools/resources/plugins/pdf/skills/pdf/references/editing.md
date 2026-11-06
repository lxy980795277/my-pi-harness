# PDF 页面与表单

`pdf_edit.py inspect input.pdf` 返回字段类型、当前值、flags 和 choice 选项的 export/label。操作形如：

```sh
python pdf_edit.py select input.pdf selected.pdf 3 1 2
python pdf_edit.py append selected.pdf combined.pdf appendix.pdf
python pdf_edit.py rotate input.pdf rotated.pdf --page 1 --degrees 90
python pdf_edit.py form input.pdf filled.pdf --set name '"Alice"' --set agree true
python pdf_edit.py form input.pdf chosen.pdf --set regions '["east","west"]'
```

choice 必须使用 export 值并满足单选/多选 flags；checkbox 用布尔值或检查出的合法状态。表单值与生成外观分别验证。`--repair` 仅修复简单字段树缺失；`--flatten` 需要显式提供每个字段的值，仅支持已验证的文本字段外观，checkbox/choice 扁平化拒绝。表单编辑和页选择应分成不同输出；追加含表单 PDF 拒绝字段冲突。

辅助库仍支持有界视觉 overlays，但覆盖层不删除原内容，不能用于安全脱敏。加密、签名、XFA、动作/脚本与嵌入附件拒绝；保留源文件并说明原因。
