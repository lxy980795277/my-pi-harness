# IPv4映射地址与GitHub授权验证

日期：2026-10-28，北京时间。产品0.10.1，macOS arm64、Node24.20.0、pnpm10.34.6。AC1–AC4及UC1–UC3在本轮地址策略、合成OAuth/浏览器及无认证公网请求范围内通过；没有自动完成真实用户授权、修改配置、数据或提交代码。

## 原因与复现

本机Node Resolver与系统lookup实测：github.com的A为100.12.0.13，AAAA为::ffff:100.12.0.13；api.github.com分别为100.12.0.25和对应映射AAAA。原规则允许前者，却因后者不属于原生公网IPv6的2000::/3范围而拒绝整次解析。失败发生于token交换socket创建前，尚未向GitHub发送授权码或Client Secret。

新增plugin-oauth-network.test.ts使用真实beginPluginOAuth、pluginOAuthFetch及受控网络适配，仅替换DNS与底层HTTP响应；三种公网mapped写法在修复前均准确复现“交换授权凭据失败：授权服务解析到了被禁止的网络地址”，8项非公网/过渡AAAA拒绝仍通过。Execution回归同样先复现公网映射与双栈请求的失败。

这次不是通过更改Client、回调地址、代理或DNS解决。此前Fake-IP/代理的猜测在观察到具体A/AAAA和源码判定后排除；没有据此放行198.18/15或其他保留网段。

## 实现与保留规则

纯地址判断位于packages/execution/src/web/public-address.ts并从execution导出，integrations复用已有依赖；删除两处相同IP段表，不新建共享包或循环依赖。IPv4-mapped IPv6只在::ffff:0:0/96内识别，通过Node BlockList对嵌入IPv4进行相同校验，无手写字符串IP解析。

点分、十六进制、大小写表示的公网映射通过；映射回环、私网、元数据、CGNAT、基准测试、文档、组播和零地址拒绝。非mapped的IPv4兼容形式、NAT64、6to4等过渡地址及原生禁用IPv6仍拒绝。全部DNS记录均通过后才建立socket，混合坏记录不能通过“选一个好地址”绕过；实际socket继续使用已验证地址，TLS校验、Origin、重定向、超时及取消不变。

Web wrapper继续抛ExecutionError，远端wrapper继续抛NetworkError，OAuth仍归类有限安全诊断；没有把执行域错误或外部原文传入授权页面。执行README、集成README和MCP技术设计同步当前规则。

## 实际命令与结果

正式命令均使用仓库固定Node24.20.0的PATH。

| 命令/检查                                                                                                                                                                                                                                                                                                                                                                                                            | 结果                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| pnpm exec vitest run packages/integrations/test/plugin-oauth-network.test.ts（修复前）                                                                                                                                                                                                                                                                                                                               | 3项公网映射失败、8项拒绝通过，准确复现截图错误。                                            |
| pnpm exec vitest run packages/integrations/test/plugin-oauth-network.test.ts packages/integrations/test/plugin-oauth.test.ts packages/integrations/test/plugin-oauth-issuer.test.ts packages/integrations/test/plugin-oauth-errors.test.ts packages/integrations/test/remote.test.ts packages/integrations/test/remote-oauth.test.ts packages/execution/test/web.test.ts packages/execution/test/web-request.test.ts | 8文件144项通过，1.41秒；覆盖Token/账号、issuer、安全错误、SDK远端及Web策略。                |
| pnpm --filter @my-pi-harness/execution --filter @my-pi-harness/integrations typecheck                                                                                                                                                                                                                                                                                                                                | 两包源码及测试类型检查通过。                                                                |
| pnpm exec vitest run apps/daemon/test/plugin-oauth-parity.test.ts apps/daemon/test/plugin-gateway.test.ts apps/daemon/test/remote-mcp.test.ts                                                                                                                                                                                                                                                                        | 实际只匹配前两个存在文件，2文件18项通过；remote-mcp.test.ts不存在，不能据此声称已测该文件。 |
| pnpm exec vitest run apps/daemon/test/plugin-connection-api.test.ts apps/daemon/test/plugin-mcp-credentials.test.ts apps/daemon/test/remote-mcp-configuration.test.ts                                                                                                                                                                                                                                                | 核对真实文件名后，3文件37项通过，6.19秒；共13个不同源码文件199项通过。                      |
| pnpm build                                                                                                                                                                                                                                                                                                                                                                                                           | 8项实际任务通过，0缓存，19.847秒，验证新增包导出的真实产物引用；保留既有Vite大chunk提示。   |
| pnpm exec playwright test tests/e2e/plugin-connection.spec.ts -g 'GitHub 授权与应用目录跨重启恢复' --output=output/playwright/mapped-ipv4-oauth-20261028                                                                                                                                                                                                                                                             | 1项通过，8秒；合成账号完成授权、App目录、重启恢复及搜索后调用。                             |
| 7个变更源码/测试文件的pnpm exec eslint与pnpm exec prettier --check                                                                                                                                                                                                                                                                                                                                                   | 通过；Execution独立定向68项与上述144项重叠，不累加。                                        |
| node scripts/check-boundaries.mjs；node scripts/check-source-conventions.mjs；node scripts/check-docs.mjs                                                                                                                                                                                                                                                                                                            | 758源码导入、819文件约定及当时183文件文档检查通过；补齐verify后重新检查文档。               |
| git diff --check                                                                                                                                                                                                                                                                                                                                                                                                     | 通过，版本、协议、SQLite、JSONL格式和依赖未修改，暂存区为空。                               |

## 构建产物公网探测

用构建后的integrations/dist/network/remote-fetch.js执行无认证GET，限定准确origin、10秒截止与64KiB响应；不附加Cookie、Token、授权码或Client Secret：

- https://github.com/robots.txt返回200，14,540字节，证明此前失败的GitHub主机网络路径已通过地址校验并取得TLS/HTTP响应。
- https://api.github.com/返回上游403，279字节。该请求没有认证，不能作为账号权限或完整OAuth成功的证据；它已越过DNS/地址拦截并取得HTTP响应，没有将403改成成功或放宽权限。

## 未验证项与后续操作

浏览器OAuth与模型使用合成fixture，未使用用户真实配置或凭据。真实账号仍由用户完整重启项目后，从插件详情重新点击授权创建新state/code；旧失败流程不可重放。针对本次地址误判不需要更改.env、注册回调或系统DNS。没有代用户重启已有开发进程、执行授权、提交或推送；没有新增Windows、安装包、签名或公证验收。
