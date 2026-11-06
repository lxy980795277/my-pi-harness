---
name: spreadsheets
description: '创建与编辑 XLSX 原生数据、公式、格式、表格和图表，检查缓存与真实重算。'
allowed-tools: 'run_command wait_command read_document view_pdf_page view_image publish_artifact read_skill_resource'
---

# 电子表格

先运行 `"$PYTHON" -B -s "$SKILL_ROOT/scripts/xlsx_check.py" dependencies`，然后 inspect 输入，记录工作表、数据范围、公式、缓存、错误单元格、表格和图表。只读取内容时可用 `read_document`；定量工作应直接读取单元格和公式，不能依赖正文提取推断数值。

读取 `references/workbook.md`，在工作区用 openpyxl 编写脚本；保持公式为原生公式、表格和图表为原生对象。可组合 `spreadsheets.safe_value`、`spreadsheets.xlsx`、`spreadsheets.inspect_xlsx` 和 `cli_support.new_output`。样式、数值格式、表格范围和图表数据需有明确含义。不要把公式结果手写进缓存，外部链接、DDE 与网络公式被辅助库拒绝。

每次保存新文件并运行 `xlsx_check.py inspect output.xlsx`。它独立检查公式与缓存；openpyxl 保存不会计算公式。需要数值结果时运行 `xlsx_check.py recalculate output.xlsx calculated.xlsx`，实际使用已安装 LibreOffice，再检查缓存、错误以及预期数值。转换器不可用时明确标记没有重算。重算可能改变软件特有部件，输入副本必须保留。

用 `convert_pdf.py calculated.xlsx preview.pdf` 导出实际打印视图，逐页 `view_pdf_page` 检查列宽、数值格式、分页、图表和文本截断；按数据范围合理设置打印区域与缩放，不用把大量数据缩成不可读的一页。视觉验证不能替代数值核对。

## 资源和执行

`SKILL_ROOT` 表示本次 `load_skill` 返回的 `resourceDirectory`，只能使用该精确目录内的资源；不要猜测源码、插件安装根或 profile 路径。`run_command` 提供通用解释器环境变量 `MY_PI_HARNESS_PYTHON`；在命令中先设 `PYTHON="${MY_PI_HARNESS_PYTHON:-python3}"`，使用宿主已配置的解释器，未配置时检查明确存在的 `python3`。以下命令中的变量需替换为本次返回的绝对路径，并正确引用含空格的路径。工作文件、脚本与输出放在工作区，资源目录只读。使用 `PYTHONDONTWRITEBYTECODE=1`；自写脚本导入辅助库时将 `PYTHONPATH` 设为 `$SKILL_ROOT/scripts`。

先执行当前格式的 `dependencies` 命令，检查 `missingModules`、`converter` 与 `ready`。这一步不安装软件。解释器、Python 包、字体或 LibreOffice 缺失时，说明具体缺项；依赖安装只能作为明确授权的普通 `run_command` 执行，不静默下载。`requirements.txt` 是该 Skill 的 Python 依赖清单；转换器和系统字体另行准备。

`run_command` 可能返回 `running`。保留 `commandId`，通过 `wait_command` 等待终态；检查退出码、stderr 和截断信息。文件存在或有部分 stdout 不能证明成功。取消、失败或未知结果先检查事实，不自动重跑可能生效的操作。加载 Skill 不授予命令、网络、账号或写入权限；只读角色只能检查输入。

每次写入使用新的目标文件，保留输入；辅助 CLI 拒绝覆盖现有文件。自写脚本也遵守这个规则，先检查输入，再生成副本。辅助脚本的结构报告不会自动注册可下载产物。

## 验证和交付

生成与必要验证的命令全部成功终止后，重新打开最终文件，分别记录结构检查、实际计算或转换、视觉检查。`read_document` 提取正文，不能证明布局正确；`view_pdf_page` 每次查看至多四页，`view_image` 查看实际图像，两者需要视觉模型。没有视觉模型或转换器时明确标记未完成的视觉检查，不声称版式通过。修改后检查最新输出。

最后调用 `publish_artifact` 注册工作区最终文件；若提供 `producerCommandId`，使用同一任务中已成功终止的生产命令。交付使用宿主返回的 artifact ID 和下载入口，不从 stdout、Markdown 路径或自报 hash 推断可信下载。说明检查范围与剩余限制。
