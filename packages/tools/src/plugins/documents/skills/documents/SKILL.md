---
name: documents
description: '创建、精确编辑和审阅 DOCX，保留真实修订、批注、脚注、字段及模板部件，并检查渲染页面。'
allowed-tools: 'run_command wait_command read_document view_pdf_page view_image publish_artifact read_skill_resource'
---

# Word 文档

先确认读者、语言、页面、交付位置和模板。已有 DOCX 先运行 `"$PYTHON" -B -s "$SKILL_ROOT/scripts/docx_edit.py" inspect input.docx`，查看段落索引、表格、样式、修订、批注、书签、字段、备注和节属性。仅回答正文问题可直接用 `read_document`。

普通创作在工作区编写 Python 脚本，使用 python-docx 生成原生段落、表格、图片和页眉页脚；需要本项目版式和 OOXML 检查时使用 `scripts/documents.py` 与 `scripts/word_layout.py`。先读 `references/authoring.md`。设置实际页尺寸、边距、中文字体、行距与段落样式；长表重复表头，避免空格排版。保留模板未涉及部件，不能以重建纯文本代替模板编辑。

精确编辑与审阅读 `references/review.md`。`docx_edit.py` 提供 replace、track、revisions、comment、remove-comment、note、bookmark、field、control、merge 等独立子命令；运行 `--help` 查看参数。先检查索引与目标，再生成新文件。普通替换、真实修订和接受/拒绝修订分别执行；目录、交叉引用及题注必须用真实域，保存不代表域已计算。

先运行 `"$PYTHON" -B -s "$SKILL_ROOT/scripts/docx_edit.py" dependencies`。结构通过后，按 `references/verification.md` 用 `convert_pdf.py input.docx preview.pdf` 实际转换，再用 `view_pdf_page` 检查页图。重点检查中文缺字、标题孤行、表格断行、页眉页脚、图片与页码。

## 资源和执行

`SKILL_ROOT` 表示本次 `load_skill` 返回的 `resourceDirectory`，只能使用该精确目录内的资源；不要猜测源码、插件安装根或 profile 路径。`run_command` 提供通用解释器环境变量 `MY_PI_HARNESS_PYTHON`；在命令中先设 `PYTHON="${MY_PI_HARNESS_PYTHON:-python3}"`，使用宿主已配置的解释器，未配置时检查明确存在的 `python3`。以下命令中的变量需替换为本次返回的绝对路径，并正确引用含空格的路径。工作文件、脚本与输出放在工作区，资源目录只读。使用 `PYTHONDONTWRITEBYTECODE=1`；自写脚本导入辅助库时将 `PYTHONPATH` 设为 `$SKILL_ROOT/scripts`。

先执行当前格式的 `dependencies` 命令，检查 `missingModules`、`converter` 与 `ready`。这一步不安装软件。解释器、Python 包、字体或 LibreOffice 缺失时，说明具体缺项；依赖安装只能作为明确授权的普通 `run_command` 执行，不静默下载。`requirements.txt` 是该 Skill 的 Python 依赖清单；转换器和系统字体另行准备。

`run_command` 可能返回 `running`。保留 `commandId`，通过 `wait_command` 等待终态；检查退出码、stderr 和截断信息。文件存在或有部分 stdout 不能证明成功。取消、失败或未知结果先检查事实，不自动重跑可能生效的操作。加载 Skill 不授予命令、网络、账号或写入权限；只读角色只能检查输入。

每次写入使用新的目标文件，保留输入；辅助 CLI 拒绝覆盖现有文件。自写脚本也遵守这个规则，先检查输入，再生成副本。辅助脚本的结构报告不会自动注册可下载产物。

## 验证和交付

生成与必要验证的命令全部成功终止后，重新打开最终文件，分别记录结构检查、实际计算或转换、视觉检查。`read_document` 提取正文，不能证明布局正确；`view_pdf_page` 每次查看至多四页，`view_image` 查看实际图像，两者需要视觉模型。没有视觉模型或转换器时明确标记未完成的视觉检查，不声称版式通过。修改后检查最新输出。

最后调用 `publish_artifact` 注册工作区最终文件；若提供 `producerCommandId`，使用同一任务中已成功终止的生产命令。交付使用宿主返回的 artifact ID 和下载入口，不从 stdout、Markdown 路径或自报 hash 推断可信下载。说明检查范围与剩余限制。
