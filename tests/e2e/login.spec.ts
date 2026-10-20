import { AuthStatusSchema, type DesktopBridge } from '@my-pi-harness/protocol';
import type { Page } from '@playwright/test';
import { Value } from 'typebox/value';
import { test, expect } from './fixture.js';
import { openLogoutConfirmation } from './ui-controls.js';

test('GitHub浏览器授权拒绝后可重试，登录后恢复身份且退出清理草稿', async ({
  page,
  daemon,
}, testInfo) => {
  await page.goto(daemon.origin);
  const user = page.getByRole('button', { name: '用户信息，打开菜单', exact: true });
  await expect(user).toContainText('E2E User');
  await page.getByLabel('消息', { exact: true }).fill('退出时必须移除的私人草稿');
  await openLogoutConfirmation(page);
  await page
    .getByRole('alertdialog', { name: '确认退出登录？', exact: true })
    .getByRole('button', { name: '退出登录', exact: true })
    .click();
  const login = page.getByTestId('login-page');
  await expect(login).toBeVisible();
  await expect(page.getByTestId('workspace-shell')).toHaveCount(0);
  const statusResponse = await page.request.get(`${daemon.origin}/api/auth/status`);
  const status: unknown = await statusResponse.json();
  if (!Value.Check(AuthStatusSchema, status)) throw new Error('Invalid logged-out status');
  expect(status.localAuthorized).toBe(true);
  expect(status.authenticated).toBe(false);
  expect(status.user).toBeNull();
  expect((await page.request.get(`${daemon.origin}/api/sessions`)).status()).toBe(401);

  await interceptGitHubAuthorization(page, daemon.origin);
  await login.getByRole('button', { name: '使用 GitHub 登录', exact: true }).click();
  await expect(page.getByRole('link', { name: '拒绝 GitHub 授权', exact: true })).toBeVisible();
  const callbackCookies = await page.context().cookies(`${daemon.origin}/api/auth/callback/github`);
  const nonce = callbackCookies.find((cookie) => cookie.name === 'my_pi_login_callback');
  expect(nonce).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api/auth/callback' });
  await page.getByRole('link', { name: '拒绝 GitHub 授权', exact: true }).click();
  await expect(login).toBeVisible();
  await expect(login.getByRole('button', { name: '重新登录', exact: true })).toBeVisible();
  await expect(page.getByTestId('login-device-code')).toHaveCount(0);
  await expect(page.getByTestId('workspace-shell')).toHaveCount(0);
  await expect(page).toHaveURL(daemon.origin + '/');
  await page.screenshot({ path: testInfo.outputPath('github-login-denied.png'), fullPage: true });

  await login.getByRole('button', { name: '重新登录', exact: true }).click();
  const callbackResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === daemon.origin && url.pathname === '/api/auth/callback/github';
  });
  await page.getByRole('link', { name: '批准 GitHub 授权', exact: true }).click();
  const callback = await callbackResponse;
  expect(callback.status()).toBe(303);
  const callbackCookie = await callback.request().headerValue('cookie');
  expect(callbackCookie).toContain('my_pi_login_callback=');
  expect(callbackCookie).not.toContain('my_pi_local=');
  expect(callbackCookie).not.toContain('my_pi_session=');
  expect(await callback.headerValue('set-cookie')).not.toContain('my_pi_session=');
  await expect(user).toContainText('E2E User');
  await expect(login).toHaveCount(0);
  await expect(page.getByLabel('消息', { exact: true })).toHaveValue('');
  await expect(user.locator('img')).toHaveAttribute(
    'src',
    'https://avatars.githubusercontent.com/u/42424242?v=4',
  );
  await page.reload();
  await expect(user).toContainText('E2E User');
  await page.screenshot({ path: testInfo.outputPath('github-login-restored.png'), fullPage: true });
  const restored: unknown = await (
    await page.request.get(`${daemon.origin}/api/auth/status`)
  ).json();
  if (!Value.Check(AuthStatusSchema, restored)) throw new Error('Invalid restored login');
  expect(restored.authenticated).toBe(true);
  expect(restored.session?.providerId).toBe('github');
  const browserState = await page.evaluate(() => ({
    cookies: document.cookie,
    localStorage: { ...localStorage },
    sessionStorage: { ...sessionStorage },
  }));
  const exposed = JSON.stringify(browserState);
  expect(exposed).not.toContain(daemon.token);
  expect(exposed).not.toContain(daemon.loginToken);
  expect(exposed).not.toContain('synthetic-disposable-github-token');
  expect(exposed).not.toContain('synthetic-e2e-client-secret');
  const applicationCookie = (await page.context().cookies()).find((cookie) => {
    return cookie.name === 'my_pi_session';
  });
  expect(applicationCookie).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
  if (!applicationCookie) throw new Error('The restored application cookie is missing');
  expect(exposed).not.toContain(applicationCookie.value);
  expect(
    (await page.context().cookies()).some((cookie) => cookie.name === 'my_pi_login_callback'),
  ).toBe(false);
});

test('本机信任仍在时缺失应用Cookie进入登录页，不加载私有数据', async ({
  page,
  daemon,
}, testInfo) => {
  await page.context().clearCookies({ name: 'my_pi_session' });
  const privateRequests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (/^\/api\/(?:sessions|providers|workspaces|settings|attachments)(?:\/|$)/.test(pathname))
      privateRequests.push(pathname);
  });
  await page.goto(daemon.origin);
  await expect(page.getByTestId('login-page')).toBeVisible();
  await expect(page.getByTestId('workspace-shell')).toHaveCount(0);
  expect(privateRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('github-login-required.png'), fullPage: true });
  await page.reload();
  await expect(page.getByTestId('login-page')).toBeVisible();
  expect(privateRequests).toEqual([]);
});

test('服务端撤销后私有请求触发重新登录并清理页面草稿', async ({ page, daemon }) => {
  await interceptGitHubAuthorization(page, daemon.origin);
  await page.goto(daemon.origin);
  await page.getByLabel('消息', { exact: true }).fill('登录失效后不可恢复的草稿');
  const response = await page.request.get(`${daemon.origin}/api/auth/status`);
  const status: unknown = await response.json();
  if (!Value.Check(AuthStatusSchema, status) || status.csrfToken === null)
    throw new Error('The revoked-session test requires current local trust');
  const logout = await page.request.post(`${daemon.origin}/api/auth/logout`, {
    headers: { Origin: daemon.origin, 'X-CSRF-Token': status.csrfToken },
    data: {},
  });
  expect(logout.ok()).toBe(true);
  await page.getByRole('button', { name: '生成浏览器配对码', exact: true }).click();
  await expect(page.getByTestId('login-page')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('workspace-shell')).toHaveCount(0);
  await page.getByRole('button', { name: '使用 GitHub 登录', exact: true }).click();
  await page.getByRole('link', { name: '批准 GitHub 授权', exact: true }).click();
  await expect(page.getByLabel('消息', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: '用户信息，打开菜单', exact: true })).toContainText(
    'E2E User',
  );
});

test('桌面入口使用设备码并自动打开浏览器，打开失败可手动重试', async ({ page, daemon }) => {
  await page.addInitScript(() => {
    let attempts = 0;
    const bridge: DesktopBridge = {
      openExternal() {
        return Promise.reject(new Error('This login scenario does not open external content'));
      },
      getInfo() {
        return Promise.resolve({ appVersion: '0.0.0-e2e', platform: 'darwin' });
      },
      openAuth(flowId) {
        attempts += 1;
        document.documentElement.dataset['e2eOpenAuthCount'] = String(attempts);
        document.documentElement.dataset['e2eOpenAuthFlow'] = flowId;
        if (attempts === 1) return Promise.reject(new Error('系统浏览器暂时无法打开'));
        return Promise.resolve();
      },
      chooseWorkspaceDirectory() {
        return Promise.resolve(null);
      },
      getDroppedWorkspaceDirectory() {
        return Promise.reject(new Error('This login scenario does not accept dropped directories'));
      },
    };
    Object.defineProperty(window, 'desktop', { value: bridge });
  });
  let releasePolling = (): void => undefined;
  const pollingGate = new Promise<void>((resolve) => {
    releasePolling = resolve;
  });
  await page.route('**/api/auth/login-flows/*', async (route) => {
    if (route.request().method() === 'GET') await pollingGate;
    await route.continue();
  });
  try {
    await page.goto(daemon.origin);
    await openLogoutConfirmation(page);
    await page
      .getByRole('alertdialog', { name: '确认退出登录？', exact: true })
      .getByRole('button', { name: '退出登录', exact: true })
      .click();
    const login = page.getByTestId('login-page');
    await login.getByRole('button', { name: '使用 GitHub 登录', exact: true }).click();
    await expect(page.getByTestId('login-device-code')).toHaveText('E2E-TEST');
    await expect(page.locator('html')).toHaveAttribute('data-e2e-open-auth-count', '1');
    await expect(page.locator('html')).toHaveAttribute('data-e2e-open-auth-flow', /^login_/);
    await expect(login).toContainText('系统浏览器暂时无法打开');
    await login.getByRole('button', { name: '打开 GitHub', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-e2e-open-auth-count', '2');
    await expect(login).not.toContainText('系统浏览器暂时无法打开');
    expect(new URL(page.url()).origin).toBe(daemon.origin);
    releasePolling();
    await expect(login).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '用户信息，打开菜单', exact: true }),
    ).toContainText('E2E User');
  } finally {
    releasePolling();
  }
});

test('离开GitHub授权页并刷新后可以重新开始浏览器登录', async ({ page, daemon }) => {
  await interceptGitHubAuthorization(page, daemon.origin);
  await page.context().clearCookies({ name: 'my_pi_session' });
  await page.goto(daemon.origin);
  await page.getByRole('button', { name: '使用 GitHub 登录', exact: true }).click();
  await expect(page.getByRole('link', { name: '批准 GitHub 授权', exact: true })).toBeVisible();
  const abandonedState = new URL(page.url()).searchParams.get('state');
  expect(abandonedState).toBeTruthy();
  await page.goto(daemon.origin);
  await page.reload();
  await page.getByRole('button', { name: '使用 GitHub 登录', exact: true }).click();
  await expect(page.getByRole('link', { name: '批准 GitHub 授权', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('state')).not.toBe(abandonedState);
  await page.getByRole('link', { name: '批准 GitHub 授权', exact: true }).click();
  await expect(page.getByTestId('login-page')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '用户信息，打开菜单', exact: true })).toContainText(
    'E2E User',
  );
});

test('退出确认可取消与Esc关闭，保留身份草稿且确认只发起一次退出', async ({
  page,
  daemon,
}, testInfo) => {
  let logoutRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/logout')
      logoutRequests += 1;
  });
  await page.goto(daemon.origin);
  const user = page.getByRole('button', { name: '用户信息，打开菜单', exact: true });
  const draft = page.getByLabel('消息', { exact: true });
  const confirmation = page.getByRole('alertdialog', { name: '确认退出登录？', exact: true });
  await draft.fill('取消退出后必须保留的私人草稿');
  await openLogoutConfirmation(page);
  await expect(confirmation).toBeVisible();
  await expect(page.getByRole('dialog', { name: '用户菜单', exact: true })).not.toBeVisible();
  await expect(confirmation.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  expect(logoutRequests).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath('logout-confirmation-light.png'),
    fullPage: true,
  });
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(user).toBeFocused();
  await expect(user).toContainText('E2E User');
  await expect(draft).toHaveValue('取消退出后必须保留的私人草稿');
  expect(logoutRequests).toBe(0);

  await page.getByRole('button', { name: '切换到深色主题', exact: true }).click();
  await openLogoutConfirmation(page);
  await expect(confirmation).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('logout-confirmation-dark.png'),
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(confirmation).not.toBeVisible();
  await expect(user).toBeFocused();
  await expect(user).toContainText('E2E User');
  await expect(draft).toHaveValue('取消退出后必须保留的私人草稿');
  expect(logoutRequests).toBe(0);

  await page.getByRole('button', { name: '切换到浅色主题', exact: true }).click();
  await openLogoutConfirmation(page);
  await confirmation.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByTestId('login-page')).toBeVisible();
  await expect(page.getByTestId('workspace-shell')).toHaveCount(0);
  await expect(confirmation).toHaveCount(0);
  expect(logoutRequests).toBe(1);
});

test('浏览器登录慢请求与跳转保持按钮loading，失败可重试且回调恢复有反馈', async ({
  page,
  daemon,
}, testInfo) => {
  const startRequested = createGate();
  const allowStart = createGate();
  const recoveryRequested = createGate();
  const allowRecovery = createGate();
  const interactions: Promise<void>[] = [];
  let attempts = 0;
  let navigations = 0;
  await page.route('**/api/auth/login', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      startRequested.release();
      await allowStart.wait;
      await route.fulfill({
        status: 502,
        json: { code: 'SYNTHETIC_LOGIN_UNAVAILABLE', message: '测试登录连接暂时不可用' },
      });
      return;
    }
    await route.continue();
  });
  await interceptGitHubAuthorization(page, daemon.origin, () => {
    navigations += 1;
    return navigations === 1;
  });
  await page.route('**/api/auth/login-flows/*', async (route) => {
    if (route.request().method() === 'GET') {
      recoveryRequested.release();
      await allowRecovery.wait;
    }
    await route.continue();
  });
  try {
    await page.context().clearCookies({ name: 'my_pi_session' });
    await page.goto(daemon.origin);
    const login = page.getByTestId('login-page');
    const loading = login.getByRole('button', { name: '正在前往 GitHub…', exact: true });
    const firstClick = login.getByRole('button', { name: '使用 GitHub 登录', exact: true }).click();
    interactions.push(firstClick);
    await startRequested.wait;
    await expect(loading).toBeVisible();
    await expect(loading).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath('login-start-loading.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.screenshot({
      path: testInfo.outputPath('login-start-loading-dark.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
    });
    allowStart.release();
    await firstClick;
    await expect(login).toContainText('测试登录连接暂时不可用');
    await expect(
      login.getByRole('button', { name: '使用 GitHub 登录', exact: true }),
    ).toBeEnabled();

    const retryClick = login.getByRole('button', { name: '使用 GitHub 登录', exact: true }).click();
    interactions.push(retryClick);
    await retryClick;
    await expect.poll(() => navigations).toBe(1);
    await expect(loading).toBeVisible();
    await expect(loading).toBeDisabled();
    await expect(login.getByRole('button', { name: '取消登录', exact: true })).toHaveCount(0);
    await expect(login.getByRole('button', { name: '重新登录', exact: true })).toHaveCount(0);
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    const restoredButton = login.getByRole('button', { name: '使用 GitHub 登录', exact: true });
    await expect(restoredButton).toBeEnabled();
    await restoredButton.click();

    const approvalClick = page.getByRole('link', { name: '批准 GitHub 授权', exact: true }).click();
    interactions.push(approvalClick);
    await recoveryRequested.wait;
    const recovering = login.getByRole('button', { name: '正在登录…', exact: true });
    await expect(recovering).toBeVisible();
    await expect(recovering).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath('login-callback-loading.png'),
      fullPage: true,
      animations: 'disabled',
    });
    allowRecovery.release();
    await approvalClick;
    await expect(login).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '用户信息，打开菜单', exact: true }),
    ).toContainText('E2E User');
    expect(attempts).toBe(3);
  } finally {
    allowStart.release();
    allowRecovery.release();
    await Promise.allSettled(interactions);
    await page.unrouteAll({ behavior: 'wait' });
  }
});

/** Complete a real cross-site browser redirect without contacting GitHub or bypassing daemon auth. */
async function interceptGitHubAuthorization(
  page: Page,
  origin: string,
  retainDocument?: () => boolean,
): Promise<void> {
  await page.route('https://github.com/login/oauth/authorize?**', async (route) => {
    const authorization = new URL(route.request().url());
    expect(authorization.searchParams.get('client_id')).toBe('synthetic-e2e-client-id');
    expect(authorization.searchParams.get('redirect_uri')).toBe(
      `${origin}/api/auth/callback/github`,
    );
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('prompt')).toBe('select_account');
    expect(authorization.searchParams.has('client_secret')).toBe(false);
    expect(authorization.searchParams.has('code_verifier')).toBe(false);
    const state = authorization.searchParams.get('state');
    const challenge = authorization.searchParams.get('code_challenge');
    expect(state).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (!state || !challenge) throw new Error('Browser login is missing state or PKCE');
    const approved = new URL('/api/auth/callback/github', origin);
    approved.searchParams.set('state', state);
    approved.searchParams.set('iss', 'https://github.com/login/oauth');
    approved.searchParams.set('code', `synthetic-e2e-code-${challenge}`);
    const denied = new URL('/api/auth/callback/github', origin);
    denied.searchParams.set('state', state);
    denied.searchParams.set('iss', 'https://github.com/login/oauth');
    denied.searchParams.set('error', 'access_denied');
    if (retainDocument?.()) {
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<html lang="zh-CN"><meta charset="utf-8"><body><a href="${approved.href}">批准 GitHub 授权</a><a href="${denied.href}">拒绝 GitHub 授权</a></body></html>`,
    });
  });
}

/** Release test-owned asynchronous boundaries explicitly, including failure cleanup. */
function createGate(): { wait: Promise<void>; release: () => void } {
  let release = (): void => {
    throw new Error('The asynchronous test gate has not initialized');
  };
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}
