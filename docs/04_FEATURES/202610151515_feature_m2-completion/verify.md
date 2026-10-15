# M2 分步收尾验证

日期：2026-10-15，北京时间。应用0.1.0，macOS arm64、Node24.20.0、pnpm10.34.6、Electron43.7.9。M2.1/M2.2实现与本机验收完成，待用户统一体验；M2.3 Windows Shell按用户要求暂缓，尚未实现。未提交或推送。

## 结果

| 条件                     | 结果与证据                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-01 / UC-01 工作区注册 | Pass；实际目录与HTTP测试覆盖长basename的默认显示名、显式名称校验、目录别名、敏感根拒绝和安全4xx。注册与执行共用根策略，执行保留根身份检查。                                                            |
| AC-02 / UC-02 文件路径   | Pass（macOS文件操作与通用路径规则）；嵌套中文/空格路径读写、列表和搜索通过；纯路径测试覆盖Windows分隔符规范化与ADS、设备名、尾点/尾空格拒绝。没有Windows实机证据。                                     |
| AC-03 / UC-03 工具记录   | Pass；真实Pi循环与SQLite使用同一Run的多轮call_0，分别审批并修改实际文件，模型历史保留原SDK配对ID，公开记录独立，旧审批不能批准下一调用，分支保留两轮上下文。浏览器另验证六轮工具共用call_0及刷新恢复。 |
| AC-04 / UC-04 Shell      | Pass（macOS）；实际Seatbelt、进程组、取消和超时用例通过；确定性进程事件测试覆盖exit后的尾输出、分流UTF-8、迟到限额/输出错误/取消及管道不关闭。结果等待输出关闭，清理失败明确报错。                     |
| AC-05 / UC-05 集成验收   | Pass（已配置的macOS环境）；四个浏览器用例及构建产物恢复检查通过。实际未签名应用走通系统目录选择器、取消、路径回填、保存与退出；真实供应商为Not verified。                                              |
| AC-06 Windows            | Not verified / 未实现；用户明确暂缓M2.3，未通过模拟平台或无隔离宿主执行替代。                                                                                                                          |

本轮补齐的是原roadmap的M2剩余项。附件/引用、AGENTS上下文、压缩、Plan/Todos仍按原规划属于M3；Windows缺口保留在M2.3。

## 实际检查

| 命令或操作                                     | 结果                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --ignore-scripts`                | Pass；同步daemon对execution的直接工作区依赖与锁文件。                                                                                |
| `pnpm build`                                   | Pass；7个workspace构建完成。                                                                                                         |
| `pnpm test:m2`                                 | Pass；119项源码测试通过、1项平台分支skip；4项Chromium场景通过。该入口要求先build。                                                   |
| `pnpm exec vitest run tests/unit/docs.test.js` | Pass；24项文档检查行为测试通过，包含连续12位时间戳与非法日期/分钟拒绝。                                                              |
| `pnpm typecheck`                               | Pass；根、E2E及7个workspace。                                                                                                        |
| `pnpm lint`                                    | Pass；全仓ESLint、a11y、依赖、源码、文档与版本检查。                                                                                 |
| `pnpm format:check`                            | Pass；首次发现testing.md表格格式，定向格式化后重新检查全仓通过。                                                                     |
| `pnpm test:artifact`                           | Pass；4项构建后daemon启动、退出与持久恢复检查。                                                                                      |
| `pnpm package:desktop`                         | Pass；生成包含本轮实现的macOS arm64应用目录。                                                                                        |
| `pnpm smoke:desktop`                           | Pass；最终包实际启动，检查独立Node、Provider加载、设置、有限桥、来源拒绝与daemon退出。                                               |
| 实际macOS目录选择                              | Pass；独立临时profile先取消NSOpenPanel，路径仍空且保存禁用；再次选择临时目录，回填realpath，保存后侧栏和输入栏显示picker-workspace。 |

唯一源码skip为macOS上不适用的非macOS Shell拒绝分支，不计为通过。浏览器使用本机合成模型HTTP服务，经过真实Pi、daemon、SQLite与临时工作区；不等于真实供应商API验收。未重复执行全仓Vitest或完整M1浏览器套件，不声明一次`pnpm check`整体通过。

新增浏览器场景依次执行list_files、search_files、read_file、edit_file、shell与web_fetch；编辑前磁盘保持原内容，批准后产生真实修改与Diff；Shell返回实际输出；私网请求即使批准仍失败。七次模型HTTP请求后刷新不追加请求，工具记录与消息一致。截图位于该用例的`test-results/`目录，已查看；构建产物检查另外覆盖重启恢复。

目录选择验收在独立临时profile与测试目录完成，没有操作用户现有profile。测试应用正常退出，应用和daemon PID均已消失，临时profile与目录已清理；自动化测试进程也已结束。

## 保留限制与用户入口

专用`MY_PI_HARNESS_TEST_API_KEY`、`MY_PI_HARNESS_TEST_BASE_URL`和`MY_PI_HARNESS_TEST_MODEL`均未配置，未发起真实供应商请求或读取用户Keychain。Windows/Linux实机、Windows Shell和用户体验为Not verified；应用仍未签名、公证，也未生成正式安装器。既有文件竞态、恶意进程组逃逸和PDF隔离限制继续以[execution说明](../../../packages/execution/README.md)为准。

运行`pnpm dev:desktop`，或打开`release/mac-arm64/My Pi Harness.app`进行验收。建议使用临时测试目录，依次体验目录选择、工作区会话树、读取/搜索、编辑批准或拒绝、Diff、只读策略及刷新/重启历史；操作说明见[用户指南](../../07_USER_GUIDE/workspace-execution.md)。
