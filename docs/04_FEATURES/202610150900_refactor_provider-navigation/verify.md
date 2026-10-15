# Provider与侧栏精简验证

2026-10-15，macOS arm64 / Node24.20.0。本次实现完成，未提交。按用户要求缩小检查范围，未重复全量测试、Electron打包或桌面smoke。

## 实现

- 配置目录仅保留OpenAI、Anthropic、Google、DeepSeek、MiniMax、Kimi。OpenAI仍使用openai-codex的原模型与OAuth，Kimi使用kimi-coding；不改为原openai目录或混用凭据。
- Provider卡片移除“内置 Provider”描述，保留模型数量与认证状态。移除不再使用的品牌图标资源导入。
- 侧栏参考上部页面导航和底部身份卡片布局；设置从页面导航移除，用户信息卡片直接打开既有设置Dialog。配对、可选GitHub登录和退出改为具名图标入口。
- 旧厂商配置、ID、凭据与会话不删除；配置列表隐藏，历史按ID读取和运行兼容。自定义Provider保持原流程。

## 实际检查

| 检查                         | 结果                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 改动TS/TSX/MJS文件ESLint     | Pass；修改后重新检查侧栏和浏览器断言。                                                                                                   |
| Web与agent-runtime typecheck | Pass；Web包含源码、配置及独立测试编译面。                                                                                                |
| 三份相关源码行为测试         | Pass；model-settings、model-gateway及m1-api共17项。包含六厂商精确顺序/名称、Codex模型API、被隐藏厂商ID读取、原有代理会话运行与认证隔离。 |
| 定向Web/daemon构建           | Pass；Turbo5任务，2缓存、3执行，未构建desktop。                                                                                          |
| settings.spec.ts             | Pass；真实Chromium3项，覆盖导航仅两项、用户卡片触发、六个Provider、去标记、关闭焦点、无Key/默认值/草稿及OAuth视图清理。                  |
| a11y与源码约定               | Pass；源码约定245文件。                                                                                                                  |
| 格式、文档与diff检查         | Pass；仅记录本次实际执行范围。                                                                                                           |

首次类型检查发现所用Lucide版本不提供GitHub品牌图标，已改用通用登录图标并重跑通过。设置OAuth视图fixture改为仍支持两种认证方式的Anthropic；未连接真实供应商。

用户可直接运行 `pnpm dev:desktop`，点击左下角用户信息卡片打开模型设置。已有发布目录未重新打包；本次界面应通过开发入口验收。
