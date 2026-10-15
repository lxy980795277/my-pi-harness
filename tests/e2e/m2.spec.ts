import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixture.js';
import { configureTestProvider } from './model-fixtures.js';
import { chooseOption } from './ui-controls.js';
import { startToolModel } from './tool-model-server.js';
import { registerTestWorkspace } from './workspace-fixtures.js';

for (const policy of ['请求批准', '只读'] as const) {
  test(`工作区树、首次发送与真实工具循环：${policy}`, async ({ page, daemon }, testInfo) => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-m2-browser-'));
    const model = await startToolModel();
    try {
      await page.goto(daemon.origin);
      await configureTestProvider(page, model.origin);
      await page.reload();
      await expect(
        page.getByRole('heading', { name: '我们从哪里开始？', exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel('会话名称', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '创建会话', exact: true })).toHaveCount(0);
      await registerTestWorkspace(page, '测试项目', directory);
      await page.reload();
      await chooseOption(
        page,
        page.getByRole('combobox', { name: '选择工作区', exact: true }),
        '测试项目',
      );
      await chooseOption(
        page,
        page.getByRole('combobox', { name: '对话模型', exact: true }),
        'Queue Model · Chat',
      );
      if (policy === '只读')
        await chooseOption(
          page,
          page.getByRole('combobox', { name: '执行批准方式', exact: true }),
          policy,
        );
      await page.screenshot({ path: testInfo.outputPath('new-conversation.png'), fullPage: true });
      await page.getByLabel('消息', { exact: true }).fill('创建工作区文件');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      if (policy === '请求批准') {
        await expect(page.getByRole('button', { name: '允许本次操作', exact: true })).toBeVisible();
        await expect(readFile(join(directory, 'created.txt'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
        await page.getByRole('button', { name: '允许本次操作', exact: true }).click();
      }
      await expect(page.getByText('已收到工具执行结果。', { exact: true })).toBeVisible();
      const group = page.getByRole('group', { name: '测试项目', exact: true });
      await expect(group.getByRole('button', { name: /^创建工作区文件 / })).toBeVisible();
      expect(model.requests).toHaveLength(2);
      expect(JSON.stringify(model.requests[1]?.body['messages'])).toContain('tool_call_id');
      if (policy === '请求批准') {
        expect(await readFile(join(directory, 'created.txt'), 'utf8')).toBe(
          'Workspace tool result\n',
        );
        await page.getByText('文件差异', { exact: true }).click();
        await expect(
          page.getByText('+Workspace tool result', { exact: false }).first(),
        ).toBeVisible();
        const toolCard = page.getByLabel('write_file 工具调用', { exact: true });
        const answer = page.getByRole('article', { name: 'Agent的消息', exact: true }).last();
        await expect
          .poll(async () => {
            const toolBounds = await toolCard.boundingBox();
            const answerBounds = await answer.boundingBox();
            if (!toolBounds || !answerBounds) return false;
            return answerBounds.y >= toolBounds.y + toolBounds.height;
          })
          .toBe(true);
      } else {
        await expect(page.getByText('已拒绝', { exact: true })).toBeVisible();
        await expect(readFile(join(directory, 'created.txt'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      }
      await expect(page.getByRole('alert')).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath('tool-conversation.png'), fullPage: true });
      await page.reload();
      await page.getByRole('button', { name: /^创建工作区文件 / }).click();
      await expect(page.getByText('已收到工具执行结果。', { exact: true })).toBeVisible();
      await expect(page.getByText('write_file', { exact: true })).toBeVisible();
      expect(model.requests).toHaveLength(2);
    } finally {
      await model.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('响应丢失和跨页后确认原请求，不重复计费或复活旧首发', async ({ page, daemon }) => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-m2-retry-'));
  const model = await startToolModel();
  try {
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin);
    await page.reload();
    await registerTestWorkspace(page, '恢复项目', directory);
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '选择工作区', exact: true }),
      '恢复项目',
    );
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    let lostResponse = false;
    await page.route('**/api/sessions/*/inputs', async (route) => {
      if (!lostResponse) {
        lostResponse = true;
        await route.fetch();
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await page.getByLabel('消息', { exact: true }).fill('保持原请求');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('button', { name: /^保持原请求 / })).toBeVisible();
    await page.getByRole('button', { name: '运行状态', exact: true }).click();
    await page.getByRole('button', { name: /^保持原请求 / }).click();
    await expect(page.getByRole('button', { name: '允许本次操作', exact: true })).toBeVisible();
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('保持原请求');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('');
    expect(model.requests).toHaveLength(1);
    await page.getByRole('button', { name: '允许本次操作', exact: true }).click();
    await expect(page.getByText('已收到工具执行结果。', { exact: true })).toBeVisible();
    expect(model.requests).toHaveLength(2);
    await page.getByRole('button', { name: '删除会话', exact: true }).click();
    await page.getByRole('button', { name: '确认删除会话', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '我们从哪里开始？', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('');
    expect(model.requests).toHaveLength(2);
  } finally {
    await model.close();
    await rm(directory, { recursive: true, force: true });
  }
});
