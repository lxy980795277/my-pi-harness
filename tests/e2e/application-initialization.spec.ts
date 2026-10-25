import { PROTOCOL_VERSION } from '@my-pi-harness/protocol';
import type { Page, Route } from '@playwright/test';
import { test, expect } from './fixture.js';

const requiredPaths = ['/api/workspaces', '/api/sessions', '/api/providers', '/api/settings'];

interface Gate {
  wait: Promise<void>;
  release(): void;
}

/** Request completion is released by the scenario, including every failure cleanup. */
function gate(): Gate {
  let release = (): void => {
    throw new Error('The initialization request gate has not initialized');
  };
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

async function holdRequest(
  page: Page,
  pathname: string,
): Promise<Gate & { arrived: Promise<void> }> {
  const completion = gate();
  const arrival = gate();
  await page.route(
    (url) => url.pathname === pathname,
    async (route) => {
      arrival.release();
      await completion.wait;
      await route.continue();
    },
    { times: 1 },
  );
  return { ...completion, arrived: arrival.wait };
}

async function expectOutsideWorkspace(page: Page): Promise<void> {
  await expect(page.getByTestId('workspace-shell')).toHaveCount(0);
  await expect(page.getByLabel('消息', { exact: true })).toHaveCount(0);
}

test('登录、服务与并行工作台准备共用同一个加载节点，慢工作区和设置不会提前显示主界面', async ({
  page,
  daemon,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    requests.push(new URL(request.url()).pathname);
  });
  const authorization = await holdRequest(page, '/api/auth/status');
  const service = await holdRequest(page, '/api/health');
  const required = await Promise.all(requiredPaths.map((path) => holdRequest(page, path)));
  const optional = gate();
  const holdOptional = async (route: Route): Promise<void> => {
    await optional.wait;
    await route.continue();
  };
  await page.route('**/api/mcp/**', holdOptional);
  await page.route('**/api/skills**', holdOptional);
  await page.route('**/api/providers/catalog**', holdOptional);
  try {
    await page.goto(daemon.origin, { waitUntil: 'domcontentloaded' });
    await authorization.arrived;
    const loading = page.getByTestId('application-loading');
    await expect(loading).toHaveAttribute('role', 'status');
    await expect(loading).toHaveAttribute('data-stage', 'authorization');
    await expectOutsideWorkspace(page);
    expect(requests.filter((path) => requiredPaths.includes(path))).toEqual([]);
    expect(requests).not.toContain('/api/health');
    const initialNode = await loading.elementHandle();
    const initialBounds = await loading.boundingBox();
    if (initialNode === null || initialBounds === null)
      throw new Error('The authorization loading node must be mounted and visible');

    authorization.release();
    await service.arrived;
    await expect(loading).toHaveAttribute('data-stage', 'service');
    expect(
      await initialNode.evaluate((element) =>
        element.isSameNode(document.querySelector('[data-testid="application-loading"]')),
      ),
    ).toBe(true);
    await expectOutsideWorkspace(page);
    expect(requests.filter((path) => requiredPaths.includes(path))).toEqual([]);

    service.release();
    await Promise.all(required.map((request) => request.arrived));
    await expect(loading).toHaveAttribute('data-stage', 'workspace');
    expect(
      await initialNode.evaluate((element) =>
        element.isSameNode(document.querySelector('[data-testid="application-loading"]')),
      ),
    ).toBe(true);
    expect(await loading.boundingBox()).toEqual(initialBounds);
    await expectOutsideWorkspace(page);
    required[1]?.release();
    required[2]?.release();
    await expectOutsideWorkspace(page);
    required[0]?.release();
    await expect(loading).toHaveAttribute('data-stage', 'workspace');
    await expectOutsideWorkspace(page);
    required[3]?.release();
    await expect(page.getByTestId('workspace-shell')).toBeVisible();
    await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
    await expect(loading).toHaveCount(0);
    for (const path of requiredPaths)
      expect(requests.filter((request) => request === path)).toHaveLength(1);
  } finally {
    authorization.release();
    service.release();
    for (const request of required) request.release();
    optional.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('未登录只完成授权检查，不发出工作台和扩展私有请求', async ({ page, daemon }) => {
  await page.context().clearCookies({ name: 'my_pi_session' });
  const requests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/(?:workspaces|sessions|providers|settings|mcp|skills)(?:\/|$)/.test(path))
      requests.push(path);
  });
  const authorization = await holdRequest(page, '/api/auth/status');
  try {
    await page.goto(daemon.origin, { waitUntil: 'domcontentloaded' });
    await authorization.arrived;
    await expect(page.getByTestId('application-loading')).toHaveAttribute(
      'data-stage',
      'authorization',
    );
    await expectOutsideWorkspace(page);
    authorization.release();
    await expect(page.getByTestId('login-page')).toBeVisible();
    await expect(page.getByTestId('application-loading')).toHaveCount(0);
    await expectOutsideWorkspace(page);
    expect(requests).toEqual([]);
  } finally {
    authorization.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('必要设置首次失败可重试，空工作区、会话和Provider列表仍能进入输入页面', async ({
  page,
  daemon,
}) => {
  let failSettings = true;
  for (const path of requiredPaths.filter((path) => path !== '/api/settings'))
    await page.route(
      (url) => url.pathname === path,
      (route) => route.fulfill({ json: [] }),
    );
  await page.route('**/api/settings', async (route) => {
    if (failSettings) {
      await route.fulfill({
        status: 503,
        json: { code: 'SETTINGS_UNAVAILABLE', message: '初始化设置暂时不可用' },
      });
      return;
    }
    await route.continue();
  });
  await page.goto(daemon.origin);
  const error = page.getByTestId('application-initialization-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText('初始化设置暂时不可用');
  await expectOutsideWorkspace(page);
  failSettings = false;
  await error.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByTestId('workspace-shell')).toBeVisible();
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
  await expect(error).toHaveCount(0);
  await expect(page.getByTestId('application-loading')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新对话', exact: true })).toBeVisible();
});

test('协议不兼容保留服务诊断与重新连接，恢复后才准备私有工作台数据', async ({ page, daemon }) => {
  let compatible = false;
  const privateRequests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (requiredPaths.includes(path)) privateRequests.push(path);
  });
  await page.route('**/api/health', async (route) => {
    const response = await route.fetch();
    const health: unknown = await response.json();
    if (typeof health !== 'object' || health === null || Array.isArray(health))
      throw new Error('The health fixture must return an object');
    let protocolVersion = PROTOCOL_VERSION + 1;
    if (compatible) protocolVersion = PROTOCOL_VERSION;
    await route.fulfill({ json: { ...health, protocolVersion } });
  });
  await page.goto(daemon.origin);
  const error = page.getByTestId('service-gate');
  await expect(error).toBeVisible();
  await expect(error.getByTestId('runtime-connection')).toHaveAttribute('data-state', 'error');
  await expect(error).toContainText('版本不兼容');
  await expectOutsideWorkspace(page);
  expect(privateRequests).toEqual([]);
  compatible = true;
  await error.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(page.getByTestId('workspace-shell')).toBeVisible();
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
  await expect(error).toHaveCount(0);
});

test('已有健康成功缓存时，协议失败后的重连仍等待新的健康响应', async ({ page, daemon }) => {
  await page.goto(daemon.origin);
  const shell = page.getByTestId('workspace-shell');
  await expect(shell).toBeVisible();
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '运行状态', exact: true }).click();
  const connection = page.getByTestId('runtime-connection');
  await expect(connection).toHaveAttribute('data-state', 'ready');
  let compatible = false;
  const arrival = gate();
  const completion = gate();
  await page.route('**/api/health', async (route) => {
    if (compatible) {
      arrival.release();
      await completion.wait;
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const health: unknown = await response.json();
    if (typeof health !== 'object' || health === null || Array.isArray(health))
      throw new Error('The cached health fixture must return an object');
    await route.fulfill({ json: { ...health, protocolVersion: PROTOCOL_VERSION + 1 } });
  });
  try {
    await connection.getByRole('button', { name: '重新连接', exact: true }).click();
    const error = page.getByTestId('service-gate');
    await expect(error).toContainText('版本不兼容');
    await expect(connection).toHaveAttribute('data-state', 'error');
    await expect(shell).toHaveCount(0);
    compatible = true;
    await error.getByRole('button', { name: '重新连接', exact: true }).click();
    await arrival.wait;
    await expect(page.getByTestId('application-loading')).toHaveAttribute('data-stage', 'service');
    await expect(shell).toHaveCount(0);
    completion.release();
    await expect(shell).toBeVisible();
    await expect(page.getByTestId('application-loading')).toHaveCount(0);
    await expect(connection).toHaveAttribute('data-state', 'ready');
  } finally {
    completion.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('会话列表后台刷新和刷新失败不覆盖工作台，也不清空未发送草稿', async ({ page, daemon }) => {
  await page.clock.install();
  await page.goto(daemon.origin);
  const shell = page.getByTestId('workspace-shell');
  const input = page.getByLabel('消息', { exact: true });
  await expect(shell).toBeVisible();
  await input.fill('后台刷新期间保留这份私人草稿');
  const arrival = gate();
  const completion = gate();
  await page.route(
    '**/api/sessions',
    async (route) => {
      arrival.release();
      await completion.wait;
      await route.fulfill({
        status: 503,
        json: { code: 'SESSIONS_UNAVAILABLE', message: '会话列表暂时不可用' },
      });
    },
    { times: 1 },
  );
  try {
    await page.clock.fastForward(16_000);
    await arrival.wait;
    await expect(shell).toBeVisible();
    await expect(page.getByTestId('application-loading')).toHaveCount(0);
    await expect(input).toHaveValue('后台刷新期间保留这份私人草稿');
    const refreshed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/sessions' && response.status() === 503,
    );
    completion.release();
    await refreshed;
    await expect(shell).toBeVisible();
    await expect(page.getByTestId('application-loading')).toHaveCount(0);
    await expect(page.getByTestId('application-initialization-error')).toHaveCount(0);
    await expect(input).toHaveValue('后台刷新期间保留这份私人草稿');
  } finally {
    completion.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('后台401恢复有效登录后重新验证健康，不沿用上一授权周期的成功缓存', async ({
  page,
  daemon,
}) => {
  await page.clock.install();
  await page.goto(daemon.origin);
  const shell = page.getByTestId('workspace-shell');
  await expect(shell).toBeVisible();
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
  let authorizationChecks = 0;
  let healthChecks = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/auth/status') authorizationChecks += 1;
  });
  await page.route('**/api/health', async (route) => {
    healthChecks += 1;
    const response = await route.fetch();
    const health: unknown = await response.json();
    if (typeof health !== 'object' || health === null || Array.isArray(health))
      throw new Error('The restored authorization health fixture must return an object');
    await route.fulfill({ json: { ...health, protocolVersion: PROTOCOL_VERSION + 1 } });
  });
  await page.route(
    '**/api/sessions',
    (route) =>
      route.fulfill({
        status: 401,
        json: { code: 'APPLICATION_LOGIN_REQUIRED', message: '请重新验证登录状态' },
      }),
    { times: 1 },
  );
  try {
    expect(healthChecks).toBe(0);
    const unauthorized = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/sessions' && response.status() === 401,
    );
    await page.clock.fastForward(16_000);
    await unauthorized;
    const error = page.getByTestId('service-gate');
    await expect(error).toBeVisible();
    await expect(error).toContainText('版本不兼容');
    await expect(error.getByTestId('runtime-connection')).toHaveAttribute('data-state', 'error');
    expect(authorizationChecks).toBeGreaterThan(0);
    expect(healthChecks).toBeGreaterThan(0);
    await expectOutsideWorkspace(page);
    await expect(page.getByTestId('login-page')).toHaveCount(0);
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('统一加载适配浅色、深色及减少动态效果，并保留截图证据', async ({ page, daemon }, testInfo) => {
  await page.addInitScript(() => localStorage.removeItem('my-pi-harness.theme'));
  const modes = [
    { name: 'light', colorScheme: 'light', reducedMotion: 'no-preference' },
    { name: 'dark', colorScheme: 'dark', reducedMotion: 'no-preference' },
    { name: 'reduced-motion', colorScheme: 'dark', reducedMotion: 'reduce' },
  ] as const;
  try {
    for (const mode of modes) {
      await page.emulateMedia({ colorScheme: mode.colorScheme, reducedMotion: mode.reducedMotion });
      const settings = await holdRequest(page, '/api/settings');
      try {
        await page.goto(daemon.origin, { waitUntil: 'domcontentloaded' });
        await settings.arrived;
        const loading = page.getByTestId('application-loading');
        await expect(loading).toHaveAttribute('data-stage', 'workspace');
        await expect(loading).toHaveAttribute('role', 'status');
        await expectOutsideWorkspace(page);
        const runningAnimations = async (): Promise<number> =>
          await loading.evaluate(
            (element) =>
              element
                .getAnimations({ subtree: true })
                .filter((animation) => animation.playState === 'running').length,
          );
        if (mode.reducedMotion === 'reduce') await expect.poll(runningAnimations).toBe(0);
        else await expect.poll(runningAnimations).toBeGreaterThan(0);
        const screenshot = testInfo.outputPath(`application-loading-${mode.name}.png`);
        await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
        await testInfo.attach(`统一加载-${mode.name}`, {
          path: screenshot,
          contentType: 'image/png',
        });
        settings.release();
        await expect(page.getByTestId('workspace-shell')).toBeVisible();
      } finally {
        settings.release();
      }
    }
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
  }
});
