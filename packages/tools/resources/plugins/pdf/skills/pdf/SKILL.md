---
name: pdf
description: '创建自动分页或固定布局 PDF，处理页面和 AcroForm 表单，并核查真实页图。'
allowed-tools: 'run_command wait_command read_document view_pdf_page view_image publish_artifact read_skill_resource'
---

# PDF 文档

已有 PDF 先运行 `"$PYTHON" -B -s "$SKILL_ROOT/scripts/pdf_edit.py" inspect input.pdf`，确认页数、正文、字段类型、导出值和限制。正文问答用 `read_document`；扫描页用 `view_pdf_page` 查看，当前没有 OCR。

普通创作在工作区用 ReportLab 编写脚本。长文与长表采用 Platypus 的流式分页，重复表头并保留合理页边距；固定布局采用 Canvas，逐个核对文字和对象范围。读取 `references/layout.md`；可导入 `pdf_layout.build_flow` 与 `pdfs.pdf` 辅助库，不需要模型专用文档工具。

页面和表单操作读取 `references/editing.md`。`pdf_edit.py` 提供 select、append、rotate、form；所有修改生成新文件。表单值按检查得到的字段类型填写：字符串、布尔值或多选字符串数组。选择字段使用导出值，核对保存值和实际外观。repair 只处理受支持的简单字段树缺失，flatten 仅支持当前可验证的文本字段外观。

先运行 `"$PYTHON" -B -s "$SKILL_ROOT/scripts/pdf_edit.py" dependencies`。生成后重新 inspect，并分批 `view_pdf_page` 检查全部新增或受影响页面，确认分页、中文、表格、页序、旋转和表单外观。单个文件最多 100 页；加密、签名、XFA、脚本、嵌入附件及活动注释明确拒绝。视觉覆盖保留底层内容，不能用于承诺安全脱敏。

## 资源和执行

`SKILL_ROOT` 表示本次 `load_skill` 返回的 `resourceDirectory`，只能使用该精确目录内的资源；不要猜测源码、插件安装根或 profile 路径。`run_command` 提供通用解释器环境变量 `MY_PI_HARNESS_PYTHON`；在命令中先设 `PYTHON="${MY_PI_HARNESS_PYTHON:-python3}"`，使用宿主已配置的解释器，未配置时检查明确存在的 `python3`。以下命令中的变量需替换为本次返回的绝对路径，并正确引用含空格的路径。工作文件、脚本与输出放在工作区，资源目录只读。使用 `PYTHONDONTWRITEBYTECODE=1`；自写脚本导入辅助库时将 `PYTHONPATH` 设为 `$SKILL_ROOT/scripts`。

先执行当前格式的 `dependencies` 命令，检查 `missingModules`、`converter` 与 `ready`。这一步不安装软件。解释器、Python 包、字体或 LibreOffice 缺失时，说明具体缺项；依赖安装只能作为明确授权的普通 `run_command` 执行，不静默下载。`requirements.txt` 是该 Skill 的 Python 依赖清单；转换器和系统字体另行准备。

`run_command` 可能返回 `running`。保留 `commandId`，通过 `wait_command` 等待终态；检查退出码、stderr 和截断信息。文件存在或有部分 stdout 不能证明成功。取消、失败或未知结果先检查事实，不自动重跑可能生效的操作。加载 Skill 不授予命令、网络、账号或写入权限；只读角色只能检查输入。

每次写入使用新的目标文件，保留输入；辅助 CLI 拒绝覆盖现有文件。自写脚本也遵守这个规则，先检查输入，再生成副本。辅助脚本的结构报告不会自动注册可下载产物。

## 验证和交付

生成与必要验证的命令全部成功终止后，重新打开最终文件，分别记录结构检查、实际计算或转换、视觉检查。`read_document` 提取正文，不能证明布局正确；`view_pdf_page` 每次查看至多四页，`view_image` 查看实际图像，两者需要视觉模型。没有视觉模型或转换器时明确标记未完成的视觉检查，不声称版式通过。修改后检查最新输出。

最后调用 `publish_artifact` 注册工作区最终文件；若提供 `producerCommandId`，使用同一任务中已成功终止的生产命令。交付使用宿主返回的 artifact ID 和下载入口，不从 stdout、Markdown 路径或自报 hash 推断可信下载。说明检查范围与剩余限制。
