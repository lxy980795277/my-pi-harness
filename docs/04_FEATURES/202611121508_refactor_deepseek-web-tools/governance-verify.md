# 联网工具代码治理验证

日期：2026-11-12；产品0.20.0工作区；公开协议29；macOS arm64、Node24.20.0。本轮沿用联网工具Spec，检查原始HTTP、提供商适配、宿主凭据、Web状态和全仓消费者，保留上轮未提交实现及历史验证记录。

## 治理结果

| 级别 | 位置                               | 问题与处理                                                                                                         | 验证                                                                    |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 中   | integrations/web/target            | 搜索文本裁剪末尾标点时误删IPv6的合法闭括号，解析失败后略过私网检查；先尝试完整URL，再处理无效的Markdown闭括号      | 裸回环/私有IPv6和Markdown包裹URL均零上传                                |
| 中   | integrations/web/deepseek          | 响应正文释放失败覆盖已经确定的HTTP或格式错误；统一安全释放并保留原始分类                                           | 401及非JSON响应的cancel失败回归                                         |
| 中   | daemon/web/service                 | 保存后再读status，重复访问系统凭据，并等待后续写入；改为在本次串行写操作内返回自身状态                             | gate证明保存返回不等候随后阻塞的删除，且没有额外read                    |
| 中   | daemon/web/service                 | 原30秒期限及caller取消不包含等待配置；等待现在可取消且计入期限，系统写保持独立资源所有权                           | caller abort、30秒fake clock、关闭等待与后续恢复                        |
| 中   | tools/lib/web-content              | raw只限制正文，附加URL/HTTP后超过声明的输出上限；page/raw共用完整文本预算，跳转URL同样有长度边界                   | 两种raw输出不超过100000字符并保留来源和截断提示，超长跳转不发第二个请求 |
| 低   | tools/tools/web-fetch、lib/web-raw | 模型工具混合原始HTTP的循环、截止及网关规则，page依赖raw解析；raw传输归独立模块，page目标校验归真实宿主适配器       | 原始HTTP、跳转、只读拒绝、网关与daemon四类page目标零上传                |
| 低   | integrations/network               | 通用传输依赖MCP FetchLike，DeepSeek又定义相同签名，Request分支不在声明支持范围；network拥有RemoteFetch并移除旧分支 | 通用网络、远端MCP与OAuth定向回归及类型检查                              |
| 低   | protocol/web、internal/web         | 公开设置协议混入无公开响应消费者的宿主结果schema；删除镜像schema，纯宿主类型移入internal，第三方响应校验归adapter  | 全消费者类型检查、导入边界及运行回归                                    |
| 低   | web-search设置Hook                 | 成功缓存写接口返回值后仍发GET；成功直接采用状态，失败才重读，写前取消旧状态查询                                    | QueryObserver与实际浏览器请求计数                                       |
| 低   | 搜索参数与GitHub Skills            | 模型参数缺少语义描述，三个Skill保留旧shell声明；补齐字段说明并使用run_command                                      | 工具声明、Skill manifest与主子Run回归                                   |

客户端search/page各自拥有一次60秒截止，内部POST只继承信号；宿主30秒产品期限与通用网络120秒保护仍由不同所有者保持。网页JSON的严格UTF-8解码由适配器统一负责，不再在默认传输上重复启用解码。

未发现第二套旧搜索实现、遗漏mode的实际web_fetch调用或遗留http_request入口。raw、精确插件网关、工具审批和本地记忆搜索都有真实消费者，继续保留；没有清理用户数据、读取真实凭据、修改.env或新增兼容层。

## 自动化证据

以下命令均使用Node24.20.0；没有运行全仓测试套件。

- `pnpm typecheck`：根与e2e编译面、11个workspace任务通过；随后raw文本预算调整的tools类型检查再次通过。
- `pnpm lint`：ESLint、a11y、源码组织、导入边界、文档与版本检查通过；后续raw抽离与预算相关文件的定向ESLint、格式检查通过。
- `pnpm build`：Web与Electron main/preload通过，保留原有renderer配置和chunk大小提示；没有生成安装包。
- `pnpm --filter @my-pi-harness/daemon test:deployment`：3文件7项通过，验证源码生产部署及Node/tsx加载。
- `pnpm exec vitest run packages/tools/test/web-service-tools.test.ts packages/tools/test/web-raw.test.ts packages/tools/test/web.test.ts packages/agent-runtime/test/web-tools-runtime.test.ts packages/agent-runtime/test/tool-selection.test.ts apps/daemon/test/plugin-connection-api.test.ts apps/daemon/test/web-service.test.ts apps/daemon/test/web-api.test.ts apps/web/test/web-service-settings.test.ts --maxWorkers=2`：最终9文件117项通过，包括主子Pi循环与真实临时HTTP边界。
- `pnpm exec vitest run packages/integrations/test/deepseek-web.test.ts packages/integrations/test/network-request.test.ts packages/integrations/test/remote.test.ts packages/integrations/test/remote-oauth.test.ts --maxWorkers=2`：4文件86项通过；最后移除重复UTF-8解码后，前两文件60项再次通过。
- Skill manifest与当时三个联网工具文件组合回归4文件101项通过；测试文件随后从web-request.test.ts更名为web-raw.test.ts，最终命令使用新名称。
- 最终Prettier、源码组织、导入边界、文档检查及`git diff --check`通过。未提交或推送。

## 隔离浏览器证据

Playwright CLI使用实际编译Web及临时daemon，只有模型和提供商返回使用合成响应；profile、内存凭据、动态端口和测试身份均独立，不占用用户开发端口。

1. 首次打开联网设置，GET状态显示未配置。保存后输入清空；从操作前到成功提示只记录一次PUT，没有额外GET。
2. 注入一次503删除失败，界面显示合成错误，记录恰好DELETE→GET，没有重试写入；随后成功删除只有一次DELETE。
3. 再次保存并发起对话，Pi经过三次模型请求，完成web_search、web_fetch/page及最终回答，两个工具均completed，上游只收到Search和Fetch各一次。
4. 会话、模型请求和工具证据不含合成Key。console只有故意注入的HTTP503资源错误，没有额外应用异常。关闭浏览器及daemon并删除临时profile。

本机证据位于忽略目录`output/playwright/web-governance-evidence.json`和`web-governance-conversation.png`；fixture脚本在`.cache/deepseek-web/browser-server.ts`，不随产品发布。

## 验证边界

本轮治理与隔离回归通过。未使用真实DeepSeek Key或真实插件账户验证付费服务，未做Windows实机、系统Keychain交互、Electron安装包及用户体验验收；这些边界沿用初次验证记录，不据此关闭既有平台缺口。
