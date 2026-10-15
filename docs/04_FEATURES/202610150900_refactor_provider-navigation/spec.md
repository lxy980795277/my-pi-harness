# Provider与侧栏精简

## Spec

状态：实现及定向检查完成，见[验证记录](verify.md)。本次采用定向检查，不重复全量构建、打包和跨平台回归。

### Intent

模型设置仅展示OpenAI、Anthropic、Google、DeepSeek、MiniMax、Kimi六个内置入口，移除“内置 Provider”标记。侧栏参考标杆的上部导航、底部用户信息布局；点击用户卡片直接打开设置，导航中不再提供设置项。

### Constraints

OpenAI使用原openai-codex的模型与OAuth，显示名改为OpenAI，不混入原openai目录；Kimi使用现有kimi-coding，MiniMax使用现有minimax。自定义Provider不受影响。已保存的其他厂商配置与凭据保留，仅移出可配置目录，既有会话仍能按ID读取与继续，不删除数据库记录或改写历史。

用户卡片使用已有身份；未登录GitHub时显示本机用户。使用shadcn Button保持键盘与关闭设置后的焦点恢复。配对、可选GitHub登录和退出仍可访问，不新增下拉菜单中间步骤。

### Acceptance Criteria

- 配置目录恰为上述六个厂商，OpenAI仅展示Codex目录；已有被移除厂商记录不再出现在列表。
- Provider卡片不出现“内置 Provider”，保留模型数量和认证状态。
- 导航只有会话和运行状态；底部用户卡片打开既有设置Dialog。
- 改动文件lint、Web/runtime类型和相关Provider行为检查通过；未执行的全量验证明确记录。

## UseCase

打开模型设置检查六个入口与模型数量；点击用户卡片进入设置并关闭，继续原会话。旧数据库启动仍可读取被隐藏的Provider；自定义模型配置保持原行为。

## Tasks

- [x] 精简目录与名称，保留历史读取。
- [x] 改侧栏和用户卡片，去除Provider标记。
- [x] 同步文档与已有断言，执行定向检查并记录证据。

## Issues

原OpenAI与Codex是两套独立认证和模型目录，不能只改原OpenAI名称来实现要求；必须保留Codex的实际factory与配置ID。
