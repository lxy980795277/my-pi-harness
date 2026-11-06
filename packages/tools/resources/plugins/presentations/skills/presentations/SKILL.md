---
name: presentations
description: '使用 PPTX 原生文本、表格与图表制作演示，保留模板尺寸和部件并逐页检查。'
allowed-tools: 'run_command wait_command read_document view_pdf_page view_image publish_artifact read_skill_resource'
---

# 演示文稿

先运行 `"$PYTHON" -B -s "$SKILL_ROOT/scripts/pptx_check.py" dependencies`。有模板时先 inspect，记录页尺寸、版式、形状索引、文字、表格、图表与部件；明确用户需要修改哪些页。正文提取可用 `read_document`，但不据此判断版式。

读取 `references/slides.md`。在工作区用 python-pptx 编写脚本，使用真实文本框、表格与图表；复杂辅助操作可组合 `presentations.pptx`、`presentations.category_data` 和 `cli_support.new_output`。模板尺寸与未涉及部件需保持。按现有形状和版式编辑，文字替换可能丢失局部 run 格式，应按要求保留或重设。

保存新文件后运行 `pptx_check.py inspect output.pptx --template input.pptx`（无模板时省略该参数）。检查坐标、内部引用、表格和图表数据、空系列，以及模板部件和尺寸。结构检查不检测视觉重叠，也不保证复杂模板的应用级语义完全相同。

运行 `convert_pdf.py output.pptx preview.pdf`，等待成功后按顺序 `view_pdf_page` 检查每一页；关注文本溢出、遮挡、图表标签、表格对齐、字体缺字、页边和尺寸。修复后重新渲染并查看最新页面。无转换器或视觉模型时说明逐页验证未完成。

## 资源和执行

`SKILL_ROOT` 表示本次 `load_skill` 返回的 `resourceDirectory`，只能使用该精确目录内的资源；不要猜测源码、插件安装根或 profile 路径。`run_command` 提供通用解释器环境变量 `MY_PI_HARNESS_PYTHON`；在命令中先设 `PYTHON="${MY_PI_HARNESS_PYTHON:-python3}"`，使用宿主已配置的解释器，未配置时检查明确存在的 `python3`。以下命令中的变量需替换为本次返回的绝对路径，并正确引用含空格的路径。工作文件、脚本与输出放在工作区，资源目录只读。使用 `PYTHONDONTWRITEBYTECODE=1`；自写脚本导入辅助库时将 `PYTHONPATH` 设为 `$SKILL_ROOT/scripts`。

先执行当前格式的 `dependencies` 命令，检查 `missingModules`、`converter` 与 `ready`。这一步不安装软件。解释器、Python 包、字体或 LibreOffice 缺失时，说明具体缺项；依赖安装只能作为明确授权的普通 `run_command` 执行，不静默下载。`requirements.txt` 是该 Skill 的 Python 依赖清单；转换器和系统字体另行准备。

`run_command` 可能返回 `running`。保留 `commandId`，通过 `wait_command` 等待终态；检查退出码、stderr 和截断信息。文件存在或有部分 stdout 不能证明成功。取消、失败或未知结果先检查事实，不自动重跑可能生效的操作。加载 Skill 不授予命令、网络、账号或写入权限；只读角色只能检查输入。

每次写入使用新的目标文件，保留输入；辅助 CLI 拒绝覆盖现有文件。自写脚本也遵守这个规则，先检查输入，再生成副本。辅助脚本的结构报告不会自动注册可下载产物。

## 验证和交付

生成与必要验证的命令全部成功终止后，重新打开最终文件，分别记录结构检查、实际计算或转换、视觉检查。`read_document` 提取正文，不能证明布局正确；`view_pdf_page` 每次查看至多四页，`view_image` 查看实际图像，两者需要视觉模型。没有视觉模型或转换器时明确标记未完成的视觉检查，不声称版式通过。修改后检查最新输出。

最后调用 `publish_artifact` 注册工作区最终文件；若提供 `producerCommandId`，使用同一任务中已成功终止的生产命令。交付使用宿主返回的 artifact ID 和下载入口，不从 stdout、Markdown 路径或自报 hash 推断可信下载。说明检查范围与剩余限制。
