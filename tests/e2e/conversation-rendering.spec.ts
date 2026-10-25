import { test, expect } from './fixture.js';
import { startMarkdownModel } from './markdown-model.js';
import { configureTestProvider } from './model-fixtures.js';
import { chooseOption, openUserSettings } from './ui-controls.js';
import { startToolSequenceModel } from './m2-completion-model.js';

const PREFIX = [
  '## 渲染验证',
  '',
  '这是一段**重点内容**，包含 `inlineCode` 和 ~~删除线~~。',
  '',
  '你说的**“test”确实出现过两次**（搜索直接命中两条，都是你说的）',
  '',
  '> 引用内容',
  '',
  '- 第一项',
  '- 第二项',
  '',
  '  第二项里的独立段落。',
  '',
  '- [x] 已完成',
  '- [ ] 待处理',
  '',
  '| 文件 | 说明 | 状态 | 来源 | 校验 | 备注 |',
  '| --- | --- | --- | --- | --- | --- |',
  '| `report.md` | 正常渲染 | 已生成 | 本次会话 | 已完成 | 较宽的表格应该只在自己的区域内滚动 |',
  '',
  '[文档链接](https://example.com/guide)',
  '',
  '```typescript',
  'const answer = 42;',
].join('\n');
const SUFFIX = [
  '',
  'console.log(answer);',
  '```',
  '',
  '<script>document.documentElement.dataset.markdownExecuted = "yes"</script>',
  '',
  '[危险链接](javascript:alert(1))',
  '',
  '![远程插图](https://example.com/remote-image.png)',
  '',
  '回答结束。',
].join('\n');

test('一次回答跨工具步骤只在末尾复制全部正文，底部统计保持一个用户轮次', async ({
  page,
  daemon,
}, testInfo) => {
  const first = '不确定，我按记忆数的，没实际核对原始记录。我来查证。';
  const second = '第一次检索已经完成，我再核对一次。';
  const final = '核对完成，**test**确实出现过两次。';
  const model = await startToolSequenceModel(
    [
      { name: 'search_session_history', arguments: { query: 'test' }, content: first },
      { name: 'search_session_history', arguments: { query: 'test' }, content: second },
    ],
    final,
  );
  try {
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin);
    await page.reload();
    const statistics = page.getByRole('group', { name: '对话统计', exact: true });
    await expect(statistics).toHaveText(/^上下文 —\s*\|\s*总对话 0 次$/u);
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    await page.getByLabel('消息', { exact: true }).fill('核对test出现次数');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const answers = page.getByRole('article', { name: 'Agent的消息', exact: true });
    await expect(answers.last()).toContainText('核对完成');
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeHidden();
    await expect(answers).toHaveCount(3);
    await expect(answers.getByRole('button', { name: '复制消息', exact: true })).toHaveCount(0);
    const tools = page.getByLabel('search_session_history 工具调用', { exact: true });
    await expect(tools).toHaveCount(2);
    const footer = page.getByLabel('回答操作', { exact: true });
    await expect(footer).toHaveCount(1);
    const footerBounds = await footer.boundingBox();
    const toolBounds = await tools.last().boundingBox();
    if (!footerBounds || !toolBounds) throw new Error('The answer footer is not visible');
    expect(footerBounds.y).toBeGreaterThanOrEqual(toolBounds.y + toolBounds.height);
    await expect(statistics).toContainText('总对话 1 次');
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: daemon.origin });
    await footer.getByRole('button', { name: '复制回答', exact: true }).click();
    expect(await page.evaluate(async () => await navigator.clipboard.readText())).toBe(
      [first, second, final].join('\n\n'),
    );
    await page.screenshot({ path: testInfo.outputPath('answer-footer.png') });
    await page.reload();
    await page.getByRole('button', { name: /^核对test出现次数 /u }).click();
    await expect(footer).toHaveCount(1);
    await expect(statistics).toContainText('总对话 1 次');
    await footer.getByRole('button', { name: '复制回答', exact: true }).click();
    expect(await page.evaluate(async () => await navigator.clipboard.readText())).toBe(
      [first, second, final].join('\n\n'),
    );
  } finally {
    await model.close();
  }
});

test('工具展开选择跨虚拟卸载与会话切换保留，输入草稿独立保存', async ({ page, daemon }) => {
  const calls = Array.from({ length: 16 }, (_, index) => {
    return {
      name: 'search_session_history',
      arguments: { query: `state-retain-${index}` },
      content: `正在检索第${index + 1}项。`,
    };
  });
  const model = await startToolSequenceModel(calls, '状态生命周期验证完成。');
  try {
    await page.goto(daemon.origin);
    // Keep all sixteen tool rounds in context; this case tests UI state rather than compaction.
    await configureTestProvider(page, model.origin, 32768);
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    const draft = page.getByLabel('消息', { exact: true });
    await draft.fill('工具展开保留');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByText('状态生命周期验证完成。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
    const timeline = page.getByLabel('对话记录', { exact: true });
    const firstTool = page
      .getByLabel('search_session_history 工具调用', { exact: true })
      .filter({ hasText: 'state-retain-0' });
    await timeline.evaluate((element) => {
      element.scrollTop = 0;
    });
    await firstTool
      .getByRole('button', { name: '展开 search_session_history 工具详情', exact: true })
      .click();
    await expect(firstTool.getByRole('region', { name: '调用参数', exact: true })).toBeVisible();
    await timeline.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(firstTool).toHaveCount(0);
    await timeline.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(
      firstTool.getByRole('button', { name: '收起 search_session_history 工具详情', exact: true }),
    ).toHaveAttribute('aria-expanded', 'true');
    await draft.fill('旧会话未提交草稿');
    await page.getByRole('button', { name: '新对话', exact: true }).click();
    await expect(draft).toHaveValue('');
    await page.getByRole('button', { name: /^工具展开保留 /u }).click();
    await expect(draft).toHaveValue('旧会话未提交草稿');
    await timeline.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(
      firstTool.getByRole('button', { name: '收起 search_session_history 工具详情', exact: true }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(model.requests).toHaveLength(17);
  } finally {
    await model.close();
  }
});

test('首响应延迟有等待提示，刷新可恢复，正文到达后接替等待', async ({ page, daemon }, testInfo) => {
  const model = await startMarkdownModel('正在返回的首段正文。', '\n\n回答已完成。', {
    pauseBeforeStart: true,
  });
  try {
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin);
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    await page.getByLabel('消息', { exact: true }).fill('首响应等待验证');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => model.requests).toBe(1);
    const waiting = page.getByRole('status', { name: '正在等待响应', exact: true });
    const answer = page.getByRole('article', { name: 'Agent的消息', exact: true });
    await expect(waiting).toBeVisible();
    await expect(answer).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('conversation-waiting.png') });
    await page.reload();
    await page.getByRole('button', { name: /^首响应等待验证 /u }).click();
    await expect(waiting).toBeVisible();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
    model.start();
    await expect(answer).toContainText('正在返回的首段正文。');
    await expect(waiting).toHaveCount(0);
    model.finish();
    await expect(answer).toContainText('回答已完成。');
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible();
    await expect(waiting).toHaveCount(0);
  } finally {
    await model.close();
  }
});

test('模型尚未返回内容时也可以停止，等待提示随真实运行结束消失', async ({ page, daemon }) => {
  const model = await startMarkdownModel('停止后不应显示的正文。', '', { pauseBeforeStart: true });
  try {
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin);
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    await page.getByLabel('消息', { exact: true }).fill('首响应前停止验证');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => model.requests).toBe(1);
    const waiting = page.getByRole('status', { name: '正在等待响应', exact: true });
    await expect(waiting).toBeVisible();
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible();
    await expect(waiting).toHaveCount(0);
    const answer = page.getByRole('article', { name: 'Agent的消息', exact: true });
    await expect(answer.getByRole('status')).toHaveText('已取消');
    await expect.poll(() => model.closedResponses).toBe(1);
    model.start();
    model.finish();
    await expect(answer).not.toContainText('停止后不应显示的正文。');
    await expect(page.getByText('事件断线 · 正在重连', { exact: true })).toHaveCount(0);
  } finally {
    await model.close();
  }
});

test('Markdown流式、完成与刷新一致，代码可复制且HTML和图片不执行', async ({
  page,
  daemon,
}, testInfo) => {
  const model = await startMarkdownModel(PREFIX, SUFFIX);
  const pageErrors: string[] = [];
  const remoteImages: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('remote-image.png')) remoteImages.push(request.url());
  });
  try {
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        document.documentElement.dataset['cspViolation'] = event.violatedDirective;
      });
    });
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin);
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    await page.getByLabel('消息', { exact: true }).fill('**原始输入**');
    const composerBounds = await page
      .getByLabel('消息', { exact: true })
      .locator('..')
      .boundingBox();
    if (!composerBounds) throw new Error('Composer surface is not visible');
    expect(composerBounds.width).toBe(896);
    expect(composerBounds.height).toBeLessThan(145);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const answer = page.getByRole('article', { name: 'Agent的消息', exact: true });
    await expect(answer.locator('pre')).toContainText('const answer = 42;');
    await expect(page.getByLabel('回答统计')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '复制回答', exact: true })).toHaveCount(0);
    const conversationStats = page.getByRole('group', { name: '对话统计', exact: true });
    await expect(conversationStats).toContainText('总对话 1 次');
    await expect(conversationStats).toHaveText(/^上下文 (?:\d+%|—)\s*\|\s*总对话 1 次$/u);
    await expect(page.getByRole('combobox', { name: '运行中输入策略', exact: true })).toHaveCount(
      0,
    );
    const statsBounds = await conversationStats.boundingBox();
    const surfaceBounds = await page
      .getByLabel('消息', { exact: true })
      .locator('..')
      .boundingBox();
    if (!statsBounds || !surfaceBounds) throw new Error('The composer footer is not mounted');
    expect(statsBounds.y).toBeGreaterThanOrEqual(surfaceBounds.y + surfaceBounds.height);
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
    await expect(answer.locator('table')).toContainText('report.md');
    await expect(answer.locator('strong')).toHaveText(['重点内容', '“test”确实出现过两次']);
    const typography = await answer.locator('.markdown').evaluate((root) => {
      const style = getComputedStyle(root);
      const fractionalMetrics: string[] = [];
      const elements = root.querySelectorAll(
        'h1, h2, h3, h4, h5, h6, p, ul, ol, li, blockquote, table, th, td, pre',
      );
      for (const element of elements) {
        const computed = getComputedStyle(element);
        for (const property of [
          'font-size',
          'line-height',
          'margin-top',
          'margin-bottom',
          'padding-top',
          'padding-bottom',
        ]) {
          const value = computed.getPropertyValue(property);
          if (!Number.isInteger(Number.parseFloat(value))) {
            fractionalMetrics.push(`${element.tagName}.${property}=${value}`);
          }
        }
      }
      return { fontSize: style.fontSize, lineHeight: style.lineHeight, fractionalMetrics };
    });
    expect(typography).toEqual({
      fontSize: '14px',
      lineHeight: '28px',
      fractionalMetrics: [],
    });
    expect(
      await answer.getByText('第二项里的独立段落。', { exact: true }).evaluate((element) => {
        return getComputedStyle(element).display;
      }),
    ).toBe('block');
    model.finish();
    await expect(answer).toContainText('回答结束。');
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible();
    const statistics = page.getByLabel('回答统计');
    await expect(statistics).toContainText('用量 1.2K tok');
    await expect(statistics.locator('[title^="总计 1,248 tok；"]')).toBeVisible();
    await expect(statistics).toContainText('用时');
    await expect(statistics.locator('time')).toHaveAttribute('datetime', /\d{4}-\d{2}-\d{2}T/u);
    const timeline = page.getByLabel('对话记录', { exact: true });
    await timeline.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(answer.getByRole('heading', { name: '渲染验证' })).toBeVisible();
    await expect(answer.locator('strong')).toHaveText(['重点内容', '“test”确实出现过两次']);
    await expect(answer.locator('blockquote')).toContainText('引用内容');
    await expect(answer.getByRole('checkbox')).toHaveCount(2);
    expect(
      await answer.getByText('第一项', { exact: true }).evaluate((element) => {
        const item = element.closest('li');
        if (!item) throw new Error('Missing semantic list item');
        return getComputedStyle(item).listStyleType;
      }),
    ).toBe('disc');
    await expect(answer.locator('script, img, a[href^="javascript:"]')).toHaveCount(0);
    expect(await page.locator('html').getAttribute('data-markdown-executed')).toBeNull();
    expect(remoteImages).toEqual([]);
    await expect(answer.getByRole('link', { name: '文档链接', exact: true })).toHaveAttribute(
      'href',
      'https://example.com/guide',
    );
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: daemon.origin });
    await answer.getByRole('button', { name: '复制代码', exact: true }).click();
    expect(await page.evaluate(async () => await navigator.clipboard.readText())).toBe(
      'const answer = 42;\nconsole.log(answer);',
    );
    await page.getByRole('button', { name: '复制回答', exact: true }).click();
    expect(await page.evaluate(async () => await navigator.clipboard.readText())).toBe(
      PREFIX + SUFFIX,
    );
    await timeline.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: testInfo.outputPath('conversation-light.png'),
      animations: 'disabled',
    });
    await answer.locator('pre').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('conversation-code.png'),
      animations: 'disabled',
    });
    await timeline.evaluate((element) => {
      element.scrollTop = 0;
    });
    await openUserSettings(page);
    await page.getByRole('tab', { name: '通用设置', exact: true }).click();
    await page.getByRole('switch', { name: '深色模式', exact: true }).click();
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/u);
    await page.screenshot({
      path: testInfo.outputPath('conversation-dark.png'),
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 900, height: 760 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath('conversation-narrow.png'),
      animations: 'disabled',
    });
    await page.reload();
    await page.getByRole('button', { name: /^\*\*原始输入\*\* /u }).click();
    await expect(answer.locator('pre')).toContainText('console.log(answer);');
    await expect(answer.locator('strong')).toHaveText(['重点内容', '“test”确实出现过两次']);
    await expect(page.getByLabel('回答统计')).toContainText('用量 1.2K tok');
    await expect(conversationStats).toContainText('总对话 1 次');
    await timeline.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(answer.getByRole('heading', { name: '渲染验证' })).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(await page.locator('html').getAttribute('data-csp-violation')).toBeNull();
  } finally {
    await model.close();
  }
});

test('长回答更新不抢上滑阅读位置，回到最新后恢复底部跟随', async ({ page, daemon }) => {
  const prefix = Array.from(
    { length: 50 },
    (_, index) => `### 段落 ${index + 1}\n\n这是一段用于检查滚动位置的正文。\n`,
  ).join('\n');
  const model = await startMarkdownModel(prefix, '\n\n最终追加内容。');
  try {
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin);
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    await page.getByLabel('消息', { exact: true }).fill('长回答滚动验证');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('heading', { name: '段落 50', exact: true })).toBeVisible();
    const timeline = page.getByLabel('对话记录', { exact: true });
    await timeline.evaluate((element) => {
      element.scrollTop = 100;
    });
    await expect(page.getByRole('button', { name: '回到最新消息', exact: true })).toBeVisible();
    const top = await timeline.evaluate((element) => element.scrollTop);
    model.finish();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible();
    await expect
      .poll(async () => Math.abs((await timeline.evaluate((element) => element.scrollTop)) - top))
      .toBeLessThan(3);
    await page.getByRole('button', { name: '回到最新消息', exact: true }).click();
    await expect(page.getByText('最终追加内容。', { exact: true })).toBeVisible();
    await expect
      .poll(
        async () =>
          await timeline.evaluate(
            (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
          ),
      )
      .toBeLessThan(5);
  } finally {
    await model.close();
  }
});

test('高亮资源加载失败时保留可读代码和准确复制', async ({ page, daemon }) => {
  const model = await startMarkdownModel('```typescript\nconst fallback = 1;\n```', '');
  let failedLoads = 0;
  try {
    await page.route('**/assets/code-highlighter-*.js', async (route) => {
      failedLoads += 1;
      await route.abort('failed');
    });
    model.finish();
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin);
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    await page.getByLabel('消息', { exact: true }).fill('高亮失败验证');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const answer = page.getByRole('article', { name: 'Agent的消息', exact: true });
    await expect(answer.locator('pre')).toHaveText('const fallback = 1;');
    await expect.poll(() => failedLoads).toBeGreaterThan(0);
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: daemon.origin });
    await answer.getByRole('button', { name: '复制代码', exact: true }).click();
    expect(await page.evaluate(async () => await navigator.clipboard.readText())).toBe(
      'const fallback = 1;',
    );
  } finally {
    await model.close();
  }
});
