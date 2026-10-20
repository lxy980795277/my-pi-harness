# 前端状态职责整理验证

日期：2026-10-20。验证基于0.6.3（7f81ab1）后的工作区，保留前一轮侧栏日期与标题栏连接状态调整；未清理用户数据或重启用户服务。验证后按用户指令纳入[0.6.4本地提交](../../06_RELEASES/0.6.4.md)。

## 结果

AC-01–AC-04在本轮范围通过。旧混合Workspace Store已删除，源码、测试和脚本中旧名称/路径引用为0，无兼容转发。Query保留消息、Run、配置和登录事实缓存，Store不互读互写，不新增浏览器持久化。

| 所有者            | 当前职责                                    | 生命周期                                |
| ----------------- | ------------------------------------------- | --------------------------------------- |
| navigation        | 页面、当前会话与工作区                      | 内存，授权结束统一清理                  |
| composer          | 新建选择/代际/attempt、输入草稿、未确认请求 | 跨会话保留，重试沿用requestId；刷新丢失 |
| settings          | 设置分区、Provider/模型弹窗与授权流程UI     | 关闭清理所属弹窗，授权结束重置          |
| attachment-drafts | 未提交附件元数据和上传busy                  | 保留原草稿语义，不保存文件字节          |
| timeline          | 按sessionId/toolId保存展开选择              | 跨虚拟卸载/会话切换保留，授权结束清理   |

新建会话由useStartNewConversation组合本域动作，保留工作区、模型和审批，重置新建草稿、workMode和代际。创建成功仍由Hook合并Query并切换导航。useResetClientState统一清理五域，注销与授权撤销共享此路径，删除Shell重复清理。待审批详情强制可见，允许/拒绝后保存展开选择。

## 实际检查

环境为macOS arm64、固定Node24.20.0、pnpm10.34.6。没有使用真实OAuth、系统凭据或付费模型。

| 命令                                                                                                                                                                                       | 结果                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| pnpm --filter @my-pi-harness/web typecheck                                                                                                                                                 | 三个Web编译面通过      |
| pnpm --filter @my-pi-harness/web build                                                                                                                                                     | 类型及Vite生产构建通过 |
| pnpm exec tsc -p tests/e2e/tsconfig.json --noEmit                                                                                                                                          | 通过                   |
| pnpm exec vitest run apps/web/test                                                                                                                                                         | 26文件185项通过        |
| pnpm exec playwright test tests/e2e/conversation-rendering.spec.ts tests/e2e/login.spec.ts tests/e2e/m1.spec.ts tests/e2e/m2.spec.ts --workers=2 --output=output/playwright/frontend-state | 20项通过，47.1秒       |

源码回归包含原输入恢复、3项真实Hook组合生命周期及3项展示Store检查；Hook组合通过React SSR取得真实动作，不mock Hook。覆盖新建选择保留、过期代际、未确认请求、设置域独立清理和五域授权清理。

Web源码/测试及新增浏览器用例ESLint通过，修改文件Prettier和文档检查通过。独立只读复核确认旧Store消费者全部迁移，Store只写本域，原侧栏MM-DD与标题栏单行连接状态调整保留。

新增真实浏览器场景使用16次工具调用构成超过overscan的列表：打开首个工具后滚到底部，明确断言该条目DOM数量为0，再返回顶部确认仍展开；新对话后回原会话，草稿和工具展开仍保留。该用例5.8秒通过，不以Store订阅测试代替实际虚拟卸载证据。其余场景覆盖登录/撤销/退出、设置、首次发送/重试、编辑分支、队列、审批/拒绝、Markdown及滚动。

## 边界与衔接

客户端状态仍不跨整页刷新保留；局部表单、人工问题答案、队列编辑等维持现有组件生命周期，本轮不机械全局化。未重新打包Electron、验证Windows或真人账号；Vite既有主chunk提示保留。

M4.1详细设计已建立，并开始统一当前Run工具集。该衔接不表示MCP stdio、Server配置、信任或调用UI已经完成；后续证据由M4.1单独记录。
