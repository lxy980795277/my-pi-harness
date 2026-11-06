# 源码运行与插件资源归并验证

日期：2026-11-06，北京时间。环境：macOS arm64、Node24.20.0、pnpm10.34.6；产品0.18.0、协议24、SQLite10。既有工具重构先提交为8b62195，本专题按用户后续指令提交，版本元数据同步为0.18.1，不推送；下文行为及打包证据均来自0.18.0候选实现，不重新标注产物版本。

## 完成范围

AC-1至AC-6通过。六个后端私有包及daemon直接导出src，移除后端build配置、dist和workspace源码覆盖别名；开发、CLI、浏览器fixture和生产daemon使用Node/tsx。Electron main/preload继续构建为JS/CJS，实际产物包含protocol/typebox，无相应外部裸TS导入。后端.js和Web无后缀约定保持。

65个资源文件都有新归属。格式专属模块随对应Skill，共用办公模块在plugins/shared/office，PDF页图和安全支持在utils/document-view；除四份清单及共享README外，60份资产字节与基线相同。12条共享依赖hash逐条核对，来源限制为四个明确文件；快照、物化、租约及撤销机制保持。

清理无读取者的ToolContext.supportsImages及注入，保留真实模型图片能力与可用性判断；移除无生产消费者的插件JSON解析、贡献索引和skillRoot方法，不增加转发层。App声明一次读取后派生公开及宿主数据。27个原生工具的声明、来源、顺序和加载元数据与既有快照完全相同。

## 实际检查

| 检查                                     | 结果                                                                                                                                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm typecheck                           | 9个workspace类型任务通过；最终移除skillRoot及对应测试调整后，再跑tools类型检查和三文件ESLint通过。                                                                                                                            |
| pnpm build                               | 仅Web和Electron两个构建通过；main约259.68kB、preload约240.27kB，后端dist没有重建。                                                                                                                                            |
| pnpm format:check、pnpm lint             | 全仓格式通过。首轮lint发现两个指向旧recovery.built测试文件的文档链接；更新实际文件链接、保留历史命令记录后，完整lint通过，包含961个导入文件、1029个源码约定文件、246份文档及a11y/版本检查。验证文档收尾后再跑文档及格式检查。 |
| pnpm test                                | 211文件通过、1文件跳过；2014项通过、2项按既有条件跳过。测试解析真实源码exports，无workspace覆盖别名。                                                                                                                         |
| 资源与Office聚焦Vitest                   | 8文件50项通过，包含实际Python办公工作流、PDF读取、共享hash、快照、物化及撤销；完整源码套件亦覆盖这些场景。                                                                                                                    |
| pnpm test:artifact                       | 3文件7项通过，15.41秒；CLI真实启动/退出、IPC/恢复及隔离生产deploy中的PDF读取、四个Skill物化/CLI执行。所有后端出口实际解析到部署目录内的TS，子进程使用自身生产tsx，旧叶出口明确拒绝。                                          |
| 浏览器定向回归                           | 文件编辑/受限执行、合成GitHub授权后的跨重启发现各1项通过；主任务、子任务的文档生成/校验/发布/下载各1项通过。                                                                                                                  |
| pnpm package:desktop、pnpm smoke:desktop | macOS arm64应用目录重新生成并启动，随包Node24.20.0运行源码daemon；资源链接、有限桥、Renderer隔离、来源拒绝、开发覆盖项拒绝和退出回收通过。截图已核对页面完整与服务已连接。                                                    |
| 独立职责复核、残留扫描、git diff --check | 无阻塞问题；旧tools/resources、后端dist入口、build配置和源码覆盖别名已移除，未发现被误删的生产消费者。                                                                                                                        |

浏览器命令如下，使用受控HTTP模型和合成OAuth服务，不涉及真实账号：

```sh
pnpm exec playwright test tests/e2e/m2-completion.spec.ts \
  tests/e2e/office-artifact.spec.ts tests/e2e/plugin-connection.spec.ts \
  --grep '完整工具链|加载文档 Skill|子任务继承文档 Skill|GitHub 授权与应用目录跨重启恢复' \
  --workers=1
MY_PI_HARNESS_PYTHON="$PWD/.cache/office-venv/bin/python" \
  pnpm exec playwright test tests/e2e/office-artifact.spec.ts --workers=1
```

首个浏览器命令2项通过，Office两项因未显式指定Python按既有条件跳过；第二个命令指定现成解释器后两项通过，17.9秒，未安装新依赖或放宽断言。桌面打包显式提供合成MY_PI_HARNESS_GITHUB_CLIENT_ID并关闭自动签名身份发现，不读取真实.env；smoke使用自己的临时profile和会话根。

检查日志保存在/tmp/my-pi-source-\*，截图保存在output/playwright/desktop-login.png、desktop.png与desktop-settings.png，均为本机非Git产物。未读取真实凭据，未清理用户数据。

## 未验证范围

未进行真实供应商或OAuth账号回归、Windows/Linux实际桌面/工具隔离验收、LibreOffice转换/重算或完整Office视觉质量验收。此次生成macOS应用目录，没有正式安装器、签名、公证或自动更新发布；M6与原有M2/M4平台及账号缺口保持原状态。
