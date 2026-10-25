# M4.7 外部连接验证

环境：macOS arm64、Node24.20.0、独立临时SQLite与内存假凭据库。上游均为动态端口的真实loopback HTTP服务；未读取用户凭据或请求第三方账号。

## 实际通过

`pnpm exec vitest run apps/daemon/test/connections.test.ts`：17个测试通过，覆盖以下行为。最终大响应投影调整另执行 `pnpm exec vitest run apps/daemon/test/connections.test.ts -t 'retains known HTTP status'`，1个定向用例通过。

- 真实应用登录、Cookie/CSRF保护、配置校验、无网络GET及公开DTO不包含Token或凭据引用。
- GitHub、Google、Vercel、Notion、Supabase的Token账户核实和固定operation请求；Google五个子App目录及对应插件Skill检查；跨Run、未知参数、不同服务operation及已撤销授权拒绝。
- 五服务真实OAuth授权请求与code交换；验证state、S256 challenge/verifier、固定provider/issuer、一次性消费。Vercel/Google等标准编码和Notion Basic认证/JSON正文分别检查。GitHub刷新串行化，两次并发读取只发一次refresh请求。
- 已派发写请求断线返回unknown，实际只发送一次；断开/重新连接使旧grant失效。断开可抢先撤销正在核实账户的配置，迟到请求不能恢复连接。
- Client Secret更改使既有账户授权失效；错误Skill、过期grant和跨provider授权拒绝。派发前持久化屏障失败不发网络请求；单次Run取消不会误退出账户。MCP凭据只允许固定服务端点，拒绝不同路径及URL用户信息。
- 真实上游返回包含大量引号、反斜杠、换行、Tab及NUL转义字符的大JSON，持久化投影仍为有效JSON且不超过100k；保留HTTP状态、父工具ID和operation，明确缩短正文，不把已知响应改成unknown。

`pnpm exec playwright test tests/e2e/connections.spec.ts --workers=1`：1个Chromium用例通过（6.9秒）。经真实设置界面创建GitHub Token配置、输入假Token、实际HTTP核实账户、显示已连接、清空输入值，并检查公开API无假Token；点击断开后刷新仍保持未连接。实际查看连接截图，秘密输入框为空，账户状态和断开入口可见。截图保留在本地 `test-results/connections-设置中创建-Token-连接、核实账户并断开-chromium/`。

`pnpm --filter @my-pi-harness/execution typecheck` 及 `pnpm exec tsc -p tests/e2e/tsconfig.json --noEmit` 通过。daemon源码类型与构建产物编译、Runtime实际Pi审批/派发用例由M4整体验证分别记录；本文件不把独立HTTP证据当作全部运行时链路。

## 未验证及限制

- 五供应商真实OAuth客户端、账号、scope、配额及REST/MCP互通：Not verified。fixture验证本地适配、请求格式和撤销语义，不能证明供应商已向此应用开放访问。
- 系统浏览器OAuth回跳、OS凭据库交互以及Linux/Windows：Not verified。上述浏览器场景只覆盖Token账户连接和断开。
- Google Workspace MCP处于供应商预览范围，Vercel等服务可能要求客户端预审；未开放或未注册应明确失败。配置完成不代表获得远端权限。
- REST仅开放27个固定操作，不支持任意URL、SQL、上传目标或认证头。文档batch update接受指定API的结构化正文，仍需逐Run授权、参数限制和工具审批。
