# MCP目录、远程连接与服务授权

## Spec

状态：M4.2、M4.3已实现并完成定向验证，证据见[mcp-expansion-verify](mcp-expansion-verify.md)。M4.7外部连接与Run动态工具集由同轮对应模块维护，总体验收以主Tasks和本轮最终验证为准。

### Intent

沿用现有stdio的派发屏障、结果未知、秘密与Run冻结规则，扩展工具目录控制、JSON配置交换、远程MCP和外部服务连接。远程服务不要求工作区，也不借用应用GitHub登录态。所有功能直接使用公开SDK和公开上游API。

### 目录与授权

- 目录发现同时记录tools、resources与prompts元数据；资源和提示词仅展示，不隐式读取或执行。分页、大小、重复名称与秘密回显检查覆盖所有目录。
- 工具可独立停用，控制状态持久保存。停用及撤销使新选择和旧Run授权失效；重新启用不能复活旧绑定。可信只读授权绑定身份、配置版本、定义指纹及参数指纹，外部readOnlyHint只作说明，不自行授予权限。
- 导入为有界JSON文档，先解析并展示预览，再明确批量写入；名称冲突拒绝，导入不启动或授信。导出只含公开启动配置和未配置的秘密槽位，不含凭据、信任或会话事实。
- freezeCandidates只读取当前已启用、已授信的缓存目录，冻结完整定义和非秘密授权；不在GET或模型搜索时隐式启动服务。tool_search/load_tools的JSONL事实和模型可见集合由agent-runtime拥有。
- 插件拥有的Server只有在插件安装提交、插件与App启用且组件引用精确匹配时才可授信和使用；未提交配置及停用组件不能经MCP管理入口重新启用。

### 远程MCP

- 新增/编辑使用“表单配置 / JSON配置”两个Tab，默认表单。MCP ID是配置别名，映射name，不替换内部稳定UUID；连接方式仅Streamable HTTP与SSE，地址及Header可直接编辑。不增加本机或局域网开关，沿用宿主网络约束。
- JSON编辑接受单个mcpServers配置，显式type决定传输，不按地址猜测；表单与JSON切换保留地址、Header、OAuth和连接来源。已存秘密只展示配置状态，修改地址不能复用原地址的秘密。
- 连接测试由明确操作触发，草稿测试只握手与读取目录，不创建配置、授信、调用业务工具或隐式OAuth登录；复用受控网络、取消及有界超时。页面显示测试中、连接结果和耗时，修改配置后清除旧测试结果。秘密仅在局部编辑Hook与专用写入/测试请求中流转，不进入Query、导出或日志。
- 远程新增为MCP主入口，本地进程配置保留在高级区域；既有OAuth授权、撤销与工具目录继续可用。

- stdio与远程配置分开表达，远程传输显式选择streamable-http或sse，不使用自动回退。远程URL必须HTTPS，无用户名、密码、片段或私有/保留地址；显式允许的回环开发fixture仅由宿主测试依赖注入，不进入产品DTO。
- 每次网络请求重新校验URL与DNS结果，并将已验证地址固定到实际socket；拒绝重定向、HTTPS降级、DNS混合公私地址及不受信的SSE endpoint。静态认证头仅从系统凭据读取，不跨origin发送。响应、请求和流有界，所有资源随AbortSignal或关闭收束。
- 官方StreamableHTTPClientTransport/SSEClientTransport负责协议。自有受控fetch负责网络限制与请求发送观察；tools/call在真正POST前提交持久屏障，一次attempt最多一次POST，SDK 401/协商重发不能重复副作用。无可靠响应的已派发请求返回unknown，停Run、不自动重连重放。
- OAuth使用官方OAuthClientProvider与auth。发现、动态注册、PKCE、state和issuer校验由SDK与宿主共同完成；state单次消费、十分钟过期、绑定profile owner/server revision/accessEpoch及回调归属。只在用户明确点击连接时发起交互授权，不因工具调用自动开浏览器。Token、refresh token、client secret与code verifier进入系统凭据库；刷新按授权记录串行。

### 外部服务连接

- GitHub、Google、Vercel、Notion、Supabase各自拥有公开provider描述、OAuth endpoint、scope和受限REST origin/path；provider授权与MCP OAuth使用不同记录及凭据命名空间。
- 连接状态只返回账户摘要、权限和有效状态；断开先撤销本机授权并使租约失效，再清理秘密。应用logout不删除profile连接。
- REST gateway只接收宿主签发的Run级能力，绑定连接、允许方法/path和原工作区；模型与Skill无法获得上游Token。拒绝任意URL、路径穿越、额外认证头、重定向及超限响应；写操作仍受统一审批与未知结果规则约束。Run绑定和工具入口由agent-runtime装配。

## UseCase

1. 发现本地或远程服务后查看三类目录；停用工具后发送旧选择得到拒绝，重新启用不复活旧Run。
2. 导出配置、预览导入、确认批量创建；秘密保持未配置、服务未启用，未知字段/名称冲突没有部分成功假象。
3. Streamable HTTP和兼容SSE真实fixture完成初始化/发现/调用；取消与断线后已派发调用unknown，wire只收到一次调用。
4. 私网URL、DNS重绑定、跨origin SSE endpoint、redirect和凭据回显明确拒绝；授权信息不进入公开DTO、JSONL或诊断。
5. OAuth本机回调完成真实协议fixture交换、刷新、重放拒绝和断开；不使用真实用户账号作为普通测试前提。
6. 各provider连接与受限REST gateway走真实HTTP fixture，Run能力过期/撤销及未授权路径无法发出请求。

## Tasks

- [x] 目录元数据、开关、只读授权、JSON交换和候选冻结。
- [x] 受控网络fetch、官方远程Transport及真实HTTP/SSE fixture。
- [x] 远程配置/信任/秘密/授权持久化和管理API。
- [x] MCP OAuth发现/回调/刷新/撤销与UI。
- [ ] 外部provider连接、受限REST gateway与UI。
- [x] MCP模块定向测试、集成装配、浏览器与交付证据；完整M4检查由主Tasks记录。
- [x] 远程MCP表单/JSON双Tab、Header编辑、MCP ID唯一校验与真实草稿连接测试，定向纯函数/宿主/SDK检查完成。
- [ ] 用户验收本轮配置交互；未重新运行浏览器视觉或真实第三方账号授权。

## Issues

第三方账号、scope审核与平台证据分别记录；本机协议fixture证明协议实现，不能代替真实账户接入验收。未完成项持续保留，不以配置界面或空适配器宣称完成。

### 官方服务地址核对

2026-10-22只核对官方配置文档，不以地址存在声称真实账户授权通过。内置插件安装仅创建停用配置；所有账户仍需用户单独授权。

| 服务                                     | Streamable HTTP地址                                                                                                                                                                                                  | 官方依据与限制                                                                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub                                   | `https://api.githubcopilot.com/mcp/`                                                                                                                                                                                 | [官方远程Server说明](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md)                                                          |
| Notion                                   | `https://mcp.notion.com/mcp`                                                                                                                                                                                         | [官方客户端指南](https://developers.notion.com/guides/mcp/build-mcp-client)，显式兼容SSE地址为`https://mcp.notion.com/sse`                                 |
| Vercel                                   | `https://mcp.vercel.com`                                                                                                                                                                                             | [官方指南](https://vercel.com/docs/ai-tooling/vercel-mcp)，仅支持其审核通过的客户端，普通自建客户端可能需要申请                                            |
| Supabase                                 | `https://mcp.supabase.com/mcp`                                                                                                                                                                                       | [官方指南](https://supabase.com/docs/guides/ai-tools/mcp)，可在配置中限定项目及只读范围                                                                    |
| Google Drive/Docs/Sheets/Slides/Calendar | `https://drivemcp.googleapis.com/mcp/v1`、`https://docsmcp.googleapis.com/mcp/v1`、`https://sheetsmcp.googleapis.com/mcp/v1`、`https://slidesmcp.googleapis.com/mcp/v1`、`https://calendarmcp.googleapis.com/mcp/v1` | [官方配置](https://developers.google.com/workspace/guides/configure-mcp-servers)，每产品独立地址，需要预注册OAuth客户端；刷新令牌使用`access_type=offline` |

预注册MCP OAuth配置使用公开`oauthClient`字段记录Client ID、issuer、scope和offline选项；Client Secret通过独立秘密接口保存。它与应用GitHub Client Secret及Provider连接记录没有复用关系。
