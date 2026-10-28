import { test, expect } from './fixture.js';
import { startToolSequenceModel } from './m2-completion-model.js';
import { configureTestProvider } from './model-fixtures.js';
import { chooseOption } from './ui-controls.js';

test('回答结束后收起完整过程，展开保留阅读位置、最终思考与内部工具选择', async ({
  page,
  daemon,
}, testInfo) => {
  const final = '正式回答：所有核对已完成，结果保留在过程区域外。';
  const finalThinking = '这是最终正文之前的最后一次思考。';
  const steps = Array.from({ length: 3 }, (_, index) => ({
    name: 'search_session_history',
    arguments: { query: `process-${index + 1}` },
    thinking: `第${index + 1}步思考，核对已有信息。`,
    content: Array.from({ length: 5 }, (_, paragraph) => {
      return `第${index + 1}步过程说明，第${paragraph + 1}段。${'这段内容属于中间说明。'.repeat(16)}`;
    }).join('\n\n'),
  }));
  const model = await startToolSequenceModel(steps, final, {
    finalThinking,
    pauseBeforeFinish: true,
  });
  try {
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin, 32768);
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    await page.getByLabel('消息', { exact: true }).fill('验证完整回答过程');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByText(final, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '展开回答过程', exact: true })).toHaveCount(0);
    await expect(
      page.getByLabel('search_session_history 工具调用', { exact: true }).last(),
    ).toBeVisible();
    const timeline = page.getByLabel('对话记录', { exact: true });
    await timeline.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    model.finish();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeHidden();
    const process = page.getByLabel('回答过程', { exact: true });
    const toggle = process.getByRole('button', { name: /^(?:展开|收起)回答过程$/u });
    await expect(toggle).toHaveAccessibleName('展开回答过程');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText(/^已处理\s*\d/u);
    await expect(page.getByRole('region', { name: '回答过程详情', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('search_session_history 工具调用', { exact: true })).toHaveCount(
      0,
    );
    const answer = page.getByRole('article', { name: 'Agent的消息', exact: true });
    await expect(answer).toHaveCount(1);
    await expect(answer).toContainText(final);
    await expect(answer.getByLabel('思考内容', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('回答操作', { exact: true })).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('process-collapsed.png') });
    const before = await toggle.boundingBox();
    if (before === null) throw new Error('Process summary is not visible');
    await toggle.click();
    const details = page.getByRole('region', { name: '回答过程详情', exact: true });
    await expect(details).toBeVisible();
    await expect
      .poll(async () => {
        const after = await toggle.boundingBox();
        if (after === null) return Infinity;
        return Math.abs(after.y - before.y);
      })
      .toBeLessThanOrEqual(2);
    await expect(details.getByLabel('思考内容', { exact: true })).toHaveCount(4);
    await expect(
      details.getByLabel('search_session_history 工具调用', { exact: true }),
    ).toHaveCount(3);
    await expect(details.getByText(finalThinking, { exact: true }).first()).toBeVisible();
    await expect(details.getByText(final, { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('process-expanded.png') });
    const firstTool = details
      .getByLabel('search_session_history 工具调用', { exact: true })
      .first();
    await firstTool
      .getByRole('button', { name: '展开 search_session_history 工具详情', exact: true })
      .click();
    await expect(firstTool.getByRole('region', { name: '调用参数', exact: true })).toBeVisible();
    const expandedHeight = await timeline.evaluate((element) => element.scrollHeight);
    await toggle.click();
    await expect(details).toHaveCount(0);
    await expect
      .poll(async () => await timeline.evaluate((element) => element.scrollHeight))
      .toBeLessThan(expandedHeight - 200);
    await toggle.focus();
    await toggle.press('Enter');
    await expect(
      firstTool.getByRole('button', { name: '收起 search_session_history 工具详情', exact: true }),
    ).toHaveAttribute('aria-expanded', 'true');
    await toggle.focus();
    await toggle.press('Space');
    await expect(details).toHaveCount(0);
    expect(model.requests).toHaveLength(4);
    await page.reload();
    await page.getByRole('button', { name: /^验证完整回答过程 /u }).click();
    await expect(page.getByRole('button', { name: '展开回答过程', exact: true })).toBeVisible();
    await expect(page.getByText(final, { exact: true })).toBeVisible();
    await expect(details).toHaveCount(0);
    expect(model.requests).toHaveLength(4);
  } finally {
    await model.close();
  }
});

test('停止后的部分回答与工具保持可见，不生成成功过程摘要', async ({ page, daemon }) => {
  const partial = '这段正文尚未完成，停止后仍应保留。';
  const model = await startToolSequenceModel(
    [
      {
        name: 'search_session_history',
        arguments: { query: 'process-stop' },
        content: '已完成的检查步骤。',
        thinking: '中间思考。',
      },
    ],
    partial,
    { finalThinking: '最后一步仍在思考。', pauseBeforeFinish: true },
  );
  try {
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin);
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    await page.getByLabel('消息', { exact: true }).fill('验证停止保留过程');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByText(partial, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '展开回答过程', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('search_session_history 工具调用', { exact: true })).toBeVisible();
    await expect(page.getByText('已完成的检查步骤。', { exact: true })).toBeVisible();
    await expect(page.getByText(partial, { exact: true })).toBeVisible();
    expect(model.requests).toHaveLength(2);
  } finally {
    await model.close();
  }
});

test('阅读最终正文时自动收起上方过程，保留当前阅读段落位置', async ({ page, daemon }) => {
  const paragraphs = Array.from({ length: 36 }, (_, index) => {
    return `阅读锚点第${index + 1}段。${'最终正文应保持当前阅读位置。'.repeat(10)}`;
  });
  const lastParagraph = paragraphs.at(-1);
  const readingParagraph = paragraphs[11];
  if (lastParagraph === undefined || readingParagraph === undefined)
    throw new Error('Reading fixture paragraphs are missing');
  const model = await startToolSequenceModel(
    [
      {
        name: 'search_session_history',
        arguments: { query: 'anchor-one' },
        content: '第一步中间说明。'.repeat(80),
      },
      {
        name: 'search_session_history',
        arguments: { query: 'anchor-two' },
        content: '第二步中间说明。'.repeat(80),
      },
    ],
    paragraphs.join('\n\n'),
    { finalThinking: '最终正文开始前的思考也将收进过程。', pauseBeforeFinish: true },
  );
  try {
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin, 32768);
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    await page.getByLabel('消息', { exact: true }).fill('验证自动折叠阅读位置');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByText(lastParagraph, { exact: true })).toBeVisible();
    const target = page.getByText(readingParagraph, { exact: true });
    await target.scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: '回到最新消息', exact: true })).toBeVisible();
    const before = await target.boundingBox();
    if (before === null) throw new Error('Reading target is not mounted');
    model.finish();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: '展开回答过程', exact: true })).toHaveCount(1);
    await expect
      .poll(async () => {
        const after = await target.boundingBox();
        if (after === null) return Infinity;
        return Math.abs(after.y - before.y);
      })
      .toBeLessThanOrEqual(2);
    await expect(target).toBeInViewport();
    expect(model.requests).toHaveLength(3);
  } finally {
    await model.close();
  }
});
