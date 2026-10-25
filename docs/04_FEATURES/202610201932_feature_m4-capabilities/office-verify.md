# M4.8 本地办公验证

环境：macOS arm64，Node24.20.0，独立 `.cache/office-venv`（Python3.12）；依赖通过显式开发命令安装，未更改用户全局Python或读取用户文档。工具不会在Run中安装依赖。

## 实际通过

`pnpm exec vitest run --config packages/execution/vitest.config.ts packages/execution/test/office/workflows.test.ts`：13个办公测试通过。

- DOCX真实创建、精确替换、批注增删、脚注/尾注、书签、TOC/REF/SEQ域、纯文字内容控件和核心元数据；普通段落修订接受/拒绝；受限合并，复杂合并拒绝。修改源文件hash保持不变。
- PDF真实文本/表格创建、选页/重排/追加/旋转/区域覆盖、指定页PNG渲染；ReportLab真实表单填写、保存后值检查、文本字段appearance扁平化；简单缺失字段树修复；未知字段/加密拒绝。
- XLSX真实数据/公式/格式、表格与原生图表创建，另存修改；实际检查公式缓存为空并明确报告未计算，拒绝外部网络公式。
- PPTX原生文本/表格/图表创建及按对象修改；模板包部件和原尺寸保留，越界拒绝。
- 非法参数、Plan/只读修改、缺解释器、路径逃逸、软链、已存在输出、损坏文档拒绝；取消在途Python后等待父子进程组退出；真实macOS Seatbelt创建通过。
- 大DOCX的检查详情有界缩短，完整保留产物hash与校验/未验证说明；包含大量引号的结果仍是有效JSON，低于公开工具记录128k上限。

额外保留人工复查文件于未追踪的 `output/m4-office-validation/`：四格式各一份created/modified副本、机器报告及 `pdf-page-1.png`。实际查看PDF页面PNG，中文正文和区域覆盖内容可见，未见截断；该检查不等同DOCX/PPTX渲染通过。

组合浏览器验证实际运行 `MY_PI_HARNESS_OFFICE_PYTHON="$PWD/.cache/office-venv/bin/python" pnpm exec playwright test tests/e2e/office-artifact.spec.ts --workers=1`：1个Chromium用例通过，按需加载→审批→真实Python创建DOCX→展开详情下载，下载字节等于工作区产物且ZIP签名有效。该证据由M4组合验证执行，不替代Office桌面应用视觉检查。

## 未验证及限制

- LibreOffice未安装，DOCX/XLSX/PPTX页面转换、Office桌面应用、真实复杂模板视觉质量：Not verified。`office_render`依赖明确，不冒充已渲染。
- Windows进程监督尚未实现，工具明确拒绝；Linux及非macOS沙箱：Not verified。
- 公式不自动计算，没有缓存不能验证数值结果。域/目录由Word或LibreOffice更新，保存不代表已计算。
- PDF白色覆盖不是安全脱敏；无OCR；加密、签名、XFA、活动内容和复杂表单不支持。
- 此文件只记录办公拥有者定向证据，Runtime动态加载/审批/Skill入口和发布装配由M4整体验证统一记录，不以这些测试替代完整用户链路。
