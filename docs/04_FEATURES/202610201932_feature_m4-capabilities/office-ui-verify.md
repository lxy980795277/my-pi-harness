# M4.8 办公产物下载界面验证

环境：macOS arm64、固定 Node24.20.0，显式配置 `.cache/office-venv/bin/python`。本文件补充 Web 到真实办公执行器的链路证据；四格式编辑与文件安全的执行器测试保留在[办公验证](office-verify.md)，不重复计数。

## 实际检查

| 命令                                                                                                                                       | 结果                             |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `pnpm exec vitest run apps/web/test/office-artifact.test.ts`                                                                               | 3 项通过。                       |
| `MY_PI_HARNESS_OFFICE_PYTHON="$PWD/.cache/office-venv/bin/python" pnpm exec playwright test tests/e2e/office-artifact.spec.ts --workers=1` | 1 个真实浏览器场景通过，6.5 秒。 |

Web 测试只接受已完成的原生办公工具和合法产物元数据，拒绝 MCP 冒用、未知工具、非法字段与 HTML。下载请求只携带 session/tool ID；实际字节数、MIME 和 SHA-256 校验通过后才交给浏览器。内容变化时明确失败。

浏览器场景从已注册临时工作区发起问题，真实 Pi 先调用 `load_tools`，下一步调用 `office_docx`；用户点击允许后，由实际 Python worker 创建 DOCX。展开工具详情下载文件，确认下载名、ZIP 文件头和完整字节均与临时工作区中的产物一致，模型请求恰为三次。

实际查看 `office-artifact.png`：下载按钮位于展开的工具详情中，折叠状态仍为单行工具展示；未验证说明保留。该场景不包含 Word 编辑器或嵌入预览。

## 未验证及限制

未安装 LibreOffice，未验证 DOCX 页面排版、Office 桌面应用或转换后的视觉质量；浏览器下载不是文档视觉验收。其他三格式的执行器测试见办公验证，未逐一重复四种格式的浏览器下载。未配置专用 Python 环境或非 macOS 时，该浏览器场景明确跳过，跳过不视为执行通过。下载接口的路径、软链与变更文件拒绝由 daemon 的独立 HTTP 测试记录。
