import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import {
  AgentTaskListSchema,
  AgentTaskDetailSchema,
  SessionSnapshotSchema,
  type SessionSnapshot,
} from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { test, expect } from './fixture.js';
import { configureTestProvider } from './model-fixtures.js';
import { startM5Model } from './m5-model-server.js';
import { chooseConversationModel, chooseOption, openUserSettings } from './ui-controls.js';

const CHILD_GET_POLICIES = [
  { mode: 'full-access', label: '完全访问权限', source: 'full-access', reviews: 0 },
  { mode: 'ask', label: '请求批准', source: 'user', reviews: 0 },
  { mode: 'auto', label: '帮我批准', source: 'ai', reviews: 1 },
] as const;

async function send(page: Page, text: string): Promise<string> {
  const created = page.waitForResponse((response) => {
    return (
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/sessions'
    );
  });
  await page.getByLabel('消息', { exact: true }).fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const response = await created;
  const snapshot: unknown = await response.json();
  if (!response.ok() || !Value.Check(SessionSnapshotSchema, snapshot))
    throw new Error('M5 conversation was not created');
  return snapshot.session.id;
}

async function session(page: Page, origin: string, id: string): Promise<SessionSnapshot> {
  const response = await page.request.get(`${origin}/api/sessions/${id}`);
  const value: unknown = await response.json();
  if (!response.ok() || !Value.Check(SessionSnapshotSchema, value))
    throw new Error('Invalid M5 session');
  return value;
}

for (const policy of CHILD_GET_POLICIES) {
  test(`M5 只读角色保留父会话 ${policy.mode} 审批策略，GET 能力与批准来源独立`, async ({
    page,
    daemon,
  }, testInfo) => {
    const model = await startM5Model({
      webFetchUrl: `${daemon.origin}/api/skill-gateway/fixture/read`,
    });
    try {
      await page.goto(daemon.origin);
      const gatewayWithoutToken = await page.request.get(
        `${daemon.origin}/api/skill-gateway/fixture/read`,
      );
      expect(gatewayWithoutToken.status()).toBe(403);
      await configureTestProvider(page, model.origin, 32768);
      await page.reload();
      await chooseConversationModel(page, 'Queue Model', 'Chat');
      await chooseOption(
        page,
        page.getByRole('combobox', { name: '执行批准方式', exact: true }),
        policy.label,
      );
      const id = await send(
        page,
        'M5-ROOT-SECRET [fetch]：请委派只读任务，通过 GET 核对受控资料。',
      );
      const entry = page.getByRole('button', { name: '打开会话任务', exact: true });
      const dialog = page.getByRole('dialog', { name: '会话任务', exact: true });
      if (policy.mode === 'ask') {
        await expect(entry).toContainText('待确认 1');
        await entry.click();
        await dialog.getByRole('button', { name: '允许本次操作', exact: true }).click();
        await page.keyboard.press('Escape');
      }
      await expect(
        page.getByText('M5 汇总完成：M5-CHILD-RESULT 已核对。', { exact: true }),
      ).toBeVisible();
      expect((await session(page, daemon.origin, id)).session.approvalMode).toBe(policy.mode);
      const listResponse = await page.request.get(`${daemon.origin}/api/sessions/${id}/agents`);
      const list: unknown = await listResponse.json();
      if (!listResponse.ok() || !Value.Check(AgentTaskListSchema, list) || list.tasks.length !== 1)
        throw new Error('Missing read-only GET task');
      const task = list.tasks[0];
      if (task === undefined) throw new Error('Missing read-only task summary');
      expect(task.role.access).toBe('read-only');
      const detailResponse = await page.request.get(
        `${daemon.origin}/api/sessions/${id}/agents/${task.id}`,
      );
      const detail: unknown = await detailResponse.json();
      if (!detailResponse.ok() || !Value.Check(AgentTaskDetailSchema, detail))
        throw new Error('Invalid child GET detail');
      const fetch = detail.tools.find((tool) => {
        return tool.name === 'web_fetch';
      });
      expect(fetch).toMatchObject({
        status: 'completed',
        arguments: { method: 'GET' },
        approval: { source: policy.source, decision: 'allow' },
      });
      expect(fetch?.result).toContain('HTTP 200');
      expect(fetch?.result).toContain('M5-READONLY-GET-OK');
      const reviews = model.requests.filter((request) => {
        return JSON.stringify(request.body['messages']).includes('authorizationContext');
      });
      expect(reviews).toHaveLength(policy.reviews);
      await entry.click();
      await expect(dialog.getByRole('button', { name: '允许本次操作', exact: true })).toHaveCount(
        0,
      );
      await expect(dialog).toContainText('M5-CHILD-RESULT');
      if (policy.mode === 'full-access') {
        const card = dialog.getByLabel('web_fetch 工具调用', { exact: true });
        await card.getByRole('button', { name: '展开 web_fetch 工具详情', exact: true }).click();
        await expect(card.getByLabel('审批记录', { exact: true })).toContainText('完全访问权限');
        await page.screenshot({ path: testInfo.outputPath('readonly-child-full-access-get.png') });
      }
    } finally {
      await daemon.stop();
      await model.close();
    }
  });
}

test('M5 真实委派隔离上下文，结果、任务树、看板和设置可在页面操作', async ({ page, daemon }) => {
  const model = await startM5Model();
  try {
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin, 32768);
    await page.reload();
    await chooseConversationModel(page, 'Queue Model', 'Chat');
    const id = await send(page, 'M5-ROOT-SECRET：请委派一个只读任务并汇总结果。');
    await expect(
      page.getByText('M5 汇总完成：M5-CHILD-RESULT 已核对。', { exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        return (await session(page, daemon.origin, id)).session.activeRunId;
      })
      .toBeNull();
    const snapshot = await session(page, daemon.origin, id);
    expect(snapshot.messages.some((message) => message.text.includes('M5-CHILD-ISOLATED'))).toBe(
      false,
    );
    const children = model.requests.filter((request) => {
      return (
        JSON.stringify(request.body['messages']).includes('M5-CHILD-ISOLATED') &&
        !JSON.stringify(request.body['messages']).includes('M5-ROOT-SECRET')
      );
    });
    expect(children).toHaveLength(1);
    await page.getByRole('button', { name: '打开会话任务', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '会话任务', exact: true });
    await expect(dialog).toContainText('独立核对');
    await expect(dialog).toContainText('M5-CHILD-ISOLATED');
    await expect(dialog).toContainText('M5-CHILD-RESULT');
    await expect(dialog).not.toContainText('M5-ROOT-SECRET');
    await expect(dialog.getByText('Token 预算', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('已记录 Token', { exact: true })).toBeVisible();
    await expect(dialog.getByText('1,100', { exact: true })).toBeVisible();
    await mkdir('output/playwright', { recursive: true });
    await page.screenshot({ path: 'output/playwright/m5-task-detail-light.png' });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: /^M5-ROOT-SECRET：请委派/ }).click();
    await page.getByRole('button', { name: '打开会话任务', exact: true }).click();
    await expect(dialog).toContainText('M5-CHILD-RESULT');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '任务看板', exact: true }).click();
    await expect(page.getByRole('region', { name: '任务看板', exact: true })).toContainText(
      '独立核对',
    );
    await openUserSettings(page);
    await page.getByRole('tab', { name: '子 Agent', exact: true }).click();
    await expect(page.getByLabel('允许 Agent 委派子任务', { exact: true })).toBeChecked();
    await expect(page.getByLabel('整树 Token 预算', { exact: true })).toHaveCount(0);
    await page.getByLabel('并发模型请求数', { exact: true }).fill('2');
    await page.getByLabel('单次请求输出上限', { exact: true }).fill('2048');
    const save = page.waitForResponse((response) => {
      return (
        new URL(response.url()).pathname === '/api/agent-settings' &&
        response.request().method() === 'PUT'
      );
    });
    await page.getByRole('button', { name: '保存子 Agent 设置', exact: true }).click();
    const saved = await save;
    expect(saved.ok()).toBe(true);
    const settings: unknown = saved.request().postDataJSON();
    expect(settings).toMatchObject({ limits: { maxConcurrentRequests: 2, maxOutputTokens: 2048 } });
    expect(settings).not.toHaveProperty('limits.tokenBudget');
    await page.getByRole('tab', { name: '通用设置', exact: true }).click();
    await page.getByLabel('深色模式', { exact: true }).click();
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.setViewportSize({ width: 600, height: 900 });
    await page.getByRole('button', { name: /独立核对/ }).click();
    await expect(dialog).toContainText('M5-CHILD-RESULT');
    await page.screenshot({ path: 'output/playwright/m5-task-detail-dark-narrow.png' });
  } finally {
    await daemon.stop();
    await model.close();
  }
});

test('M5 子任务提问可从待处理入口回答，关闭详情保留未提交草稿', async ({ page, daemon }) => {
  const model = await startM5Model();
  try {
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin, 32768);
    await page.reload();
    await chooseConversationModel(page, 'Queue Model', 'Chat');
    await send(page, 'M5-ROOT-SECRET [ask]：先让子任务向我确认资料。');
    const entry = page.getByRole('button', { name: '打开会话任务', exact: true });
    await expect(entry).toContainText('待确认 1');
    await entry.click();
    const dialog = page.getByRole('dialog', { name: '会话任务', exact: true });
    await expect(dialog).toContainText('是否已核对任务资料？');
    await dialog.getByRole('button', { name: /核对完成/ }).click();
    await dialog.getByRole('textbox', { name: '回答 Agent', exact: true }).fill('资料已检查');
    await page.keyboard.press('Escape');
    await expect(entry).toContainText('待确认 1');
    await entry.click();
    await expect(dialog.getByRole('button', { name: /核对完成/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(dialog.getByRole('textbox', { name: '回答 Agent', exact: true })).toHaveValue(
      '资料已检查',
    );
    await dialog.getByRole('button', { name: '提交回答', exact: true }).click();
    await expect(dialog).toContainText('M5-CHILD-RESULT');
    await page.keyboard.press('Escape');
    await expect(
      page.getByText('M5 汇总完成：M5-CHILD-RESULT 已核对。', { exact: true }),
    ).toBeVisible();
  } finally {
    await daemon.stop();
    await model.close();
  }
});

test('M5 子任务给父任务的通信进入真实上下文，但不显示成用户提问', async ({ page, daemon }) => {
  const model = await startM5Model();
  try {
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin, 32768);
    await page.reload();
    await chooseConversationModel(page, 'Queue Model', 'Chat');
    const id = await send(page, 'M5-ROOT-SECRET [mail]：让子任务给主任务发送进度后汇总。');
    await expect(
      page.getByText('M5 汇总完成：M5-CHILD-RESULT 已核对。', { exact: true }),
    ).toBeVisible();
    const raw = await session(page, daemon.origin, id);
    expect(
      raw.messages.some((message) => {
        return message.agentMessageId !== undefined && message.text === 'M5-AGENT-COMMUNICATION';
      }),
    ).toBe(true);
    await expect(page.getByRole('region', { name: '当前会话', exact: true })).not.toContainText(
      'M5-AGENT-COMMUNICATION',
    );
    await expect(page.getByRole('group', { name: '对话统计', exact: true })).toContainText(
      '总对话 1 次',
    );
    expect(
      model.requests.some((request) => {
        const context = JSON.stringify(request.body['messages']);
        return context.includes('M5-ROOT-SECRET') && context.includes('M5-AGENT-COMMUNICATION');
      }),
    ).toBe(true);
  } finally {
    await daemon.stop();
    await model.close();
  }
});

test('M5 从子任务详情停止实际模型流，父任务收到取消结果并结算', async ({ page, daemon }) => {
  const model = await startM5Model();
  try {
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin, 32768);
    await page.reload();
    await chooseConversationModel(page, 'Queue Model', 'Chat');
    const id = await send(page, 'M5-ROOT-SECRET [hold]：启动一个可停止的子任务。');
    await page.getByRole('button', { name: '打开会话任务', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '会话任务', exact: true });
    await expect(dialog.getByRole('button', { name: '停止此任务', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '停止此任务', exact: true }).click();
    await expect(dialog).toContainText('已停止');
    await page.keyboard.press('Escape');
    await expect
      .poll(async () => {
        return (await session(page, daemon.origin, id)).session.activeRunId;
      })
      .toBeNull();
    const response = await page.request.get(`${daemon.origin}/api/sessions/${id}/agents`);
    const tasks: unknown = await response.json();
    if (!response.ok() || !Value.Check(AgentTaskListSchema, tasks))
      throw new Error('Invalid task list');
    expect(tasks.tasks).toHaveLength(1);
    expect(tasks.tasks[0]?.status).toBe('cancelled');
    expect(tasks.tasks[0]?.closedAt).not.toBeNull();
  } finally {
    await daemon.stop();
    await model.close();
  }
});

test('M5 子任务补充响应丢失后，关闭详情与任务结算不会改变重试请求身份', async ({
  page,
  daemon,
}) => {
  const model = await startM5Model();
  const attempts: unknown[] = [];
  let acceptedTask: string | undefined;
  try {
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin, 32768);
    await page.reload();
    await chooseConversationModel(page, 'Queue Model', 'Chat');
    const id = await send(page, 'M5-ROOT-SECRET [ask]：等待我确认后核对资料。');
    const entry = page.getByRole('button', { name: '打开会话任务', exact: true });
    await expect(entry).toContainText('待确认 1');
    await entry.click();
    const dialog = page.getByRole('dialog', { name: '会话任务', exact: true });
    const draft = dialog.getByRole('textbox', { name: '补充任务说明', exact: true });
    await draft.fill('M5 original supplemental instruction');
    await page.route('**/api/sessions/*/agents/*/messages', async (route) => {
      const input: unknown = JSON.parse(route.request().postData() ?? 'null');
      attempts.push(input);
      if (attempts.length === 1) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const detail: unknown = await response.json();
        if (!Value.Check(AgentTaskDetailSchema, detail))
          throw new Error('Missing accepted task input');
        acceptedTask = detail.task.id;
        await route.abort('connectionreset');
        return;
      }
      await route.continue();
    });
    await dialog.getByRole('button', { name: '发送补充', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '重试确认', exact: true })).toBeVisible();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      text: 'M5 original supplemental instruction',
      continue: false,
    });
    await expect(draft).toBeDisabled();
    await page.keyboard.press('Escape');
    await entry.click();
    await expect(draft).toHaveValue('M5 original supplemental instruction');
    await expect(draft).toBeDisabled();
    await dialog.getByRole('button', { name: /核对完成/ }).click();
    await dialog.getByRole('button', { name: '提交回答', exact: true }).click();
    await expect(dialog).toContainText('M5-CHILD-RESULT');
    await page.keyboard.press('Escape');
    await expect(
      page.getByText('M5 汇总完成：M5-CHILD-RESULT 已核对。', { exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        return (await session(page, daemon.origin, id)).session.activeRunId;
      })
      .toBeNull();
    await entry.click();
    const retry = dialog.getByRole('button', { name: '重试确认', exact: true });
    await expect(retry).toBeVisible();
    expect(attempts).toHaveLength(1);
    const confirmed = page.waitForResponse((response) => {
      return (
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/messages')
      );
    });
    await retry.click();
    expect((await confirmed).ok()).toBe(true);
    await expect(retry).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    if (acceptedTask === undefined) throw new Error('Task input was not accepted');
    const response = await page.request.get(
      `${daemon.origin}/api/sessions/${id}/agents/${acceptedTask}`,
    );
    const detail: unknown = await response.json();
    if (!response.ok() || !Value.Check(AgentTaskDetailSchema, detail))
      throw new Error('Missing confirmed task detail');
    expect(detail.runs).toHaveLength(1);
    expect(
      detail.messages.filter((message) => {
        return message.text === 'M5 original supplemental instruction';
      }),
    ).toHaveLength(1);
    expect(detail.task.closedAt).not.toBeNull();
  } finally {
    await daemon.stop();
    await model.close();
  }
});
