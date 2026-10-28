import type { Page } from '@playwright/test';
import {
  AuthStatusSchema,
  ProviderConfigSchema,
  SessionSnapshotSchema,
  WorkSnapshotSchema,
  type ProviderConfig,
  type SessionSnapshot,
} from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { test, expect } from './fixture.js';
import { configureTestProvider } from './model-fixtures.js';
import { startTestModel } from './model-server.js';
import { chooseConversationModel, chooseOption } from './ui-controls.js';

const headersFor = async (page: Page): Promise<Record<string, string>> => {
  const origin = new URL(page.url()).origin;
  const response = await page.request.get(`${origin}/api/auth/status`);
  const status: unknown = await response.json();
  if (!response.ok() || !Value.Check(AuthStatusSchema, status) || status.csrfToken === null)
    throw new Error('Composer fixtures require authenticated access');
  return { Origin: origin, 'X-CSRF-Token': status.csrfToken };
};

const configureReasoningModels = async (
  page: Page,
  modelOrigin: string,
): Promise<ProviderConfig> => {
  const configured = await configureTestProvider(page, modelOrigin);
  const origin = new URL(page.url()).origin;
  const response = await page.request.get(`${origin}/api/providers/${configured.id}`);
  const current: unknown = await response.json();
  if (!response.ok() || !Value.Check(ProviderConfigSchema, current))
    throw new Error('Composer provider fixture could not be read');
  const base = current.models[0];
  if (base === undefined) throw new Error('Composer fixture requires its base model');
  const saved = await page.request.put(`${origin}/api/providers/${current.id}`, {
    headers: await headersFor(page),
    data: {
      id: current.id,
      name: current.name,
      kind: current.kind,
      builtinId: current.builtinId,
      api: current.api,
      baseUrl: current.baseUrl,
      enabled: current.enabled,
      requiresApiKey: current.requiresApiKey,
      expectedRevision: current.revision,
      models: [
        base,
        { ...base, id: 'reasoning-a', name: 'Reasoning A', reasoning: true },
        { ...base, id: 'reasoning-b', name: 'Reasoning B', reasoning: true },
      ],
    },
  });
  const provider: unknown = await saved.json();
  if (!saved.ok() || !Value.Check(ProviderConfigSchema, provider))
    throw new Error('Composer reasoning models could not be configured');
  return provider;
};

const readSession = async (page: Page, origin: string, id: string): Promise<SessionSnapshot> => {
  const response = await page.request.get(`${origin}/api/sessions/${id}`);
  const snapshot: unknown = await response.json();
  if (!response.ok() || !Value.Check(SessionSnapshotSchema, snapshot))
    throw new Error('Composer session snapshot is invalid');
  return snapshot;
};

test('模型菜单顶部共享推理入口，切换能力与已有会话保存正确且审批独立', async ({
  page,
  daemon,
}, testInfo) => {
  const model = await startTestModel();
  const policyErrors: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) policyErrors.push(message.text());
  });
  try {
    await page.goto(daemon.origin);
    const provider = await configureReasoningModels(page, model.origin);
    await page.reload();
    await expect(page.getByRole('combobox', { name: '输入栏工作模式', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('combobox', { name: '思考等级', exact: true })).toHaveCount(0);
    await chooseConversationModel(page, provider.name, 'Reasoning A');
    const trigger = page.getByRole('button', { name: '对话模型', exact: true });
    await trigger.click();
    const mainMenu = page.getByRole('menu', { name: '模型与推理设置', exact: true });
    await expect(mainMenu.getByRole('menuitem').first()).toHaveAccessibleName('推理强度');
    const reasoning = page.getByRole('menuitem', { name: '推理强度', exact: true });
    await expect(reasoning).toHaveCount(1);
    await reasoning.hover();
    const high = page.getByRole('menuitemradio', { name: '高', exact: true });
    await expect(high).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('composer-model-menu-light.png') });
    await high.click();
    await expect(trigger).toContainText('高');

    await page.getByRole('button', { name: '切换到深色主题', exact: true }).click();
    await expect(page.getByRole('button', { name: '切换到浅色主题', exact: true })).toBeVisible();
    await trigger.click();
    await reasoning.hover();
    await expect(high).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('composer-model-menu-dark.png') });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 640, height: 800 });
    await trigger.click();
    await reasoning.hover();
    await expect(high).toBeVisible();
    await expect
      .poll(async () => {
        return page.getByRole('menu').evaluateAll((elements) => {
          return elements.every((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.left >= 0 && bounds.right <= window.innerWidth;
          });
        });
      })
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath('composer-model-menu-narrow.png') });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: '切换到浅色主题', exact: true }).click();

    await chooseConversationModel(page, provider.name, 'Reasoning B');
    await trigger.click();
    await expect(reasoning).toHaveCount(1);
    await reasoning.hover();
    await high.click();
    await expect(trigger).toContainText('Reasoning B');
    await expect(trigger).toContainText('高');
    await chooseConversationModel(page, provider.name, 'Chat');
    await trigger.click();
    await reasoning.hover();
    await expect(page.getByRole('menuitemradio', { name: '关闭', exact: true })).toBeChecked();
    await expect(high).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await chooseConversationModel(page, provider.name, 'Reasoning A');
    await trigger.press('Enter');
    await reasoning.focus();
    await reasoning.press('ArrowRight');
    await expect(high).toBeVisible();
    await high.click();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '执行批准方式', exact: true }),
      '请求批准',
    );
    const created = page.waitForResponse((response) => {
      return (
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/sessions'
      );
    });
    await page.getByLabel('消息', { exact: true }).fill('共享推理菜单验收');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const response = await created;
    const submitted: unknown = response.request().postDataJSON();
    expect(submitted).toMatchObject({ thinkingLevel: 'high', approvalMode: 'ask' });
    expect(submitted).not.toHaveProperty('workMode');
    const initial: unknown = await response.json();
    if (!response.ok() || !Value.Check(SessionSnapshotSchema, initial))
      throw new Error('The reasoning conversation was not created');
    await expect(page.getByText('响应：共享推理菜单验收', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeHidden();
    expect((await readSession(page, daemon.origin, initial.session.id)).session).toMatchObject({
      modelId: 'reasoning-a',
      thinkingLevel: 'high',
      approvalMode: 'ask',
    });
    await chooseConversationModel(page, provider.name, 'Chat');
    await expect
      .poll(async () => {
        return (await readSession(page, daemon.origin, initial.session.id)).session.thinkingLevel;
      })
      .toBe('off');
    expect((await readSession(page, daemon.origin, initial.session.id)).session.approvalMode).toBe(
      'ask',
    );
    await page.reload();
    await page.getByRole('button', { name: /^共享推理菜单验收 /u }).click();
    await expect(trigger).toContainText('Chat');
    await expect(page.getByRole('combobox', { name: '执行批准方式', exact: true })).toContainText(
      '请求批准',
    );
    expect(model.requests).toHaveLength(1);
    expect(policyErrors).toEqual([]);
  } finally {
    await model.close();
  }
});

test('会话和工作接口拒绝已移除的模式参数，工作状态不再返回模式字段', async ({ page, daemon }) => {
  const model = await startTestModel();
  try {
    await page.goto(daemon.origin);
    const provider = await configureTestProvider(page, model.origin);
    const headers = await headersFor(page);
    const input = {
      title: '无工作模式会话',
      providerId: provider.id,
      modelId: 'chat-model',
      thinkingLevel: 'off',
      approvalMode: 'ask',
    };
    for (const mode of ['execute', 'plan']) {
      const rejected = await page.request.post(`${daemon.origin}/api/sessions`, {
        headers,
        data: { ...input, workMode: mode },
      });
      expect(rejected.status()).toBe(400);
    }
    const created = await page.request.post(`${daemon.origin}/api/sessions`, {
      headers,
      data: input,
    });
    const session: unknown = await created.json();
    if (!created.ok() || !Value.Check(SessionSnapshotSchema, session))
      throw new Error('The mode-free conversation was not created');
    const workUrl = `${daemon.origin}/api/sessions/${session.session.id}/work`;
    const stateUrl = `${workUrl}?branchId=${session.session.activeBranchId}`;
    const response = await page.request.get(stateUrl);
    const initial: unknown = await response.json();
    if (!response.ok() || !Value.Check(WorkSnapshotSchema, initial))
      throw new Error('The mode-free work snapshot is invalid');
    expect(initial.state).not.toHaveProperty('mode');
    for (const mode of ['execute', 'plan']) {
      const rejected = await page.request.patch(workUrl, {
        headers,
        data: {
          expectedBranchId: initial.state.branchId,
          revision: initial.state.revision,
          mode,
        },
      });
      expect(rejected.status()).toBe(400);
    }
    const current: unknown = await (await page.request.get(stateUrl)).json();
    expect(current).toEqual(initial);
    expect(model.requests).toHaveLength(0);
  } finally {
    await model.close();
  }
});
