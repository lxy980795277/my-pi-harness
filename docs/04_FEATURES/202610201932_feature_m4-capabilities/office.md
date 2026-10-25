# M4.8 本地办公文档工作流

状态：工程实现与macOS结构校验、PDF页图和下载链路已完成，证据见[办公验证](office-verify.md)及[下载界面验证](office-ui-verify.md)。Office桌面应用与LibreOffice视觉验收仍未完成。属于M4.8；不引入Office编辑器或通用产物平台。执行和文件策略由execution拥有，四个办公插件分别拥有独立编写的SKILL.md；运行时沿用工作区工具审批、Plan和取消规则。

## 目标与入口

提供 `office_docx`、`office_pdf`、`office_xlsx`、`office_pptx`、`office_inspect`、`pdf_read_pages` 与 `office_render`。前四个工具接受结构化描述，创建或从源文件生成新的输出；inspect只读结构和有界正文；PDF指定页读取返回真正页面图像，视觉模型能力由运行时检查；render是显式的外部转换操作。通用文档正文继续复用已有read_file/officeparser，不建立第二套全文提取。

模型不能指定程序、脚本、Python代码、宏、网络URL或绝对文件名。输入与输出都是注册工作区相对路径；输入只读复制，输出必须不存在，失败或取消不发布半成品。脚本只运行本项目拥有的资源，固定参数通过stdin JSON传递，不拼接命令。执行不安装任何依赖。

## 能力范围

| 格式 | 支持                                                                                                                                                                                               | 明确限制                                                                                                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOCX | 段落/标题/表格创建；保留其他包部件的精确文字替换；普通段落w:ins/w:del接受/拒绝；增加/删除批注；脚注/尾注、书签、目录域、REF交叉引用、SEQ题注、纯文字内容控件；核心元数据；无复杂关系文档的有界合并 | 文字替换不能跨段落、域、修订、超链接；拒绝移动/表格/属性等复杂修订；合并拒绝图片、外部关系、编号/嵌入及有冲突书签/脚注等复杂文档；目录/交叉引用由Word/LibreOffice更新，不伪造已计算结果 |
| PDF  | 文字/表格创建；页面选择/重排/旋转/追加；字段清单/填写/校验；仅支持有可靠appearance的表单扁平化；受限缺失AcroForm字段树修复；页面区域文字/白色覆盖                                                  | 拒绝加密、签名、XFA、JavaScript/Launch/嵌入动作；字段类型受限；覆盖不是不可恢复脱敏；没有OCR                                                                                            |
| XLSX | 工作表数据、公式、格式、表格、柱状/折线/饼图创建和修改；表格/图表/公式缓存/错误单元格检查                                                                                                          | 不运行宏或外部链接；openpyxl不计算公式，缓存缺失明确报告，不能把保存当计算成功                                                                                                          |
| PPTX | 原生文本框、表格、柱状/折线/饼图；按slide/shape索引修改；模板原尺寸、布局和已有部件保留；越界、空系列、表格检查                                                                                    | 不把截图当原生表格/图表；不支持任意PowerPoint功能重建；复杂模板转换必须另做渲染验看                                                                                                     |

## 受监管执行与依赖

Python使用维护中的公开库python-docx、pypdf、reportlab、openpyxl、python-pptx、pypdfium2、lxml及Pillow；固定开发验证版本记录在 `packages/execution/resources/office/requirements.txt`。宿主显式配置 `pythonPath` 时使用该绝对路径；默认只查已安装python3。缺程序或缺包返回 `OFFICE_DEPENDENCY_MISSING`，不隐式联网下载。安装指令只供用户明确准备环境。LibreOffice为可选渲染依赖；请求必需视觉检查但缺该依赖时明确失败，不用结构检查代替。

子进程使用固定argv、白名单环境、独立临时HOME、sandbox模式无网络、固定时间/输出/输入界限和所属进程组回收；ask/auto使用现有macOS Seatbelt，隔离缺失拒绝。full-access仍要求工作区路径校验和新文件发布，不授予模型任意Python。输入单文件32MiB，ZIP解压64MiB/5000部件、单XML8MiB、禁止实体/DTD、拒绝宏/活动内容；最多100页/100幻灯片/20工作表/20000单元格。图像一次最多4页，单页最大2000像素。

脚本在独立临时目录生成产物。宿主检查进程成功、机器结果、产物常规文件及大小，执行后重新校验目标父目录，再以排他方式发布；不覆盖源文件或已有文件。取消先回收所属进程及管道，再删除临时目录。输出返回相对路径、SHA-256、字节数、结构检查和未验证项；用户在工具展开详情中下载文件，不暴露宿主绝对路径。检查详情过长时明确缩短预览，保留完整的产物与校验元数据，避免公开工具记录截断JSON。

## 验收

每个格式都通过真实创建→检查→生成修改副本→检查，确认源hash不变。DOCX额外验证修订/批注/脚注/书签/域/内容控件及受限合并；PDF验证真实页图、页面操作、字段填写/扁平化和不安全类型拒绝；XLSX验证公式缓存未计算的真实提示、表格和图表；PPTX验证原生结构、模板尺寸和越界拒绝。路径逃逸、软链、覆盖、坏包、缺依赖、超限和取消建立实际拒绝证据。LibreOffice、真实Word/Excel/PowerPoint视觉与其他平台分别记录Not verified，不以函数存在声称通过。

## 官方依据

- [python-docx文档](https://python-docx.readthedocs.io/en/latest/)及[批注API](https://python-docx.readthedocs.io/en/latest/api/document.html)
- [pypdf表单填写与扁平化](https://pypdf.readthedocs.io/en/stable/user/forms.html)
- [openpyxl公式不自动计算](https://openpyxl.readthedocs.io/en/stable/simple_formulae.html)与[图表](https://openpyxl.readthedocs.io/en/stable/charts/introduction.html)
- [python-pptx原生表格](https://python-pptx.readthedocs.io/en/latest/user/table.html)与[图表修改](https://python-pptx.readthedocs.io/en/latest/api/chart.html)
- [pypdfium2页面渲染](https://pypdfium2.readthedocs.io/en/stable/python_api.html)
