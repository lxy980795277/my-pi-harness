# 应用初始化与统一加载验证

日期：2026-10-22。环境：macOS arm64、Node24.20.0、pnpm10.34.6、Chromium。范围为M0启动体验和M4界面收尾；应用版本保持0.6.4，不改变服务协议或数据格式。

## 结论

AC-01–AC-05本机通过。登录、服务协议与必要数据准备复用同一个空间光环加载组件，阶段切换只改变文案，节点和边界不变；工作区、会话列表、Provider配置及默认设置并行完成后才展示侧栏与输入框。后台刷新与失败保留已加载页面和草稿，初次失败可重试，空数据正常进入。设置目录和扩展不阻塞启动。

加载组件使用蓝紫青主题色。图形为三条交错光环，方向固定，只保留沿线流动的渐变光迹和柔和光晕；图形中不放Logo，阶段文字位于图形下方。浅深主题已实际查看，减少动态效果时动画归零。没有固定等待、假百分比或额外动效依赖。

## 实际检查

| 命令                                                                                                                                             | 结果                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `pnpm --filter @my-pi-harness/web build`                                                                                                         | Web三个类型编译面及生产构建通过，保留既有大chunk提示。                    |
| `pnpm exec vitest run apps/web/test`                                                                                                             | 28个文件、193项通过。                                                     |
| `pnpm exec vitest run apps/web/test/application-login.test.ts`                                                                                   | 最后授权缓存调整后24项通过；与上一行重叠，不累加。                        |
| `MY_PI_HARNESS_OFFICE_PYTHON="$PWD/.cache/office-venv/bin/python" pnpm test:e2e --output=output/playwright/application-initialization`           | 69项首次组合回归：67通过、2失败；原因与定向收尾见下文。                   |
| `pnpm exec playwright test tests/e2e/application-initialization.spec.ts --workers=1 --output=output/playwright/application-initialization-final` | 8项全部通过，29.9秒。                                                     |
| `pnpm exec playwright test tests/e2e/mcp.spec.ts --workers=1 --output=output/playwright/application-initialization-mcp`                          | 3项全部通过，21.8秒。                                                     |
| 所改Web源文件/登录测试及两个E2E文件的定向ESLint；`pnpm exec tsc -p tests/e2e/tsconfig.json --noEmit`                                             | 通过。                                                                    |
| `node scripts/check-boundaries.mjs`、`node scripts/check-source-conventions.mjs`、`pnpm lint:a11y`                                               | 通过，分别检查623个源码文件的导入与677个文件的约定，以及Web可访问性规则。 |

组合回归中的61个既有场景与8个新增场景均已覆盖，最后仅调整两个测试的准备/等待方式，没有改变已构建的产品逻辑；不将重叠复跑相加为用例总数。测试使用隔离profile、动态端口、假身份和受控模型，没有改动用户profile、凭据、工作区文件或5174开发端口。

## 用例及视觉证据

- 登录和health响应受独立请求门控制，确认鉴权前没有私有请求；四个必要请求都已到达后才逐项释放，慢工作区/设置期间仍无侧栏或输入框。跨三个阶段的加载DOM为同一节点，边界尺寸相同；主界面挂载后没有重复首批请求。
- 空工作区、空会话、空Provider和默认设置首次503分别验证；错误可重试，不把空列表当未初始化。普通会话后台轮询延迟与503都不覆盖工作台或清掉草稿。
- 首次协议不兼容、已有成功健康缓存后的失败/延迟重连，以及后台401后恢复有效登录的重新检查均经过真实浏览器。授权周期改变时保留公开诊断但取消旧health并标失效，未经本次协议确认不请求私有初始化数据。
- 实际查看浅色、深色及减少动态效果三份截图，图形与文字居中、布局固定。普通模式存在运行中的CSS动画，减少动态效果模式经有界轮询确认运行中动画为0；装饰图形不重复朗读，阶段文本使用status语义。

最新光环外观截图在未追踪的 `output/playwright/application-loading-fixed-orbits/` 对应视觉用例目录中：`application-loading-light.png`、`application-loading-dark.png`、`application-loading-reduced-motion.png`。输出不进入Git。

## 失败与修正

首次减少动态效果检查使用即时动画记录快照，偶现1个尚未结算的运行记录；改为有界轮询，仍严格要求减少动态效果为0、普通模式大于0，没有添加固定sleep或放宽断言。随后8个新增场景全部通过。

既有MCP echo用例先加载初始空工作区，再通过独立HTTP请求注册目录；新的15秒共享缓存不会收到这次测试外部写入的失效通知，导致表单等待不存在的选项。测试在API布置完成后显式刷新，保留发现、审批、实际stdio调用、日志及unknown全部断言；3个MCP场景全部通过。不因测试外部写入关闭产品缓存。

## 动效外观复核

用户确认第一版流光线条，只要求取消整个图形的旋转。恢复第一版的轨道尺寸、倾角、光迹宽度和亮点，删除图形容器的旋转动画；保留沿轨道流动及光晕呼吸。后续外观调整获用户确认，已删除开发常驻预览开关及入口分支，恢复真实初始化流程。

浏览器读取确认图形容器的animationName为none，子级仅有光迹和光晕动画，组件内无img。最新生产构建重新运行“同一加载节点”及浅/深/减少动态效果两个用例，均通过。Web三编译面、生产构建、组件ESLint、源码约定、文档检查及定向格式检查通过；未扩大到后端、真实账号或安装器验收。

## 边界

后续按用户要求缩小图形、加粗轨道及流光，让线条更饱满，并将文字省略号替换为纵向居中的三点跳动动效；这些微调由用户直接视觉验收，未重新运行构建、测试或浏览器检查，以上验证对应微调前版本。

本专项验证浏览器共享Renderer，没有重新打包或验收新的Electron安装器，也未执行真实GitHub/第三方供应商授权。M4原有平台、账号与Office视觉缺口仍见[M4验证](../202610201932_feature_m4-capabilities/m4-completion-verify.md)，不因本次加载优化改变。未提交或推送代码。
