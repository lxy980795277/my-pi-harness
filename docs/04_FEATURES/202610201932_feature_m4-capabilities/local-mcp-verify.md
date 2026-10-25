# M4.1 首批RunToolset验证

日期：2026-10-20。验证基于0.6.3（7f81ab1）后的工作区，按用户指令纳入[0.6.4本地提交](../../06_RELEASES/0.6.4.md)。范围仅为[详细设计](local-mcp.md)的L1及AC-01；M4.1本地MCP完整链路尚未完成。

## 实现与结果

ToolRuntime按实际会话能力与工作区选择一次RunToolset，克隆并深冻结定义与来源，保留TypeBox元数据。接受审计、Pi声明、WorkContext预算和运行时执行路由共用该集合；来源与稳定SHA-256指纹保存在私有toolSources，模型schema不增加宿主路由字段。重名与未接受的路由明确拒绝。

新增12项回归覆盖深冻结、TypeBox编译、稳定指纹、重名和缺失路由，以及真实Pi请求、JSONL接受审计、context.prepared、预算和文件执行的一致性。场景包含无工作区、无工具运行时、会话与执行能力装配不对称，确认候选由实际执行者决定。

底层execution与会话执行器仍对固定内置目录进行参数复核；本批只冻结当前定义和来源，不表示未来MCP连接或执行器版本已经冻结。没有安装尚无消费者的SDK、创建空integrations包、修改公开协议或新增未知结果状态。

## 实际检查

环境：macOS arm64、固定Node24.20.0、pnpm10.34.6。自动化使用临时工作区、受控模型与测试身份，未使用真实OAuth、用户凭据或付费供应商。

| 命令                                                                                                                      | 结果                                               |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| pnpm --filter @my-pi-harness/agent-runtime test                                                                           | 15文件102项通过，含新增12项                        |
| pnpm --filter @my-pi-harness/agent-runtime typecheck                                                                      | 通过                                               |
| pnpm --filter @my-pi-harness/agent-runtime lint                                                                           | 通过                                               |
| pnpm exec turbo run build --filter=@my-pi-harness/daemon...                                                               | 5项构建通过                                        |
| pnpm test:artifact                                                                                                        | 2文件6项通过                                       |
| pnpm exec playwright test tests/e2e/m2.spec.ts tests/e2e/m3.spec.ts --workers=2 --output=output/playwright/m4-run-toolset | 9项通过，22.9秒                                    |
| pnpm lint                                                                                                                 | ESLint、无障碍、依赖方向、源码、文档及版本检查通过 |

浏览器回归使用本批构建后的daemon，覆盖真实工具循环、请求批准与只读、重复请求恢复、附件、规则/预算、计划审核、人工提问、图片请求与摘要版本。前置状态整理的185项Web源码测试及20个浏览器场景另见[状态整理验证](../202610201707_refactor_frontend-state/verify.md)，两轮浏览器集合存在重叠，不合并计为独立场景总数。

## 未完成项

L2外部工具来源与unknown协议、L3受监管持久stdio和官方SDK/租约、L4配置/凭据/信任及设置/选择UI、L5完整MCP联调均待实施。MCP入口仍不可用；未重新打包Electron、验证Windows或真实第三方账户，不将现有内置工具回归视为MCP已验收。
