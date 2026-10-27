import {
  AuthStatusSchema,
  ConnectionViewSchema,
  type ConnectionView,
} from '@my-pi-harness/protocol';
import type { Locator, Page, Request, Route } from '@playwright/test';
import { Value } from 'typebox/value';
import { test, expect } from './fixture.js';
import { openUserSettings } from './ui-controls.js';

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const ACCOUNT_NAME = 'OAuth launch browser account';

// The browser follows the real daemon-generated URL; the GitHub page itself is a local fixture.
test('OAuth 点击同步打开隔离中转窗，等待请求后跳转并完成原账户授权', async ({
  page,
  daemon,
}, testInfo) => {
  await interceptGitHub(page);
  const row = await openAccount(page, daemon.origin);
  let starts = 0;
  const release = createGate();
  const arrived = createGate();
  const holdStart = async (route: Route): Promise<void> => {
    expect(route.request().method()).toBe('POST');
    starts += 1;
    arrived.open();
    await release.wait;
    await route.continue();
  };
  await page.route('**/api/connections/*/oauth/start', holdStart);
  const opened = page.waitForEvent('popup');
  await row.getByRole('button', { name: '连接账户', exact: true }).click();
  const popup = await opened;
  const popupApiRequests: string[] = [];
  const watchPopupRequest = (request: Request): void => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      popupApiRequests.push(request.url());
    }
  };
  popup.on('request', watchPopupRequest);
  try {
    await arrived.wait;
    await expect(popup).toHaveURL(`${daemon.origin}/connection-oauth/launch?service=github`);
    await expect(
      popup.getByRole('heading', { name: '正在打开授权页面', exact: true }),
    ).toBeVisible();
    await expect(popup.getByRole('button', { name: '关闭窗口', exact: true })).toBeVisible();
    await expect(popup.getByRole('dialog', { name: '设置', exact: true })).toHaveCount(0);
    await expect(popup.getByRole('button', { name: '新对话', exact: true })).toHaveCount(0);
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    expect(popupApiRequests).toEqual([]);
    expect(starts).toBe(1);
    await popup.screenshot({ path: testInfo.outputPath('github-oauth-launch.png') });
    release.open();
    await popup.waitForURL((url) => url.origin + url.pathname === GITHUB_AUTHORIZE);
    await expect(
      popup.getByRole('heading', { name: 'Synthetic GitHub consent', exact: true }),
    ).toBeVisible();
    const authorization = new URL(popup.url());
    expect(authorization.searchParams.get('client_id')).toBe('synthetic-browser-oauth-client');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.has('client_secret')).toBe(false);
    expect(authorization.searchParams.has('code_verifier')).toBe(false);
    const redirect = authorization.searchParams.get('redirect_uri');
    const state = authorization.searchParams.get('state');
    if (redirect === null || state === null) throw new Error('The daemon omitted callback data');
    const callback = new URL(redirect);
    callback.searchParams.set('state', state);
    callback.searchParams.set('code', 'synthetic-browser-oauth-code');
    await popup.goto(callback.href);
    await expect(
      popup.getByText('账户授权完成，请返回应用刷新连接状态。', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '刷新状态', exact: true }).click();
    await expect(row).toContainText('已连接 · Browser connection account');
    expect(starts).toBe(1);
    expect(page.url()).toBe(daemon.origin + '/');
  } finally {
    release.open();
    popup.off('request', watchPopupRequest);
    await popup.close();
    await page.unroute('**/api/connections/*/oauth/start', holdStart);
  }
});

test('浏览器阻止弹窗时给出提示且不创建后台 OAuth 流程', async ({ page, daemon }) => {
  await page.addInitScript(() => {
    window.open = (): null => null;
  });
  const row = await openAccount(page, daemon.origin);
  let starts = 0;
  const watchStart = (request: Request): void => {
    if (new URL(request.url()).pathname.endsWith('/oauth/start')) starts += 1;
  };
  page.on('request', watchStart);
  try {
    await row.getByRole('button', { name: '连接账户', exact: true }).click();
    await expect(row).toContainText('浏览器阻止了授权窗口，请允许弹窗后重试。');
    await expect(row.getByRole('button', { name: '连接账户', exact: true })).toBeEnabled();
    await expect(row.getByRole('button', { name: '重新打开授权页', exact: true })).toHaveCount(0);
    expect(starts).toBe(0);
  } finally {
    page.off('request', watchStart);
  }
});

test('用户提前关闭中转窗后可重新打开同一授权，不重复启动流程', async ({ page, daemon }) => {
  await interceptGitHub(page);
  const row = await openAccount(page, daemon.origin);
  let starts = 0;
  const release = createGate();
  const arrived = createGate();
  const holdStart = async (route: Route): Promise<void> => {
    starts += 1;
    arrived.open();
    await release.wait;
    await route.continue();
  };
  await page.route('**/api/connections/*/oauth/start', holdStart);
  const opened = page.waitForEvent('popup');
  await row.getByRole('button', { name: '连接账户', exact: true }).click();
  const popup = await opened;
  try {
    await arrived.wait;
    await expect(
      popup.getByRole('heading', { name: '正在打开授权页面', exact: true }),
    ).toBeVisible();
    await popup.close();
    release.open();
    await expect(row).toContainText('授权窗口已关闭，请重新打开授权页继续。');
    const reopened = page.waitForEvent('popup');
    await row.getByRole('button', { name: '重新打开授权页', exact: true }).click();
    const replacement = await reopened;
    try {
      await replacement.waitForURL((url) => url.origin + url.pathname === GITHUB_AUTHORIZE);
      await expect(
        replacement.getByRole('heading', { name: 'Synthetic GitHub consent', exact: true }),
      ).toBeVisible();
      expect(await replacement.evaluate(() => window.opener === null)).toBe(true);
      await expect(
        row.getByText('授权窗口已关闭，请重新打开授权页继续。', { exact: true }),
      ).toHaveCount(0);
      expect(starts).toBe(1);
      const authorization = new URL(replacement.url());
      await row.getByRole('button', { name: '取消授权', exact: true }).click();
      await expect(row.getByRole('button', { name: '重新打开授权页', exact: true })).toHaveCount(0);
      const redirect = authorization.searchParams.get('redirect_uri');
      const state = authorization.searchParams.get('state');
      if (redirect === null || state === null) throw new Error('Missing canceled OAuth callback');
      const callback = new URL(redirect);
      callback.searchParams.set('state', state);
      callback.searchParams.set('code', 'synthetic-browser-oauth-code');
      const canceled = await page.request.get(callback.href);
      expect(canceled.ok()).toBe(false);
      expect(await canceled.text()).toContain('授权流程已过期');
    } finally {
      await replacement.close();
    }
  } finally {
    release.open();
    await popup.close();
    await page.unroute('**/api/connections/*/oauth/start', holdStart);
  }
});

test('OAuth 启动失败关闭预先打开的中转窗并保留父页面错误', async ({ page, daemon }) => {
  const row = await openAccount(page, daemon.origin);
  const release = createGate();
  const failedStart = async (route: Route): Promise<void> => {
    await release.wait;
    await route.fulfill({
      status: 400,
      json: { code: 'SYNTHETIC_START_FAILED', message: '合成授权启动失败' },
    });
  };
  await page.route('**/api/connections/*/oauth/start', failedStart);
  const opened = page.waitForEvent('popup');
  await row.getByRole('button', { name: '连接账户', exact: true }).click();
  const popup = await opened;
  try {
    await expect(
      popup.getByRole('heading', { name: '正在打开授权页面', exact: true }),
    ).toBeVisible();
    const closed = popup.waitForEvent('close');
    release.open();
    await closed;
    await expect(row).toContainText('合成授权启动失败');
    await expect(row.getByRole('button', { name: '连接账户', exact: true })).toBeEnabled();
    await expect(row.getByRole('button', { name: '重新打开授权页', exact: true })).toHaveCount(0);
  } finally {
    release.open();
    await popup.close();
    await page.unroute('**/api/connections/*/oauth/start', failedStart);
  }
});

test('离开账户页面中止在途启动并关闭自有中转窗', async ({ page, daemon }) => {
  const row = await openAccount(page, daemon.origin);
  const release = createGate();
  const arrived = createGate();
  const holdStart = async (route: Route): Promise<void> => {
    arrived.open();
    await release.wait;
    await route.fulfill({
      json: {
        url: `${GITHUB_AUTHORIZE}?state=synthetic-late-flow`,
        expiresAt: Date.now() + 60_000,
      },
    });
  };
  await page.route('**/api/connections/*/oauth/start', holdStart);
  const opened = page.waitForEvent('popup');
  await row.getByRole('button', { name: '连接账户', exact: true }).click();
  const popup = await opened;
  try {
    await arrived.wait;
    await expect(
      popup.getByRole('heading', { name: '正在打开授权页面', exact: true }),
    ).toBeVisible();
    const closed = popup.waitForEvent('close');
    await page.getByRole('tab', { name: '插件', exact: true }).click();
    await closed;
    release.open();
    await page.getByRole('tab', { name: '连接', exact: true }).click();
    await expect(row).toContainText('尚未连接');
    await expect(row.getByRole('button', { name: '重新打开授权页', exact: true })).toHaveCount(0);
  } finally {
    release.open();
    await popup.close();
    await page.unroute('**/api/connections/*/oauth/start', holdStart);
  }
});

test('直接访问中转页只呈现受控服务，拒绝地址参数且不初始化应用', async ({ page, daemon }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url());
  });
  await page.goto(`${daemon.origin}/connection-oauth/launch?service=github`);
  await expect(page.getByRole('heading', { name: '正在打开授权页面', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('GitHub');
  expect(requests).toEqual([]);
  await page.goto(
    `${daemon.origin}/connection-oauth/launch?service=github&url=https%3A%2F%2Fexample.com%2Fauthorize&name=arbitrary-provider`,
  );
  await expect(page.getByRole('heading', { name: '无法打开授权页面', exact: true })).toBeVisible();
  await expect(page.getByText(/arbitrary-provider/u)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新对话', exact: true })).toHaveCount(0);
  expect(new URL(page.url()).origin).toBe(daemon.origin);
  expect(requests).toEqual([]);
});

function createGate(): { wait: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

async function interceptGitHub(page: Page): Promise<void> {
  await page.context().route(`${GITHUB_AUTHORIZE}?*`, async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body><h1>Synthetic GitHub consent</h1></body></html>',
    });
  });
}

async function openAccount(page: Page, origin: string): Promise<Locator> {
  await page.goto(origin);
  const statusResponse = await page.request.get(`${origin}/api/auth/status`);
  const status: unknown = await statusResponse.json();
  if (!statusResponse.ok() || !Value.Check(AuthStatusSchema, status) || status.csrfToken === null) {
    throw new Error('The OAuth fixture requires an authenticated browser session');
  }
  const headers = { Origin: origin, 'X-CSRF-Token': status.csrfToken };
  const created = await page.request.post(`${origin}/api/connections`, {
    headers,
    data: {
      serviceId: 'github',
      name: ACCOUNT_NAME,
      authMode: 'oauth',
      clientId: 'synthetic-browser-oauth-client',
      scopes: ['read:user', 'repo'],
    },
  });
  const account: unknown = await created.json();
  if (!created.ok() || !Value.Check(ConnectionViewSchema, account)) {
    throw new Error('The OAuth fixture could not create its isolated account');
  }
  await configureSecret(page, origin, headers, account);
  await openUserSettings(page);
  await page.getByRole('tab', { name: '连接', exact: true }).click();
  const row = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: ACCOUNT_NAME, exact: true }) });
  await expect(row).toContainText('尚未连接');
  return row;
}

async function configureSecret(
  page: Page,
  origin: string,
  headers: Record<string, string>,
  account: ConnectionView,
): Promise<void> {
  const response = await page.request.post(
    `${origin}/api/connections/${account.id}/client-secret`,
    {
      headers,
      data: {
        expectedRevision: account.revision,
        expectedAccessEpoch: account.accessEpoch,
        value: 'synthetic-browser-oauth-secret',
      },
    },
  );
  expect(response.ok()).toBe(true);
}
