# 联网工具验证

日期：2026-11-12；产品0.20.0工作区；公开协议29；macOS arm64、Node24.20.0。真实profile、.env及系统凭据未修改；只使用临时目录、内存凭据与合成提供商响应。

## 结果

| 验收项             | 结果 | 证据                                                                                                             |
| ------------------ | ---- | ---------------------------------------------------------------------------------------------------------------- |
| AC1 搜索与结果     | Pass | 官方端点、字段映射、空数组、Unicode长度、错误分类、响应边界的适配器回归通过                                      |
| AC2 网页与raw权限  | Pass | page不接受原始写入字段；raw GET/POST、私网拒绝、逐跳重查及插件网关回归通过；只读子Run拒绝raw POST                |
| AC3 独立凭据       | Pass | HTTP登录/来源/CSRF、非法Header字符拒绝、保存不出网、重启保留和删除通过；浏览器保存清空输入、删除、重开不回填通过 |
| AC4 生命周期       | Pass | 更换Key撤销旧请求、取消、关闭等待系统写入、后端错误恢复；适配器超时/大小/非法UTF-8/JSON/重定向验证通过           |
| AC5 主子链路与展示 | Pass | 主子Pi loop均search→page→回答；结果进入后续模型上下文与JSONL；实际浏览器展开搜索/正文详情成功                    |
| AC6 工程与隔离验收 | Pass | 类型、lint、构建、7项部署检查及合成浏览器全链路通过；真实付费API与其他平台未验，见下文                           |

## 实际检查

所有pnpm命令使用仓库缓存的Node24.20.0。

- `pnpm typecheck`：11个workspace任务及根/e2e编译面通过；最后协议文件归入web/web.ts后再次执行protocol类型检查与daemon服务回归通过。
- `pnpm lint`：ESLint、a11y、导入边界、源码声明组织、文档及版本检查通过；后续只移除HTTP无消费者错误分支、迁移协议文件并更新文档，相关局部ESLint及最终文档/源码gate通过。
- `pnpm build`：Web与Electron构建通过。沿用既有renderer配置与chunk大小提示，没有打安装包。
- `pnpm --filter @my-pi-harness/daemon test:deployment`：3文件7项通过，使用隔离生产部署和独立Node/tsx进程。
- `pnpm exec vitest run apps/daemon/test/web-service.test.ts apps/daemon/test/web-api.test.ts apps/daemon/test/application-services.test.ts apps/daemon/test/plugin-connection-api.test.ts --maxWorkers=2`：4文件17项通过。
- `pnpm exec vitest run apps/daemon/test/web-service.test.ts apps/daemon/test/web-api.test.ts apps/daemon/test/plugin-connection-api.test.ts packages/integrations/test/deepseek-web.test.ts packages/integrations/test/remote-network.test.ts packages/storage/test/agent-query.test.ts packages/storage/test/agent-tasks.test.ts apps/web/test/web-service-settings.test.ts apps/web/test/tool-presentation.test.ts --maxWorkers=2`：8个实际匹配文件103项通过；remote-network.test.ts不存在，不计入覆盖。
- integrations新适配器46项、tools全包15文件156项、runtime定向7文件48项通过。runtime整包曾发现新增工具来源期望遗漏并修正；原有长循环测试并发时超过5秒，未放宽时限，相关两文件串行重跑11项通过；不将该次整包运行描述为全绿。
- 改动文件Prettier检查和`git diff --check`通过；未执行commit或push。

## 浏览器与宿主证据

使用Playwright CLI打开实际生产Web资产，由临时daemon提供真实设置、HTTP、Pi、工具和会话落盘链路；只将DeepSeek和聊天供应商替换为合成响应。所有服务动态选端口，没有使用4311/5174，也未停止用户服务。

1. 联网搜索设置初始未配置；保存合成Key后显示已配置、秘密输入为空，保存本身没有上游请求。
2. 删除Key后，实际工具调用失败且提示需在设置配置；宿主证据确认出网次数为0。最初直接等待错误文字因过程/工具详情折叠而超时，改为检查真实工具快照，没有改动折叠交互。
3. 再次配置后，浏览器发起新对话；Pi经三次模型请求完成web_search、web_fetch/page及最终回答。合成上游只收到固定Search和Fetch请求，各一次；两个工具均completed。
4. 回答过程可展开，搜索详情含来源标题/URL，page详情含Markdown正文；浅/深主题设置界面已截图并查看，重开设置不回填Key，浏览器console无error。
5. 保存的会话快照和模型请求证据不含合成Key。测试浏览器关闭、daemon退出并删除临时profile。

本机证据位于忽略目录`output/playwright/deepseek-web-settings-light.png`、`deepseek-web-settings-dark.png`、`deepseek-web-conversation.png`和`deepseek-web-evidence.json`；fixture启动脚本位于`.cache/deepseek-web/browser-server.ts`，仅供本机重现，不随产品发布。

## 未验证项

未使用用户Key请求真实DeepSeek付费API，不能据此确认账户余额、真实搜索质量、目标站点反爬或服务可用性。未执行Windows实机、Electron安装包、系统Keychain交互及真实插件账户重新授权；插件网关使用现有合成授权回归。上述外部验收不影响本轮源码与隔离全链路结论，也不关闭既有平台验收缺口。
