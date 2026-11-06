# TypeScript无后缀导入验证

日期：2026-11-06，北京时间。环境：macOS arm64、Node24.20.0、pnpm10.34.6；产品0.18.1、协议24、SQLite10。按用户后续指令提交，产品版本元数据同步为0.18.2，不推送或清理用户数据；下文行为及桌面证据来自0.18.1候选实现，不重新标注实际产物版本。

## 完成范围

AC-1至AC-5通过。TypeScript AST扫描998个手写TS/TSX文件，精确转换433个文件中的1487处静态导入、重导出、类型引用和字面量动态import。转换前后通过TypeScript Bundler解析逐项比较，1487处均指向相同物理文件，非模块引用文本保持；保留3处真实CSS扩展。另将已由tsx加载的start-daemon.mjs中4条TS导入统一无后缀，真实.mjs引用保持。

源码门禁按实际磁盘目标识别TS模块和JS文件，覆盖同名TS/JS优先级、目录index、真实JS扩展、raw/url资源、普通Node脚本及四个已有tsx辅助入口。包名、exports、进程/构建入口、Worker和模块URL、嵌入代码、require及静态资产未被机械裁剪。检查没有增加loader、兼容转发或源码别名。

规范、架构和当前README同步采用统一约定，历史验证和发布记录保留当时事实。27个原生工具的声明、来源、顺序及加载元数据与改动前完全相同。

## 实际检查

| 检查                                     | 结果                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 门禁聚焦测试、两文件ESLint               | 83项真实磁盘fixture通过，包含合法与拒绝路径；同名TS/JS、原生Node、tsx辅助入口和资源查询均覆盖。                                                       |
| pnpm typecheck                           | 9个workspace类型任务通过，14.662秒。                                                                                                                  |
| pnpm format:check、pnpm lint             | 全仓通过，包含961个导入文件、1029个源码约定文件、249份文档及a11y/版本检查；验证记录收尾后补跑文档和格式检查。                                         |
| pnpm test                                | 211文件通过、1文件跳过；2045项通过、2项按既有条件跳过，80.41秒。                                                                                      |
| pnpm build                               | Web和Electron两个构建任务通过，12.133秒。后端仍直接导出源码，无dist构建。                                                                             |
| pnpm test:artifact                       | 3文件7项通过，14.26秒；实际CLI/IPC/退出、恢复和独立生产deploy中的PDF读取与四个物化Skill CLI均通过。                                                   |
| Playwright定向浏览器                     | 4项通过，30.2秒：真实文件编辑与受限执行、主任务及子任务的文档生成/校验/发布/下载、合成GitHub授权后跨重启发现并调用工具。                              |
| pnpm package:desktop、pnpm smoke:desktop | macOS arm64应用目录重新生成并启动，应用0.18.1、随包Node24.20.0；资源链接、登录/工作台、有限桥、Renderer隔离、来源拒绝、开发覆盖项拒绝与退出回收通过。 |
| 独立复核、git diff --check               | 无阻塞问题；特殊入口、普通Node脚本和资源路径均保持实际扩展。                                                                                          |

浏览器命令使用现成Python环境、受控模型和合成OAuth，不访问真实账号：

```sh
MY_PI_HARNESS_PYTHON="$PWD/.cache/office-venv/bin/python" \
  pnpm exec playwright test tests/e2e/m2-completion.spec.ts \
  tests/e2e/office-artifact.spec.ts tests/e2e/plugin-connection.spec.ts \
  --grep '完整工具链|加载文档 Skill|子任务继承文档 Skill|GitHub 授权与应用目录跨重启恢复' \
  --workers=1
```

打包显式提供合成MY_PI_HARNESS_GITHUB_CLIENT_ID并关闭自动签名身份发现，不读取真实.env；smoke使用独立临时profile和会话根。构建仍有既有大chunk提示，未放宽阈值或改变分包策略。只读Turbo dry-run确认源码包虽无build命令仍有transit hash及完整源码inputs，Web/Desktop依赖该节点，没有为无后缀改动另建缓存规则。

检查日志位于/tmp/my-pi-extensionless-\*，桌面截图位于output/playwright/，均不进入Git。没有安装新的办公依赖或放宽超时/断言。

## 未验证范围

未重新验证真实供应商/OAuth、Windows/Linux实际桌面与进程隔离、LibreOffice转换/重算及完整Office视觉质量。当前仅生成macOS应用目录，没有正式安装器、签名、公证或自动更新发布。M6与其他里程碑已有平台、账号和办公质量缺口保持。
