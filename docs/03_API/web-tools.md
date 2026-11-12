# 联网工具

公网搜索与网页正文由DeepSeek官方[Search](https://api-docs.deepseek.com/zh-cn/api/search/)和[Fetch](https://api-docs.deepseek.com/zh-cn/api/fetch/)服务提供；本页拥有产品参数、权限与凭据规则。它们与M6本地记忆/对话检索独立，不依赖当前聊天模型的供应商。

## 设置与凭据

设置→联网搜索管理独立的官方DeepSeek API Key。`GET /api/web/status`仅返回`{provider:"deepseek",configured:boolean}`；`PUT /api/web/credential`接收`{apiKey}`并返回状态；`DELETE /api/web/credential`接收`{}`并返回状态。接口要求应用登录、受信任来源和写入CSRF，响应禁止缓存。Key必须是1–4096个不含空白的可打印ASCII字符；保存不发起付费连接测试。

daemon将Key存入当前profile的系统凭据命名空间，引用为`web.deepseek.api-key`；不存入SQLite、JSONL、工具参数或查询缓存。Web表单仅保留临时秘密输入，提交后立即清空。环境变量和聊天模型Key不会隐式填充联网凭据。更新或删除Key取消当前代次请求，写接口返回本次串行写入的配置结果；成功时界面直接采用该状态，失败或结果未知才重读。搜索/page的30秒总期限包含等待配置阶段，调用方取消只退出等待，不取消独立拥有的系统写入。关闭服务拒绝新操作并等待网络及系统凭据操作退出。

## 工具参数与输出

| 工具                       | 参数                                                                                                            | 结果                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `web_search`               | `query`必填，1–128个Unicode字符且非空白；`count?`1–50；`oriQuestion?`1–128字符；`localization?`；`needContent?` | 搜索结果包含标题、URL、片段、摘要及来源元数据；空结果正常返回 |
| `web_fetch`，`mode:"page"` | `url`必填，不接受method/body/contentType                                                                        | 请求来源URL、标题及提取的Markdown正文                         |
| `web_fetch`，`mode:"raw"`  | `url`必填；`method?`为GET或POST；POST可带body及受限contentType                                                  | HTTP状态及有界原始文本，包括JSON                              |

两项工具默认加载，不要求工作区。模式必须显式填写，避免将JSON接口或本地插件网关上传给第三方。缺少Key只影响search/page；raw继续使用本地受控HTTP实现。错误不触发静默降级或自动重试，网页不可提取、认证、余额、限流、超时及无效响应分别给出安全说明；释放响应正文失败不覆盖已经确定的HTTP或格式错误。

搜索和网页结果属于宿主端口类型，由protocol/internal共享；公开web协议只定义模型搜索参数及设置输入/状态，不发布额外的结果HTTP接口。

Search/Fetch固定使用`https://api.deepseek.com/v1/tools/search`与`/v1/tools/fetch`。官方JSON字段在integrations中校验并映射为宿主camelCase结果；总响应最多4MiB，工具输出最多100000字符，并保留来源与截断提示。网页文本与搜索摘要是不可信外部内容，不能作为新的用户指令。正文接口不承诺任意站点、反爬或浏览器JavaScript执行可用。

## 网络与权限

搜索与page是业务只读，虽向提供商发送POST，效果策略仍为`mutating:false`；沿用会话审批方式，完全访问自动放行。raw GET只读；raw POST是外部写入，受原审批策略及只读角色上限约束。主/子Run使用同一端口，角色只读不会把搜索服务的传输POST误认为写操作。

page目标仅允许无凭据的公网HTTP(S)标准端口URL，解析全部DNS记录后才允许上传；本地、私有、保留、元数据地址被拒绝。搜索查询中的明确HTTP(S)本地字面地址同样不得上传；普通搜索文本不做DNS解析，此检查不等于识别所有敏感查询。提供商请求不跟随重定向、不继承cookie或环境代理，实际socket固定到检查过的地址。

raw独立执行公网HTTP(S)，初始及跳转URL均限制8192字符，每跳检查并固定DNS，限制响应字节数、跳转及编码，拒绝HTTPS降级。唯一回环例外是宿主绑定的精确`/api/skill-gateway/<plugin>/...`，仅raw GET可访问并由宿主附加内部能力头；不向模型暴露Token，也不向DeepSeek发送该请求。插件Token只由网关附加到允许的上游，见[插件连接协议](plugin-connections.md)。终端和沙箱不因此增加网络权限。

## 代码归属

`packages/tools/src/tools/web-search.ts`与`web-fetch.ts`拥有模型schema、效果策略和格式化；`packages/integrations/src/web/`拥有提供商请求、校验与安全错误；`apps/daemon/src/web/`拥有凭据、代次取消及设置路由；Web的`features/web-search/`拥有秘密表单与公开状态查询。Pi循环和本地记忆搜索不承担网页请求实现。
