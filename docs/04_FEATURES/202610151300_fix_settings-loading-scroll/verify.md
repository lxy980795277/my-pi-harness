# 设置界面修复验证

2026-10-15，应用0.1.0，macOS arm64、Node24.20.0。两处修复已完成源码与Chromium验证，未提交或推送；未重新打包Electron。

| 条件  | 结果                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------- |
| AC-01 | Pass；延迟首次模型内容JS下载，弹窗内显示加载提示，工作台宽度不变，无右侧加载栏。                          |
| AC-02 | Pass；加载时Escape关闭并恢复用户卡片焦点，草稿保留；重新打开后释放下载，模型配置正常显示。                |
| AC-03 | Pass；实际DOM测量滚动轨道距右侧12px、上下20px，内容可滚到Kimi，关闭按钮可用；已查看加载态和完整设置截图。 |

实际检查：Web build包含三个Web类型编译面，另以vite build生成最终产物；改动源码和E2E通过定向ESLint、a11y、E2E类型检查及格式检查。源码约定检查通过，`pnpm exec playwright test tests/e2e/settings.spec.ts`四项通过，包含本次慢加载/滚动回归及既有设置、焦点、CSP和OAuth流程；没有使用真实供应商账号。

本地截图位于`output/playwright/settings-fix-loading.png`、`settings-fix-content.png`和`settings-fix-scroll-inset.png`。Electron与浏览器共用该Renderer；本轮未额外启动桌面产物或验证Windows，用户实际桌面体验仍待查看。
