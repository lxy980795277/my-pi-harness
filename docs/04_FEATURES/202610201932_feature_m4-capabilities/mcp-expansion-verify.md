# MCP扩展验证

验证日期：2026-10-22。本记录覆盖M4.2/M4.3的目录、远程MCP、OAuth与管理界面；外部服务连接和完整M4交付由对应模块及主验证记录汇总。

## 已实现

本地与远程目录展示工具、resources及prompts元数据。工具开关和精确参数只读授权可撤销，重新启用不复活旧Run。JSON配置先预览再导入，导出不含凭据、信任和会话事实。候选冻结读取缓存，不隐式连接Server。

远程MCP通过官方SDK完成Streamable HTTP与显式兼容SSE。受控fetch验证URL、全部DNS地址和实际socket，拒绝私网、保留地址、重定向、跨来源SSE发送及超限内容。调用在真实POST前提交持久屏障，可能派发后断线或取消返回unknown，不自动重放。

独立MCP OAuth包含发现、动态注册或预注册客户端、PKCE、issuer/state校验、单次回调、刷新和断开。静态秘密、客户端秘密和账户令牌进入凭据仓储，公开DTO、导出及诊断不返回秘密。界面支持选择已有外部服务连接作为独立认证来源。

插件App归属保存在私有配置。信任、目录及实际授权检查插件存在、插件与组件均启用、组件引用精确匹配；安装未提交的配置不能使用，也不能通过手动授信绕过停用状态。

## 实际检查

| 检查                                                                                                      | 结果与覆盖                                                                                                    |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @my-pi-harness/integrations exec vitest run test/remote.test.ts test/remote-oauth.test.ts` | 23项通过；真实SDK HTTP/SSE、目录、持久屏障失败零发送、断线unknown单次调用、网络限制、PKCE与issuer/state、刷新 |
| `pnpm --filter @my-pi-harness/daemon exec vitest run test/mcp-api.test.ts test/mcp-directory-api.test.ts` | 13项通过；本地审批与未知结果、只读授权与撤销、工具开关、JSON交换、OAuth回调、插件归属控制                     |
| `pnpm exec playwright test tests/e2e/mcp.spec.ts tests/e2e/mcp-expansion.spec.ts`                         | 4项通过；构建产物下的本地工具运行、断线与排队、远程配置/秘密/信任、配置下载与导入预览、停用                   |
| integrations/Web/daemon定向typecheck及所改MCP文件ESLint                                                   | 通过；最终全仓库检查由主验证记录汇总                                                                          |
| Web构建、daemon及其依赖构建                                                                               | 通过；Web保留既有大chunk提示                                                                                  |
| `git diff --check`                                                                                        | 通过                                                                                                          |

浏览器检查使用临时profile、随机监听端口、测试身份、录制模型和协议fixture，不使用真实第三方账号或付费模型。最后的插件归属授权修正通过daemon源码测试；最终构建与合并后的浏览器回归由主验证记录报告。

## 验证边界

真实HTTP/SSE与OAuth fixture证明本机协议和权限路径，不等于GitHub、Google、Vercel、Notion、Supabase真实账号授权已验收。官方地址已核对，客户端注册、上游审核、账户scope和平台发布证据仍需对应环境验证。Resources和prompts本轮只展示目录，不执行资源读取或提示词调用。

SSE兼容入口使用SDK当前标记弃用的适配器，局部豁免仅覆盖该显式兼容功能。新Server默认使用Streamable HTTP，不自动降级或协议回退。

## 组合回归诊断

首次完整浏览器回归中的三条审批来源用例已完成真实文件创建和最终回答，失败发生在读取默认收起的工具详情。测试现显式展开后检查审批记录，重新加载页面后也重新展开，不改变产品默认收起行为。

M2完整工具链的8192窗口中，M4控制工具定义占约4824tokens，历史增长触发自动压缩；按HTTP请求次数递进的模型fixture把摘要请求误当成后续shell与web步骤。该用例显式使用32768窗口，保留原有工具次数、调用ID、审批、真实文件和历史断言；压缩行为仍由专门用例验证。上述组合修正的重跑结果由本轮主验证记录汇总。

## 配置编辑器与连接测试（2026-10-22）

MCP主入口新增表单/JSON两个Tab，连接方式仅Streamable HTTP/SSE；本地进程和批量交换收进高级配置。MCP ID对应唯一的配置别名，不替代内部UUID。新草稿测试接口使协议升至14，产品版本和存储格式不变。

- `pnpm exec vitest run apps/web/test/remote-mcp-configuration.test.ts apps/web/test/remote-mcp-test.test.ts`：12项通过；覆盖空白草稿往返、认证字段、秘密分离、旧槽位/替换值与混合认证测试决策。
- `pnpm exec vitest run apps/daemon/test/remote-mcp-configuration.test.ts packages/integrations/test/remote.test.ts`：33项通过；真实SDK与隔离HTTP/SSE fixture覆盖握手/目录、拒绝业务调用、Header与地址约束、401/403、取消、秘密保留/清理及重复MCP ID。
- Web三个类型编译面、daemon类型检查、E2E类型检查及所改Web/宿主/协议/manager文件的定向ESLint通过。源码约定、文档检查、格式整理和diff检查通过。早先7项纯转换检查与最终12项重叠，不另行累加。

独立复核修正了三个边界：空白草稿Tab转换接受未完成的ID/地址，必填留到保存/测试；替换秘密测试后清空值不能回退旧Token；混合新值与保留值不能误用原配置报告成功。编辑保存逐个使用秘密写入返回的最新revision，已成功创建后的局部失败保留观察到的配置身份，不重新创建。

本轮没有启动用户服务、改动用户配置、运行浏览器回归或进行真实上游账号授权。界面视觉由用户review；协议14需要开发服务加载新代码后使用。上述定向检查不替代M4仍待完成的真实账户、Office视觉与Windows验收。

## 提交检查修正（2026-10-26）

提交钩子的依赖边界检查拒绝daemon测试直接导入integrations的私有测试fixture，提交未生成。共用的真实SDK远程服务现归入根 `tests/fixtures/remote-mcp.ts`，两个测试从同一位置引用，根开发依赖显式声明其SDK Server与Node适配器；没有修改生产实现或放宽边界规则。修正后 `node scripts/check-boundaries.mjs` 检查636个源码文件通过，其余提交钩子检查以本次提交输出为准。
