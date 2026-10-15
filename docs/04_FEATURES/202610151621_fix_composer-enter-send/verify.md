# 输入框回车发送验证

日期：2026-10-15，北京时间。产品0.2.0、wire5；macOS arm64、Node24.20.0、Chromium。本轮只修改Renderer输入交互与对应文档/回归，未提交或推送。

## 结果

- AC-01 Pass：新对话Enter创建并发送，已有对话Enter继续发送，均经真实daemon/Pi链路收到本机合成模型回复。
- AC-02 Pass（浏览器事件范围）：两个输入场景的Shift+Enter均保留换行且不发送；isComposing与229键码的确认事件均不提交，随后独立Enter才发送。未声称验证真实OS输入法候选窗口。
- AC-03 Pass（检查范围）：未选模型及空白草稿按Enter不创建会话或输入；Ctrl+Enter、Cmd+Enter各成功一次。共1次会话创建、4次输入和4次合成模型请求，没有额外提交。快捷键调用原生发送按钮click，继续遵守按钮disabled；提交中禁用沿用原路径，本轮未另建在途竞态用例。

## 实际检查

- 修改的三个源码文件定向ESLint、Prettier通过。
- `pnpm --filter @my-pi-harness/web build`通过，包含Web源码、构建配置和测试三个编译面的类型检查。
- `pnpm exec tsc -p tests/e2e/tsconfig.json --noEmit`通过。
- `pnpm exec playwright test tests/e2e/m1.spec.ts -g '新对话与已有对话回车发送'`最终1项通过，使用隔离临时profile、动态端口、内存凭据和本机测试模型，无真实供应商调用。

首轮浏览器用例额外假定Ctrl+Shift+Enter也会由浏览器插入换行，与Chromium原生行为不符；用例收敛至需求指定的Shift+Enter后通过，未为其他修饰键组合增加自定义编辑逻辑。本轮未重跑全仓测试或桌面打包；浏览器与Electron共用这份Renderer，开发模式通过热更新查看。
