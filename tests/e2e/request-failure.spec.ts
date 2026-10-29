import { test, expect } from './fixture.js';
import { configureTestProvider } from './model-fixtures.js';
import { startFailureModel } from './request-failure-model.js';
import { chooseConversationModel } from './ui-controls.js';

test('请求错误显示在各自回答位置，保留部分正文及后续成功后的历史原因', async ({
  page,
  daemon,
}, testInfo) => {
  const model = await startFailureModel();
  try {
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin);
    await page.reload();
    await chooseConversationModel(page, 'Queue Model', 'Chat');
    const composer = page.getByLabel('消息', { exact: true });
    const send = page.getByRole('button', { name: '发送', exact: true });
    const answers = page.getByRole('article', { name: 'Agent的消息', exact: true });
    await composer.fill('首个请求认证失败');
    await send.click();
    await expect(answers).toHaveCount(1);
    await expect(answers.nth(0).getByRole('status')).toHaveText(
      '模型服务认证失败，请检查 API Key 或授权状态。',
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(send).toBeVisible();
    await composer.fill('第二个请求保留部分正文');
    await send.click();
    await expect(answers.nth(1)).toContainText('已经生成的部分正文。');
    model.failPartial();
    await expect(send).toBeVisible();
    await expect(answers.nth(1).getByRole('status')).toHaveText(
      /模型请求失败，请稍后重试。|无法连接模型服务，请检查网络后重试。/u,
    );
    await expect(answers.nth(1)).toContainText('已经生成的部分正文。');
    await expect(answers.nth(0).getByRole('status')).toHaveText(
      '模型服务认证失败，请检查 API Key 或授权状态。',
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
    await composer.fill('第三个请求成功');
    await send.click();
    await expect(answers.nth(2)).toContainText('后续请求成功，旧请求错误仍保留。');
    await expect(send).toBeVisible();
    await expect(answers.nth(0).getByRole('status')).toHaveText(
      '模型服务认证失败，请检查 API Key 或授权状态。',
    );
    await expect(answers.nth(1)).toContainText('已经生成的部分正文。');
    await expect(answers.nth(1).getByRole('status')).not.toHaveText('失败');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('request-errors-beside-answers.png'),
      animations: 'disabled',
    });
    await page.reload();
    await page.getByRole('button', { name: /^首个请求认证失败 /u }).click();
    await expect(page.getByText('后续请求成功，旧请求错误仍保留。', { exact: true })).toBeVisible();
    const timeline = page.getByLabel('对话记录', { exact: true });
    expect(
      await timeline.evaluate((element) => {
        return element.scrollTop;
      }),
    ).toBe(0);
    await expect(timeline.locator('[data-index="0"]')).toBeVisible();
    await expect(
      answers.filter({ hasText: '模型服务认证失败，请检查 API Key 或授权状态。' }),
    ).toHaveCount(1);
    const partialAnswer = answers.filter({ hasText: '已经生成的部分正文。' });
    await expect(partialAnswer).toBeVisible();
    await expect(partialAnswer.getByRole('status')).toHaveText(
      /模型请求失败，请稍后重试。|无法连接模型服务，请检查网络后重试。/u,
    );
    await expect(answers.filter({ hasText: '后续请求成功，旧请求错误仍保留。' })).toHaveCount(1);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('request-errors-after-reload.png'),
      animations: 'disabled',
    });
  } finally {
    await model.close();
  }
});
