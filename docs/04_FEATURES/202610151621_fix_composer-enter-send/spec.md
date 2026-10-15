# 输入框回车发送

## Spec

状态：实现与定向浏览器检查通过，见[验证记录](verify.md)；用户后续授权本地提交，随[0.2.1](../../06_RELEASES/0.2.1.md)记录，提交结果以Git为准，不推送。

### Roadmap Alignment

属于[roadmap](../../00_OVERVIEW/roadmap.md)中已实现的M1会话与M2共用输入栏交互小修，不新增M3能力；既有M2暂缓项保持原状态。

### Intent

新对话与已有会话默认按Enter发送，Shift+Enter换行；中文输入法确认候选词不发送，发送按钮不可用时快捷键也不可提交。

### Constraints

- 共用一个键盘处理函数，组件只绑定事件，保留点击发送、队列/引导与请求去重语义。
- Enter发送，Shift+Enter换行；保留Ctrl/Cmd+Enter发送兼容，Alt+Enter仍允许输入换行。
- IME的isComposing或229键码表示确认过程，不拦截其回车；确认完成后再次单独Enter才发送。
- 快捷键走同一发送按钮的可用状态，不通过requestSubmit绕开空消息、未选模型或pending限制。
- 提示文案与使用指南同步，定向检查使用隔离测试模型，不调用真实供应商。

### Acceptance Criteria

- AC-01：新对话Enter实际创建会话并收到响应；已有对话Enter实际发送后续消息。
- AC-02：Shift+Enter插入换行，不增加会话/输入请求；IME确认回车不提交。
- AC-03：未选模型、空消息与提交中不可用时，Enter不绕过发送按钮；原Ctrl/Cmd快捷键和点击发送可用。

## UseCase

- UC-01 配置可用模型，输入文字按Enter，收到回复后继续输入并按Enter；每次仅接受一条输入。
- UC-02 输入第一行，Shift+Enter后输入第二行；IME确认候选词后仍保留草稿，再单独Enter提交。
- UC-03 未配置模型或草稿为空时按Enter，不创建会话或调用模型；快捷键和按钮共享同一限制。

## Tasks

- [x] 合并两处快捷键实现，改为Enter发送并保护换行、IME与按钮禁用状态。
- [x] 同步按钮提示、Web说明和用户指南。
- [x] 定向类型、规范、构建和浏览器验证，记录结果。

## Issues

当前新对话和已有对话分别维护Ctrl/Cmd+Enter提交逻辑，普通Enter只换行；requestSubmit没有经过发送按钮的disabled状态。修复集中到共用函数，通过实际发送按钮触发表单。
