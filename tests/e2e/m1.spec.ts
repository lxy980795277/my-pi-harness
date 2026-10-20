import { test, expect } from './fixture.js';
import { startTestModel } from './model-server.js';
import { configureTestProvider } from './model-fixtures.js';
import { chooseOption, openUserSettings } from './ui-controls.js';
import { AuthStatusSchema, SessionSnapshotSchema } from '@my-pi-harness/protocol';
import { selectTestSessionBranch } from './session-fixtures.js';
import { Value } from 'typebox/value';

test('配置兼容 API、真实 Pi 流式请求、刷新与编辑分支', async ({ page, daemon }, testInfo) => {
  const model = await startTestModel();
  try {
    await page.goto(daemon.origin);
    await openUserSettings(page);
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await settings.getByRole('tab', { name: '模型', exact: true }).click();
    await page.getByRole('button', { name: '添加 Provider', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '添加 Provider', exact: true });
    await editor.getByLabel('名称', { exact: true }).fill('本机测试模型');
    await chooseOption(
      page,
      editor.getByRole('combobox', { name: '协议', exact: true }),
      'OpenAI Chat Completions',
    );
    await editor.getByLabel('Base URL', { exact: true }).fill(`${model.origin}/v1`);
    await editor.getByLabel('API Key', { exact: true }).fill('synthetic-account-key');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    const provider = settings.getByRole('region', { name: '本机测试模型', exact: true });
    await expect(provider).toBeVisible();
    await provider.getByRole('button', { name: '配置', exact: true }).click();
    const savedEditor = page.getByRole('dialog', { name: '配置 本机测试模型', exact: true });
    await expect(savedEditor.getByLabel('API Key', { exact: true })).toHaveCount(0);
    await savedEditor.getByRole('button', { name: '移除凭据', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: '移除凭据', exact: true })
      .getByRole('button', { name: '确认移除', exact: true })
      .click();
    await savedEditor.getByLabel('API Key', { exact: true }).fill('synthetic-account-key');
    await savedEditor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(savedEditor).not.toBeVisible();
    await expect(provider.getByText('尚未添加模型', { exact: true })).toBeVisible();
    await provider.getByRole('button', { name: '模型', exact: true }).click();
    const models = page.getByRole('dialog', { name: '本机测试模型 模型', exact: true });
    await models.getByLabel('新增模型 ID', { exact: true }).fill('chat-model');
    await models.getByRole('button', { name: '添加', exact: true }).click();
    await expect(
      models.getByRole('button', { name: '测试 chat-model 连接', exact: true }),
    ).toBeDisabled();
    await models.getByLabel('上下文长度', { exact: true }).fill('8192');
    await models.getByLabel('最大输出 Token', { exact: true }).fill('1024');
    await models.getByRole('button', { name: '保存', exact: true }).click();
    await provider.getByRole('button', { name: '模型', exact: true }).click();
    await models.getByRole('button', { name: '测试 chat-model 连接', exact: true }).click();
    await expect(models.getByText('The model returned a response.', { exact: true })).toBeVisible();
    await models.getByRole('button', { name: '关闭', exact: true }).click();
    await chooseOption(
      page,
      settings.getByRole('combobox', { name: '默认模型', exact: true }),
      '本机测试模型 · chat-model',
    );
    await expect(settings.getByRole('combobox', { name: '默认模型', exact: true })).toContainText(
      'chat-model',
    );
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    const createdSession = page.waitForResponse((response) => {
      return (
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/sessions'
      );
    });
    await page.getByLabel('消息', { exact: true }).fill('你好，流式测试');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const original: unknown = await (await createdSession).json();
    if (!Value.Check(SessionSnapshotSchema, original)) throw new Error('Invalid created session');
    await expect(page.getByText('响应：你好，流式测试', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: /^你好，流式测试 / }).click();
    await expect(page.getByText('响应：你好，流式测试', { exact: true })).toBeVisible();
    await page.getByRole('article', { name: '你的消息', exact: true }).hover();
    await page.getByRole('button', { name: '编辑并在新分支重发', exact: true }).click();
    await page.getByLabel('编辑消息', { exact: true }).fill('新的分支输入');
    await page.getByRole('button', { name: '创建分支并重发', exact: true }).click();
    await expect(page.getByText('响应：新的分支输入', { exact: true })).toBeVisible();
    await expect(page.getByText('响应：你好，流式测试', { exact: true })).not.toBeVisible();
    await expect(page.getByLabel('历史分支', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/会话与模型设置/u)).toHaveCount(0);
    const restored = await selectTestSessionBranch(
      page,
      original.session.id,
      original.session.activeBranchId,
    );
    expect(restored.branches).toHaveLength(2);
    await expect(page.getByText('响应：你好，流式测试', { exact: true })).toBeVisible();
    expect(
      model.requests.every(
        ({ path, authorization, body }) =>
          path === '/v1/chat/completions' &&
          authorization === 'Bearer synthetic-account-key' &&
          body['model'] === 'chat-model',
      ),
    ).toBe(true);
    const last = model.requests.at(-1)?.body['messages'];
    expect(JSON.stringify(last)).toContain('新的分支输入');
    expect(JSON.stringify(last)).not.toContain('你好，流式测试');
    await page.screenshot({ path: testInfo.outputPath('m1-chat.png'), fullPage: true });
  } finally {
    await model.close();
  }
});

test('新对话与已有对话回车发送，换行和输入法确认不误发', async ({ page, daemon }) => {
  const model = await startTestModel();
  const inputRequests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && /^\/api\/sessions(?:$|\/[^/]+\/inputs$)/u.test(path)) {
      inputRequests.push(path);
    }
  });
  try {
    await page.goto(daemon.origin);
    const draft = page.getByLabel('消息', { exact: true });
    const send = page.getByRole('button', { name: '发送', exact: true });
    await draft.fill('尚未选择模型');
    await expect(send).toBeDisabled();
    await draft.press('Enter');
    await expect(draft).toHaveValue('尚未选择模型');
    expect(inputRequests).toHaveLength(0);
    await configureTestProvider(page, model.origin);
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    await draft.fill('   ');
    await expect(send).toBeDisabled();
    await draft.press('Enter');
    await expect(draft).toHaveValue('   ');
    expect(inputRequests).toHaveLength(0);

    for (const context of ['新对话', '已有对话']) {
      const before = inputRequests.length;
      let text = `${context}第一行`;
      await draft.fill(text);
      await draft.press('Shift+Enter');
      await page.keyboard.insertText('下一行');
      text += '\n下一行';
      await expect(draft).toHaveValue(text);
      expect(inputRequests).toHaveLength(before);
      await draft.dispatchEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        isComposing: true,
      });
      await expect(draft).toHaveValue(text);
      expect(inputRequests).toHaveLength(before);
      await draft.dispatchEvent('compositionstart', { data: '拼音' });
      await draft.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: false });
      await draft.evaluate((element): void => {
        element.dispatchEvent(
          new CompositionEvent('compositionend', { bubbles: true, data: '输入' }),
        );
        element.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }),
        );
        element.dispatchEvent(
          new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }),
        );
      });
      await expect(draft).toHaveValue(text);
      expect(inputRequests).toHaveLength(before);
      await draft.press('Enter');
      await expect(page.getByText(`响应：${text}`, { exact: true })).toBeVisible();
      await expect(draft).toHaveValue('');
      await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
    }

    for (const shortcut of ['Control+Enter', 'Meta+Enter']) {
      const text = `${shortcut}兼容发送`;
      await draft.fill(text);
      await draft.press(shortcut);
      await expect(page.getByText(`响应：${text}`, { exact: true })).toBeVisible();
      await expect(draft).toHaveValue('');
      await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
    }
    expect(inputRequests.filter((path) => path === '/api/sessions')).toHaveLength(1);
    expect(inputRequests.filter((path) => path.endsWith('/inputs'))).toHaveLength(4);
    expect(model.requests).toHaveLength(4);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await model.close();
  }
});

test('停止保留队列，编辑后显式恢复；引导继续同一个 Run', async ({ page, daemon }) => {
  const model = await startTestModel();
  try {
    await page.goto(daemon.origin);
    const provider = await configureTestProvider(page, model.origin);
    const statusResponse = await page.request.get(`${daemon.origin}/api/auth/status`);
    const status: unknown = await statusResponse.json();
    if (!Value.Check(AuthStatusSchema, status) || !status.csrfToken)
      throw new Error('Fixture authorization failed');
    const created = await page.request.post(`${daemon.origin}/api/sessions`, {
      headers: { Origin: daemon.origin, 'X-CSRF-Token': status.csrfToken },
      data: {
        title: '队列验收',
        providerId: provider.id,
        modelId: 'chat-model',
        thinkingLevel: 'off',
      },
    });
    expect(created.ok()).toBe(true);
    const session: unknown = await created.json();
    if (!Value.Check(SessionSnapshotSchema, session))
      throw new Error('Creating the queue fixture session failed');
    await page.reload();
    await page.getByRole('button', { name: /^队列验收 / }).click();
    await page.getByLabel('消息', { exact: true }).fill('慢速测试');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
    const conversationStatistics = page.getByRole('group', { name: '对话统计', exact: true });
    await expect(conversationStatistics).toBeVisible();
    await expect(conversationStatistics).toContainText('总对话 1 次');
    await page.getByLabel('消息', { exact: true }).fill('待修改输入');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByText('待执行输入 · 1', { exact: true })).toBeVisible();
    await expect(conversationStatistics).toContainText('总对话 1 次');
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await page.getByText('待执行输入 · 1', { exact: true }).click();
    await expect(page.getByRole('button', { name: '继续执行队列', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('排队消息内容', { exact: true }).fill('修改后继续');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.getByRole('button', { name: '继续执行队列', exact: true }).click();
    await expect(page.getByText('响应：修改后继续', { exact: true })).toBeVisible();
    await expect(conversationStatistics).toContainText('总对话 2 次');
    await page.getByLabel('消息', { exact: true }).fill('慢速引导测试');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
    await expect(conversationStatistics).toContainText('总对话 3 次');
    const running: unknown = await (
      await page.request.get(`${daemon.origin}/api/sessions/${session.session.id}`)
    ).json();
    if (!Value.Check(SessionSnapshotSchema, running))
      throw new Error('The active queue fixture session could not be read');
    const runBefore = running.session.activeRunId;
    expect(runBefore).not.toBeNull();
    const steered = await page.request.post(
      `${daemon.origin}/api/sessions/${session.session.id}/inputs`,
      {
        headers: { Origin: daemon.origin, 'X-CSRF-Token': status.csrfToken },
        data: {
          text: '引导后的输入',
          mode: 'steer',
          requestId: 'queue-fixture-steer',
        },
      },
    );
    expect(steered.ok()).toBe(true);
    await expect(page.getByText('响应：引导后的输入', { exact: true })).toBeVisible();
    const completed: unknown = await (
      await page.request.get(`${daemon.origin}/api/sessions/${session.session.id}`)
    ).json();
    if (!Value.Check(SessionSnapshotSchema, completed))
      throw new Error('The completed queue fixture session could not be read');
    expect(completed.runs.at(-1)?.id).toBe(runBefore);
    expect(completed.messages.filter((message) => message.role === 'user')).toHaveLength(4);
    await expect(conversationStatistics).toContainText('总对话 4 次');
  } finally {
    await model.close();
  }
});
