# 本地办公文档

安装 Documents、PDF、Spreadsheets 或 Presentations 插件，选用对应Skill后，Agent可在注册工作区创建和修改办公文件。也可由Agent搜索并加载 `office_*` 工具。工具使用当前会话审批策略，Skill不会自动获得额外权限。

## 准备依赖

办公执行使用已安装的Python 3和公开库，不在对话中隐式联网安装。可在仓库根显式创建独立环境：

```sh
python3 -m venv .cache/office-venv
.cache/office-venv/bin/python -m pip install -r packages/execution/resources/office/requirements.txt
```

在daemon启动环境中设置 `MY_PI_HARNESS_OFFICE_PYTHON` 为这个环境的绝对解释器路径；默认只查 `/opt/homebrew/bin/python3`、`/usr/local/bin/python3` 和 `/usr/bin/python3`。不存在解释器或缺包会明确返回 `OFFICE_DEPENDENCY_MISSING`；不会冒充任务成功。解释器必须由应用部署者配置，模型不能通过工具参数更换程序。

`office_render`另需已经安装的LibreOffice（`soffice`、`libreoffice`或macOS应用目录），用于把DOCX/XLSX/PPTX转换为PDF。缺依赖时转换明确失败。没有执行转换与页图检查，不应声称版式已通过验收。安装包不包含Python/LibreOffice，部署者需显式准备；依赖检测与实际格式支持分开判断。

## 文件与结果

所有输入、输出都必须使用工作区相对路径。修改始终产生新文件，输出不能已存在，源文件不覆盖；失败和取消不留下已发布的半成品。目录需先存在。工具结果给出文件相对路径、字节数、SHA-256、结构检查和未验证项。展开已完成的工具详情即可下载文档，未验证项也在详情中展示。下载绑定本次工具记录ID和原始hash；文件后来被修改时明确拒绝，避免交付与日志不一致的内容。检查详情过长会明确缩短预览，产物及校验信息保留；可指定页面或对象进一步检查。

- `read_file`复用通用文档正文提取；`office_inspect`额外检查DOCX结构、PDF字段、XLSX公式缓存和表格图表、PPTX原生形状和尺寸。
- `pdf_read_pages`返回1–4个指定页面的真实PNG，页码从1开始；仅视觉模型可以消费，不进行OCR。
- `office_docx`支持段落、标题、表格创建及受限结构编辑。精确替换不能跨字段/修订/超链接；仅接受或拒绝普通段落的插入删除修订。复杂修订或有复杂关系的合并会明确拒绝。目录、交叉引用和题注使用真实域，需Office应用更新结果。
- `office_pdf`支持新建、选页/排序/旋转/追加、文本及简单勾选字段填写、有界文本表单扁平化、简单字段树修复和区域覆盖。加密、签名、XFA及活动内容拒绝。白色覆盖保留可恢复的底层内容，不是安全脱敏。
- `office_xlsx`支持数据、公式、样式、表格及原生图表。公式会保存，但不会自动计算；没有缓存时无法验证数值结果。错误单元格和外部链接有明确诊断。
- `office_pptx`创建及修改原生文本、表格、图表；编辑模板时保留尺寸和既有包部件，越界形状和空图表系列拒绝。仍需渲染核实文字溢出和视觉重叠。

每个格式的限制和实际验证由[M4.8设计](../04_FEATURES/202610201932_feature_m4-capabilities/office.md)及验收记录维护。云端文档另经外部服务连接授权，本地办公工具不自行读取账号凭据。
