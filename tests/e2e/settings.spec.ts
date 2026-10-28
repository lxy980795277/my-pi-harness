import { type AuthFlow, ProviderConfigSchema } from '@my-pi-harness/protocol';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { test, expect } from './fixture.js';
import { startTestModel } from './model-server.js';
import { chooseOption, openUserSettings } from './ui-controls.js';

test('用户卡片只打开向上菜单，关闭回焦且设置接管弹窗焦点', async ({ page, daemon }, testInfo) => {
  await page.goto(daemon.origin);
  const trigger = page.getByRole('button', { name: '用户信息，打开菜单', exact: true });
  const menu = page.getByRole('dialog', { name: '用户菜单', exact: true });
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toHaveCount(0);
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button')).toHaveText(['设置', '退出登录']);
  await expect(settings).toHaveCount(0);
  await expect(menu.getByRole('button', { name: '设置', exact: true }).locator('svg')).toHaveCount(
    1,
  );
  await expect(
    menu.getByRole('button', { name: '退出登录', exact: true }).locator('svg'),
  ).toHaveCount(1);
  await expect
    .poll(async () => {
      const cardBounds = await trigger.boundingBox();
      const menuBounds = await menu.boundingBox();
      return (
        cardBounds !== null &&
        menuBounds !== null &&
        menuBounds.y + menuBounds.height <= cardBounds.y
      );
    })
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('user-menu-light.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(trigger).toBeFocused();

  await page.getByRole('button', { name: '切换到深色主题', exact: true }).click();
  await expect(page.getByRole('button', { name: '切换到浅色主题', exact: true })).toBeVisible();
  await trigger.click();
  await expect(menu).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('user-menu-dark.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: '切换到浅色主题', exact: true }).click();

  await trigger.press('Enter');
  await expect(menu).toBeVisible();
  await page.getByRole('heading', { name: '我们从哪里开始？', exact: true }).click();
  await expect(menu).not.toBeVisible();
  await expect(trigger).toBeFocused();

  await openUserSettings(page);
  await expect(settings).toBeVisible();
  await expect(menu).not.toBeVisible();
  await expect
    .poll(async () => {
      return settings.evaluate((element) => element.contains(document.activeElement));
    })
    .toBe(true);
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(settings).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('设置内容加载中保留弹窗、草稿和焦点，滚动轨道与外框保持间距', async ({
  page,
  daemon,
}, testInfo) => {
  await page.goto(daemon.origin);
  const draft = page.getByLabel('消息', { exact: true });
  await expect(draft).toBeVisible();
  await draft.fill('加载设置时保留的未发送草稿');
  const shell = page.getByTestId('workspace-shell');
  const initialBounds = await shell.boundingBox();
  if (!initialBounds) throw new Error('The workspace shell must have visible bounds');
  let releaseScripts = (): void => {
    throw new Error('The settings asset gate has not initialized');
  };
  const scriptsGate = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  let heldScriptRequests = 0;
  // Initial application scripts are loaded; only subsequent lazy content waits at this gate.
  await page.route('**/assets/*.js', async (route) => {
    heldScriptRequests += 1;
    await scriptsGate;
    await route.continue();
  });
  try {
    const trigger = page.getByRole('button', { name: '用户信息，打开菜单', exact: true });
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    const loading = settings.getByRole('status').filter({ hasText: '正在加载设置…' });
    await openUserSettings(page);
    await expect.poll(() => heldScriptRequests).toBeGreaterThan(0);
    await expect(settings).toBeVisible();
    await expect(loading).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '正在加载设置…' })).toHaveCount(1);
    await expect
      .poll(async () => {
        const bounds = await shell.boundingBox();
        if (!bounds) return Number.POSITIVE_INFINITY;
        return Math.abs(bounds.width - initialBounds.width);
      })
      .toBeLessThan(0.5);
    await page.screenshot({ path: testInfo.outputPath('settings-loading.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(settings).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(draft).toHaveValue('加载设置时保留的未发送草稿');
    await expect(page.getByRole('status').filter({ hasText: '正在加载设置…' })).toHaveCount(0);
    await openUserSettings(page);
    await expect(settings).toBeVisible();
    await expect(loading).toBeVisible();
    releaseScripts();
    await expect(settings.getByRole('switch')).toHaveCount(6);
    await expect(loading).toHaveCount(0);
    const viewport = settings.locator('[data-radix-scroll-area-viewport]');
    const scrollArea = viewport.locator('xpath=..');
    const track = scrollArea.locator(':scope > [data-orientation="vertical"]');
    await expect
      .poll(async () => {
        return viewport.evaluate((element) => element.scrollHeight > element.clientHeight);
      })
      .toBe(true);
    await viewport.hover();
    await expect(track).toBeVisible();
    const dialogBounds = await settings.boundingBox();
    const trackBounds = await track.boundingBox();
    if (!dialogBounds || !trackBounds)
      throw new Error('Settings and scrollbar must have visible bounds');
    expect(
      dialogBounds.x + dialogBounds.width - trackBounds.x - trackBounds.width,
    ).toBeGreaterThanOrEqual(11.5);
    expect(trackBounds.y - dialogBounds.y).toBeGreaterThanOrEqual(19.5);
    expect(
      dialogBounds.y + dialogBounds.height - trackBounds.y - trackBounds.height,
    ).toBeGreaterThanOrEqual(19.5);
    const kimi = settings.getByRole('region', { name: 'Kimi', exact: true });
    await kimi.scrollIntoViewIfNeeded();
    await expect(kimi).toBeInViewport();
    await track.hover();
    await page.screenshot({
      path: testInfo.outputPath('settings-scroll-inset.png'),
      fullPage: true,
    });
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    await expect(settings).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(draft).toHaveValue('加载设置时保留的未发送草稿');
  } finally {
    releaseScripts();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('内置厂商只读设置、弹窗焦点与动态样式 CSP', async ({ page, daemon }, testInfo) => {
  const policyErrors: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) policyErrors.push(message.text());
  });
  await page.goto(daemon.origin);
  const navigation = page.getByRole('navigation', { name: '页面导航', exact: true });
  await expect(navigation.getByRole('button')).toHaveCount(2);
  await expect(navigation.getByRole('button', { name: '设置', exact: true })).toHaveCount(0);
  const trigger = page.getByRole('button', { name: '用户信息，打开菜单', exact: true });
  await openUserSettings(page);
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('tab', { name: '模型', exact: true }).click();
  await expect(settings.getByRole('switch')).toHaveCount(6);
  const openai = settings.getByRole('region', { name: 'OpenAI', exact: true });
  await expect(openai).not.toContainText('内置 Provider');
  await openai.getByRole('button', { name: '配置', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '配置 OpenAI', exact: true });
  await expect(editor.getByLabel('Base URL', { exact: true })).toHaveCount(0);
  await expect(editor.getByRole('button', { name: '删除 Provider', exact: true })).toHaveCount(0);
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await openai.getByRole('button', { name: '模型', exact: true }).click();
  const models = page.getByRole('dialog', { name: 'OpenAI 模型', exact: true });
  await expect(models.getByLabel('新增模型 ID', { exact: true })).toHaveCount(0);
  await expect(models.getByLabel('上下文长度', { exact: true }).first()).toHaveAttribute(
    'readonly',
    '',
  );
  await expect(models.getByRole('button', { name: /^删除模型 / })).toHaveCount(0);
  await models.getByRole('button', { name: '关闭', exact: true }).click();
  await settings.getByRole('combobox', { name: '默认模型', exact: true }).click();
  await page.keyboard.press('Escape');
  const styles = await page.evaluate(() => {
    const nonce = document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.nonce;
    return {
      nonceLength: nonce?.length ?? 0,
      count: document.querySelectorAll('style').length,
      unapproved: [...document.querySelectorAll('style')].filter((style) => style.nonce !== nonce)
        .length,
    };
  });
  expect(styles.nonceLength).toBeGreaterThan(30);
  expect(styles.count).toBeGreaterThan(0);
  expect(styles.unapproved).toBe(0);
  expect(policyErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('settings-light.png'), fullPage: true });
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(settings).not.toBeVisible();
  await expect(trigger).toBeFocused();
  const unauthorizedStyle = await page.evaluate(() => {
    const style = document.createElement('style');
    style.nonce = 'incorrect-nonce';
    style.textContent = 'body { --unauthorized-style-probe: blocked; }';
    document.head.append(style);
    const value = getComputedStyle(document.body).getPropertyValue('--unauthorized-style-probe');
    style.remove();
    return value.trim();
  });
  expect(unauthorizedStyle).toBe('');
});

test('无 Key 模型、默认设置重载与失效提示，设置保留聊天草稿', async ({ page, daemon }) => {
  const model = await startTestModel();
  try {
    await page.goto(daemon.origin);
    await openUserSettings(page);
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await settings.getByRole('tab', { name: '模型', exact: true }).click();
    await settings.getByRole('button', { name: '添加 Provider', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '添加 Provider', exact: true });
    await editor.getByLabel('名称', { exact: true }).fill('无需 Key');
    await chooseOption(
      page,
      editor.getByRole('combobox', { name: '协议', exact: true }),
      'OpenAI Chat Completions',
    );
    await editor.getByLabel('Base URL', { exact: true }).fill(`${model.origin}/v1`);
    await editor.getByRole('switch', { name: '需要 API Key', exact: true }).click();
    await expect(editor.getByLabel('API Key', { exact: true })).toHaveCount(0);
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    const card = settings.getByRole('region', { name: '无需 Key', exact: true });
    await expect(card.getByText('已配置', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: '模型', exact: true }).click();
    const models = page.getByRole('dialog', { name: '无需 Key 模型', exact: true });
    await models.getByLabel('新增模型 ID', { exact: true }).fill('chat-model');
    await models.getByRole('button', { name: '添加', exact: true }).click();
    await models.getByRole('button', { name: '保存', exact: true }).click();
    await card.getByRole('button', { name: '模型', exact: true }).click();
    await models.getByRole('button', { name: '测试 chat-model 连接', exact: true }).click();
    await expect(models.getByText('The model returned a response.', { exact: true })).toBeVisible();
    await models.getByRole('button', { name: '关闭', exact: true }).click();
    await chooseOption(
      page,
      settings.getByRole('combobox', { name: '默认模型', exact: true }),
      '无需 Key · chat-model',
    );
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: '对话模型', exact: true })).toBeVisible();
    await page.getByLabel('消息', { exact: true }).fill('保留这份未发送草稿');
    await openUserSettings(page);
    await expect(card).toBeVisible();
    await card.getByRole('switch', { name: '启用 无需 Key', exact: true }).click();
    await expect(card.getByRole('switch')).not.toBeChecked();
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('保留这份未发送草稿');
    await page.reload();
    await expect(
      page.getByText('保存的默认模型已不可用，请在输入框下选择其他模型，或打开设置更新配置。', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]?.authorization).toBeUndefined();
  } finally {
    await model.close();
  }
});

test('Provider OAuth 弹窗清理秘密、关闭取消及允许空文本挑战', async ({ page, daemon }) => {
  await page.goto(daemon.origin);
  const response = await page.request.get(`${daemon.origin}/api/providers`);
  const providers: unknown = await response.json();
  if (!Value.Check(Type.Array(ProviderConfigSchema), providers))
    throw new Error('Invalid provider fixture');
  const provider = providers.find((entry) => entry.builtinId === 'anthropic');
  if (!provider) throw new Error('Missing native Anthropic entry');
  let attempt = 0;
  let cancellations = 0;
  let flow: AuthFlow;
  // Public wire fixtures verify view ownership; SDK lifecycle has separate real runtime tests.
  await page.route(`**/api/providers/${provider.id}/auth`, async (route) => {
    attempt += 1;
    let prompt: NonNullable<AuthFlow['prompt']> = {
      id: 'secret-challenge',
      type: 'secret',
      secret: true,
      message: '本地测试验证码',
    };
    if (attempt === 2)
      prompt = { id: 'text-challenge', type: 'text', secret: false, message: '可选备注' };
    flow = {
      id: 'synthetic-oauth-flow',
      providerId: provider.id,
      status: 'pending',
      url: null,
      deviceCode: null,
      prompt,
      message: null,
      error: null,
    };
    await route.fulfill({ json: flow });
  });
  await page.route('**/api/auth-flows/synthetic-oauth-flow', async (route) => {
    if (route.request().method() === 'DELETE') {
      cancellations += 1;
      flow = { ...flow, status: 'cancelled', prompt: null };
    }
    await route.fulfill({ json: flow });
  });
  await page.route('**/api/auth-flows/synthetic-oauth-flow/respond', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ promptId: 'text-challenge', value: '' });
    flow = { ...flow, status: 'completed', prompt: null };
    await route.fulfill({ json: flow });
  });
  await openUserSettings(page);
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('tab', { name: '模型', exact: true }).click();
  const card = settings.getByRole('region', { name: 'Anthropic', exact: true });
  const editor = page.getByRole('dialog', { name: '配置 Anthropic', exact: true });
  await card.getByRole('button', { name: '配置', exact: true }).click();
  await editor.getByRole('tab', { name: 'OAuth', exact: true }).click();
  await editor.getByRole('button', { name: '使用 OAuth 登录', exact: true }).click();
  await expect(editor.locator('form form')).toHaveCount(0);
  await expect(editor.getByLabel('本地测试验证码', { exact: true })).toHaveAttribute(
    'type',
    'password',
  );
  await editor.getByLabel('本地测试验证码', { exact: true }).fill('transient-oauth-value');
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(cancellations).toBe(1);
  await card.getByRole('button', { name: '配置', exact: true }).click();
  await editor.getByRole('tab', { name: 'OAuth', exact: true }).click();
  await editor.getByRole('button', { name: '使用 OAuth 登录', exact: true }).click();
  await expect(editor.getByLabel('可选备注', { exact: true })).toHaveValue('');
  await editor.getByRole('button', { name: '继续', exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(cancellations).toBe(1);
  await expect(page.getByText('transient-oauth-value', { exact: true })).toHaveCount(0);
});
