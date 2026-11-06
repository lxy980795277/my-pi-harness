# 仓库ESLint工具归属验证

日期：2026-11-06，北京时间。环境：macOS arm64、Node24.20.0、pnpm10.34.6。实现验证基于产品0.18.2、协议24、SQLite10；按用户后续指令本地提交并同步0.18.3版本元数据，不推送或清理用户数据。

## 完成范围

AC-1至AC-4通过。原index.js迁至scripts/eslint/config.js，frontend-rules.js同目录保存；两份实现均与HEAD原文件逐字节相同，格式化后再次核对不变。根eslint.config.js保持唯一入口，两个规则测试更新本地引用，并覆盖新脚本及workspace工作目录的配置继承。

四个既有依赖移至根devDependencies，移除旧workspace依赖和package importer。catalogs、全部packages与snapshots段逐字比较不变，实际依赖及peer版本没有升级。旧包目录及已知安装链接移除；没有保留兼容包、代理文件或死导出。

根README、架构、测试规范及本地工具README同步；根目录清单同时纠正已移除execution包的过期条目。历史验证记录保持原事实，CI和生产部署入口不变。

## 实际检查

| 检查                                                      | 结果                                                                                                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm install --offline --ignore-scripts                   | 通过，复用现有依赖，无下载；四个lint依赖归根开发工具。                                                                                                     |
| pnpm install --offline --frozen-lockfile --ignore-scripts | 通过；清理旧链接后再执行相同命令，仍通过且未恢复旧包或旧链接。                                                                                             |
| frontend-lint与lint-coverage聚焦Vitest                    | 2文件166项通过，11.72秒；现有合法/拒绝规则及实际文件覆盖保持，新增Web/tools cwd查找根配置并执行typed no-floating反例。                                     |
| 5文件定向ESLint                                           | 根入口、两份实现和两份测试均通过。                                                                                                                         |
| pnpm format:check、pnpm lint                              | 全仓通过，包含959个apps/packages边界文件、1029个源码约定文件、251份文档及a11y/版本检查。两份迁出的JS仍有实际ESLint覆盖断言。文档收尾后补跑格式与链接检查。 |
| 独立复核、git diff --check                                | 通过，无额外消费者、规则变动、依赖升级或无关业务改动。                                                                                                     |

首次安装后pnpm保留一个指向旧workspace的hoisted符号链接；核对其精确目标后删除，再次frozen安装确认没有重建。旧包目录只剩生成的node_modules，核对后随旧包清理；未触碰应用profile或会话。

安装、frozen校验、全仓格式及lint日志位于/tmp/my-pi-repository-eslint-\*。规则和配置测试由协作执行，结果以实际命令输出记录，未为归档重复执行。

## 验证范围

本轮仅调整仓库开发工具归属。没有修改业务源码、TS编译面、运行依赖或规则实现，实现验证阶段未重复业务全量单测、typecheck、构建、浏览器、桌面打包或真实账号验收；提交阶段的类型与全量单测由既有钩子执行，不据此扩大M1–M5及平台能力结论，M6保持仅规划。
