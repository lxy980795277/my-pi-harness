import type {
  APIRequestContext,
  BrowserContext,
  Locator,
  Page,
  Request,
  Route,
} from '@playwright/test';
import {
  AuthStatusSchema,
  ConnectionViewSchema,
  RemoteMcpViewSchema,
  McpToolCatalogSchema,
  SessionSnapshotSchema,
  SkillConnectionStatusSchema,
  type AuthStatus,
  type ConnectionView,
  type RemoteMcpView,
  type SkillConnectionStatus,
} from '@my-pi-harness/protocol';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { test, expect } from './fixture.js';
import { chooseConversationModel, openUserSettings, chooseOption } from './ui-controls.js';
import { configureTestProvider } from './model-fixtures.js';
import { startToolSequenceModel } from './m2-completion-model.js';

const GITHUB_CLIENT = 'synthetic-browser-oauth-client-github';
const GOOGLE_CLIENT = 'synthetic-browser-oauth-client-google';
const CLIENT_SECRET = 'synthetic-browser-oauth-secret';

for (const provider of [
  {
    id: 'github',
    name: 'GitHub',
    client: GITHUB_CLIENT,
    account: 'Browser connection account',
    apps: 1,
  },
  {
    id: 'google',
    name: 'Google',
    client: GOOGLE_CLIENT,
    account: 'Browser Google account',
    apps: 5,
  },
]) {
  test(`${provider.name} 插件由弹窗发起授权，凭据独立保存并供应用复用`, async ({
    page,
    daemon,
  }, testInfo) => {
    await interceptProviderAuthorizations(page.context());
    const detail = await installAndOpenPlugin(page, daemon.origin, provider.name);
    const panel = detail.getByRole('region', { name: '插件授权', exact: true });
    await expectSingleAuthorization(detail, panel);
    const loginBefore = await readLogin(page.request, daemon.origin);
    const other = await createManualTokenAccount(page.request, daemon.origin);
    const { popup, authorization } = await startPluginAuthorization(
      page,
      panel,
      daemon.origin,
      provider.id,
      provider.name,
      provider.client,
    );
    try {
      expect(authorization.searchParams.get('redirect_uri')).toBe(
        `${daemon.origin}/api/skill-connections/${provider.id}/oauth/callback`,
      );
      if (provider.id === 'github')
        expect(authorization.searchParams.get('scope')?.split(' ')).toEqual(['repo', 'user']);
      else {
        expect(authorization.searchParams.get('access_type')).toBe('offline');
        expect(authorization.searchParams.get('prompt')).toBe('consent');
        expect(authorization.searchParams.get('scope')?.split(' ')).toContain(
          'https://www.googleapis.com/auth/documents',
        );
      }
      await popup.goto(accountCallback(authorization).href);
      await expect(popup).toHaveURL(/\/skill-oauth\/result\?/u);
      await expect(
        popup.getByRole('heading', { name: `${provider.name} 已连接`, exact: true }),
      ).toBeVisible();
      await popup.screenshot({
        path: testInfo.outputPath(`${provider.id}-oauth-result.png`),
        fullPage: true,
      });
      await expect(panel).toContainText(`已连接 ${provider.account}`);
      await expect(panel.getByRole('button', { name: '断开授权', exact: true })).toBeVisible();
      const status = await readSkillStatus(page.request, daemon.origin, provider.id);
      expect(status.isConnected).toBe(true);
      expect(status.account?.displayName).toBe(provider.account);
      expect((await readLogin(page.request, daemon.origin)).user).toEqual(loginBefore.user);
      const accounts = await readConnections(page.request, daemon.origin);
      expect(accounts.map((entry) => entry.id)).toEqual([other.id]);
      const servers = await readRemoteServers(page.request, daemon.origin);
      expect(servers).toHaveLength(provider.apps);
      for (const server of servers) {
        expect(server.connectionId).toBeUndefined();
        expect(server.oauth).toBe(false);
        expect(server.enabled).toBe(false);
      }
      await expect(detail.getByRole('button', { name: '信任并启用', exact: true })).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(`${provider.id}-plugin-authorized.png`),
        fullPage: true,
      });
      await panel.getByRole('button', { name: '断开授权', exact: true }).click();
      await expect(panel.getByRole('button', { name: '授权', exact: true })).toBeEnabled();
      expect((await readSkillStatus(page.request, daemon.origin, provider.id)).isConnected).toBe(
        false,
      );
      expect((await readConnections(page.request, daemon.origin))[0]?.connected).toBe(true);
      expect((await readLogin(page.request, daemon.origin)).user).toEqual(loginBefore.user);
      await detail
        .getByRole('button', { name: `查看 ${servers[0]?.name ?? ''} 应用详情`, exact: true })
        .click();
      const app = page.getByRole('region', { name: '应用详情', exact: true });
      await expect(
        app.getByRole('button', { name: `返回 ${provider.name}`, exact: true }),
      ).toBeVisible();
      await expect(app).toContainText(`使用 ${provider.name} 插件授权`);
      await expect(app.getByRole('button', { name: '信任并启用', exact: true })).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(`${provider.id}-app-detail.png`),
        fullPage: true,
      });
    } finally {
      await popup.close();
    }
  });
}

test('GitHub 授权与应用目录跨重启恢复，未手动选工具也可搜索后直接调用', async ({
  page,
  daemon,
}, testInfo) => {
  await interceptProviderAuthorizations(page.context());
  const detail = await installAndOpenPlugin(page, daemon.origin, 'GitHub');
  const panel = detail.getByRole('region', { name: '插件授权', exact: true });
  const { popup, authorization } = await startPluginAuthorization(
    page,
    panel,
    daemon.origin,
    'github',
    'GitHub',
    GITHUB_CLIENT,
  );
  try {
    await popup.goto(accountCallback(authorization).href);
    await expect(panel).toContainText('已连接 Browser connection account');
  } finally {
    await popup.close();
  }
  await detail.getByRole('switch', { name: '启用 GitHub 应用', exact: true }).click();
  await expect
    .poll(async () => (await readRemoteServers(page.request, daemon.origin))[0]?.catalogStatus)
    .toBe('ready');
  const server = (await readRemoteServers(page.request, daemon.origin))[0];
  if (server === undefined) throw new Error('Missing GitHub App');
  const catalogReply = await page.request.get(
    `${daemon.origin}/api/mcp/remote-servers/${server.id}/tools`,
  );
  const catalog: unknown = await catalogReply.json();
  if (!catalogReply.ok() || !Value.Check(McpToolCatalogSchema, catalog))
    throw new Error('Missing GitHub catalog');
  const tool = catalog.tools.find((entry) => entry.remoteToolName === 'get_me');
  if (tool === undefined) throw new Error('Missing get_me definition');
  const model = await startToolSequenceModel(
    [
      {
        name: 'tool_search',
        arguments: { query: 'github 当前登录用户 账号信息 仓库列表', limit: 8 },
      },
      { name: tool.name, arguments: {} },
    ],
    '已读取 GitHub 账号 browser-github-user。',
  );
  try {
    await configureTestProvider(page, model.origin);
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await daemon.restart();
    await page.reload();
    expect((await readSkillStatus(page.request, daemon.origin, 'github')).isConnected).toBe(true);
    await expect
      .poll(async () => (await readRemoteServers(page.request, daemon.origin))[0]?.catalogStatus)
      .toBe('ready');
    await chooseConversationModel(page, 'Queue Model', 'Chat');
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '执行批准方式', exact: true }),
      '完全访问权限',
    );
    const accepted = page.waitForResponse(
      (reply) =>
        reply.request().method() === 'POST' && new URL(reply.url()).pathname.endsWith('/inputs'),
    );
    await page.getByLabel('消息', { exact: true }).fill('看一下我的 GitHub 当前账号');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const reply = await accepted;
    const snapshot: unknown = await reply.json();
    if (!reply.ok() || !Value.Check(SessionSnapshotSchema, snapshot))
      throw new Error('GitHub input was not accepted');
    expect(snapshot.runs[0]?.mcpTools).toEqual([]);
    await expect(
      page.getByText('已读取 GitHub 账号 browser-github-user。', { exact: true }),
    ).toBeVisible();
    expect(model.requests).toHaveLength(3);
    expect(JSON.stringify(model.requests[0]?.body['tools'])).not.toContain(tool.name);
    expect(JSON.stringify(model.requests[1]?.body['tools'])).toContain(tool.name);
    expect(JSON.stringify(model.requests[2]?.body['messages'])).toContain('browser-github-user');
    expect(JSON.stringify(model.requests.map((request) => request.body))).not.toContain(
      'synthetic-browser-connection-token',
    );
    const journal = await page.request.get(
      `${daemon.origin}/api/sessions/${snapshot.session.id}/log`,
    );
    expect(journal.ok()).toBe(true);
    const content = await journal.text();
    expect(content).toContain('run.tools_loaded');
    expect(content).toContain('browser-github-user');
    expect(content).not.toContain('synthetic-browser-connection-token');
    await page.screenshot({
      path: testInfo.outputPath('github-search-after-restart.png'),
      fullPage: true,
    });
  } finally {
    await model.close();
  }
});

test('GitHub 授权失败显示具体固定提示且不回显供应商描述或授权参数', async ({
  page,
  daemon,
}, testInfo) => {
  await interceptProviderAuthorizations(page.context());
  const detail = await installAndOpenPlugin(page, daemon.origin, 'GitHub');
  const panel = detail.getByRole('region', { name: '插件授权', exact: true });
  const { popup, authorization } = await startPluginAuthorization(
    page,
    panel,
    daemon.origin,
    'github',
    'GitHub',
    GITHUB_CLIENT,
  );
  try {
    const callback = accountCallback(authorization);
    callback.searchParams.delete('code');
    callback.searchParams.set('error', 'access_denied');
    callback.searchParams.set('error_description', 'private-upstream-description-and-token');
    await popup.goto(callback.href);
    await expect(
      popup.getByRole('heading', { name: 'GitHub 连接失败', exact: true }),
    ).toBeVisible();
    await expect(
      popup.getByText('校验授权回调失败：用户或服务拒绝了授权。', { exact: true }),
    ).toBeVisible();
    const resultUrl = new URL(popup.url());
    expect(resultUrl.pathname).toBe('/skill-oauth/result');
    expect(resultUrl.searchParams.has('code')).toBe(false);
    expect(resultUrl.searchParams.has('state')).toBe(false);
    expect(decodeURIComponent(popup.url())).not.toContain('private-upstream');
    expect(await popup.locator('body').innerText()).not.toContain('private-upstream');
    expect((await readSkillStatus(page.request, daemon.origin, 'github')).isConnected).toBe(false);
    await popup.screenshot({
      path: testInfo.outputPath('github-oauth-specific-failure.png'),
      fullPage: true,
    });
  } finally {
    await popup.close();
  }
});

test('关闭插件授权窗口后停止轮询并恢复单一授权入口', async ({ page, daemon }) => {
  await page.clock.install();
  await interceptProviderAuthorizations(page.context());
  const detail = await installAndOpenPlugin(page, daemon.origin, 'GitHub');
  const panel = detail.getByRole('region', { name: '插件授权', exact: true });
  const first = await startPluginAuthorization(
    page,
    panel,
    daemon.origin,
    'github',
    'GitHub',
    GITHUB_CLIENT,
  );
  let reads = 0;
  const count = (request: Request): void => {
    if (new URL(request.url()).pathname === '/api/skill-connections/github') reads += 1;
  };
  page.on('request', count);
  try {
    await first.popup.close();
    await page.clock.runFor(600);
    await expect(panel.getByRole('button', { name: '授权', exact: true })).toBeEnabled();
    const settled = reads;
    await page.clock.runFor(3000);
    expect(reads).toBe(settled);
    expect((await readSkillStatus(page.request, daemon.origin, 'github')).isConnected).toBe(false);
    const second = await startPluginAuthorization(
      page,
      panel,
      daemon.origin,
      'github',
      'GitHub',
      GITHUB_CLIENT,
    );
    try {
      expect(second.authorization.searchParams.get('state')).not.toBe(
        first.authorization.searchParams.get('state'),
      );
    } finally {
      await second.popup.close();
    }
  } finally {
    page.off('request', count);
    await first.popup.close();
  }
});

test('插件弹窗被拦截时不发送授权请求，也不创建服务账户', async ({ page, daemon }) => {
  await page.addInitScript(() => {
    window.open = (): null => null;
  });
  const detail = await installAndOpenPlugin(page, daemon.origin, 'GitHub');
  const panel = detail.getByRole('region', { name: '插件授权', exact: true });
  let starts = 0;
  const count = (request: Request): void => {
    if (new URL(request.url()).pathname === '/api/skill-connections/github/oauth') starts += 1;
  };
  page.context().on('request', count);
  try {
    await panel.getByRole('button', { name: '授权', exact: true }).click();
    await expect(panel).toContainText('浏览器阻止了授权窗口，请允许弹窗后重试。');
    await expect(panel.getByRole('button', { name: '授权', exact: true })).toBeEnabled();
    expect(starts).toBe(0);
    expect(await readConnections(page.request, daemon.origin)).toHaveLength(0);
  } finally {
    page.context().off('request', count);
  }
});

test('未配置 OAuth 客户端时在启动页说明错误，不向用户展示配置表单', async ({ page, daemon }) => {
  const detail = await installAndOpenPlugin(page, daemon.origin, 'Notion');
  const panel = detail.getByRole('region', { name: '插件授权', exact: true });
  await expectSingleAuthorization(detail, panel);
  const opened = page.waitForEvent('popup');
  await panel.getByRole('button', { name: '授权', exact: true }).click();
  const popup = await opened;
  try {
    await expect(
      popup.getByRole('heading', { name: 'Notion 授权启动失败', exact: true }),
    ).toBeVisible();
    await expect(popup.getByRole('status')).toContainText('OAuth');
    await expect(popup.getByLabel('OAuth Client ID', { exact: true })).toHaveCount(0);
    await popup.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await expect(panel.getByRole('button', { name: '授权', exact: true })).toBeEnabled();
    expect(await readConnections(page.request, daemon.origin)).toHaveLength(0);
  } finally {
    await popup.close();
  }
});

test('桌面一次性入口在未登录浏览器中自行启动并先清理 URL 凭据', async ({
  page,
  daemon,
  browser,
}) => {
  await installAndOpenPlugin(page, daemon.origin, 'GitHub');
  const login = await readLogin(page.request, daemon.origin);
  if (login.csrfToken === null) throw new Error('Missing desktop fixture CSRF');
  const response = await page.request.post(
    `${daemon.origin}/api/skill-connections/github/oauth/launch-ticket`,
    {
      headers: { Origin: daemon.origin, 'X-CSRF-Token': login.csrfToken },
      data: {},
    },
  );
  expect(response.ok()).toBe(true);
  const ticket: unknown = await response.json();
  if (
    typeof ticket !== 'object' ||
    ticket === null ||
    !('launchUrl' in ticket) ||
    typeof ticket.launchUrl !== 'string'
  )
    throw new Error('Missing desktop launch URL');
  const isolated = await browser.newContext();
  await interceptProviderAuthorizations(isolated);
  const popup = await isolated.newPage();
  const arrived = createGate();
  const release = createGate();
  await isolated.route('**/api/skill-connections/github/oauth/launch', async (route) => {
    expect(route.request().method()).toBe('POST');
    arrived.open();
    await release.wait;
    await route.continue();
  });
  try {
    await popup.goto(ticket.launchUrl);
    await arrived.wait;
    expect(new URL(popup.url()).hash).toBe('');
    await expect(
      popup.getByRole('heading', { name: '正在打开授权页面', exact: true }),
    ).toBeVisible();
    expect((await isolated.cookies()).length).toBe(0);
    release.open();
    await popup.waitForURL(
      (url) => url.origin + url.pathname === 'https://github.com/login/oauth/authorize',
    );
    expect(new URL(popup.url()).searchParams.get('client_id')).toBe(GITHUB_CLIENT);
  } finally {
    release.open();
    await isolated.close();
  }
});

test('独立 MCP 应用使用紧凑入口与二级详情，弹窗负责启动授权', async ({ page, daemon }) => {
  await page.clock.install();
  const detail = await installAndOpenPlugin(page, daemon.origin, 'Notion');
  const installed = (await readRemoteServers(page.request, daemon.origin))[0];
  if (installed === undefined) throw new Error('Missing independent MCP App');
  const server = { ...installed, enabled: true, trusted: true, oauth: true, oauthConnected: false };
  await page.route('**/api/mcp/remote-servers', async (route) => {
    await route.fulfill({ json: [server] });
  });
  await page.context().route(`**/api/mcp/remote-servers/${server.id}`, async (route) => {
    await route.fulfill({ json: server });
  });
  let starts = 0;
  await page
    .context()
    .route(`**/api/mcp/remote-servers/${server.id}/oauth/start`, async (route) => {
      starts += 1;
      expect(route.request().postDataJSON()).toEqual({
        expectedRevision: server.revision,
        expectedAccessEpoch: server.accessEpoch,
      });
      await route.fulfill({
        json: {
          url: `https://example.com/oauth/authorize?state=synthetic-${starts}`,
          state: `synthetic-${starts}`,
          expiresAt: Date.now() + 600_000,
        },
      });
    });
  await page.context().route('https://example.com/oauth/authorize?*', async (route) => {
    await route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic MCP provider</h1>' });
  });
  await detail.getByRole('button', { name: '返回插件市场', exact: true }).click();
  await page.getByRole('button', { name: '查看 Notion 插件详情', exact: true }).click();
  const authorize = detail.getByRole('button', { name: '授权 Notion', exact: true });
  await expect(authorize).toBeEnabled();
  const opened = page.waitForEvent('popup');
  await authorize.click();
  const popup = await opened;
  try {
    await popup.waitForURL(/https:\/\/example\.com\/oauth\/authorize/u);
    expect(starts).toBe(1);
    await expect(detail.getByRole('button', { name: '授权 Notion', exact: true })).toHaveText(
      '等待授权',
    );
    await popup.close();
    await page.clock.runFor(600);
    await expect(authorize).toHaveText('授权');
    await detail.getByRole('button', { name: '查看 Notion 应用详情', exact: true }).click();
    const app = page.getByRole('region', { name: '应用详情', exact: true });
    await expect(app.getByRole('button', { name: '返回 Notion', exact: true })).toBeVisible();
    await expect(app).toContainText('需要完成 OAuth 授权后才能使用。');
    for (const name of ['信任并启用', '取消应用授权', '重新打开授权页面'])
      await expect(app.getByRole('button', { name, exact: true })).toHaveCount(0);
  } finally {
    await popup.close();
  }
});

async function expectSingleAuthorization(detail: Locator, panel: Locator): Promise<void> {
  await expect(panel.getByRole('button', { name: '授权', exact: true })).toBeVisible();
  for (const name of ['添加账户', '关联到插件应用', '取消授权', '重新打开授权页面'])
    await expect(detail.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(detail.getByRole('combobox', { name: '插件服务账户', exact: true })).toHaveCount(0);
  await expect(detail.getByLabel('OAuth Client ID', { exact: true })).toHaveCount(0);
  await expect(detail.getByLabel('OAuth Client Secret', { exact: true })).toHaveCount(0);
}

async function installAndOpenPlugin(page: Page, origin: string, name: string): Promise<Locator> {
  await page.goto(origin);
  await openUserSettings(page);
  await page.getByRole('tab', { name: '插件', exact: true }).click();
  const card = page.getByRole('region', { name: `${name} 插件`, exact: true });
  await card.getByRole('button', { name: '安装', exact: true }).click();
  await expect(card.getByRole('button', { name: '卸载', exact: true })).toBeVisible();
  await card.getByRole('button', { name: `查看 ${name} 插件详情`, exact: true }).click();
  return page.getByRole('region', { name: '插件详情', exact: true });
}

async function startPluginAuthorization(
  page: Page,
  panel: Locator,
  origin: string,
  service: string,
  name: string,
  clientId: string,
): Promise<{ popup: Page; authorization: URL }> {
  const routePath = `**/api/skill-connections/${service}/oauth`;
  const arrived = createGate();
  const release = createGate();
  let starts = 0;
  let requestPage: Page | null = null;
  const holdStart = async (route: Route): Promise<void> => {
    starts += 1;
    requestPage = route.request().frame().page();
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({});
    arrived.open();
    await release.wait;
    await route.continue();
  };
  await page.context().route(routePath, holdStart);
  const opened = page.waitForEvent('popup');
  await panel.getByRole('button', { name: '授权', exact: true }).click();
  const popup = await opened;
  try {
    await arrived.wait;
    expect(requestPage).toBe(popup);
    await expect(popup).toHaveURL(`${origin}/skill-oauth/${service}/launch?name=${name}`);
    await expect(
      popup.getByRole('heading', { name: '正在打开授权页面', exact: true }),
    ).toBeVisible();
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    release.open();
    await popup.waitForURL((url) => url.protocol === 'https:');
    const authorization = new URL(popup.url());
    await expect(
      popup.getByRole('heading', { name: 'Synthetic provider authorization', exact: true }),
    ).toBeVisible();
    expect(authorization.searchParams.get('client_id')).toBe(clientId);
    expect(authorization.searchParams.get('response_type')).toBe('code');
    expect(authorization.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32,}$/u);
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(authorization.searchParams.has('client_secret')).toBe(false);
    expect(authorization.searchParams.has('code_verifier')).toBe(false);
    expect(page.url()).toBe(origin + '/');
    await expect(panel.getByRole('button', { name: '等待授权', exact: true })).toBeDisabled();
    expect(starts).toBe(1);
    return { popup, authorization };
  } catch (error: unknown) {
    await popup.close();
    throw error;
  } finally {
    release.open();
    await page.context().unroute(routePath, holdStart);
  }
}

async function interceptProviderAuthorizations(context: BrowserContext): Promise<void> {
  for (const endpoint of [
    'https://github.com/login/oauth/authorize?*',
    'https://accounts.google.com/o/oauth2/v2/auth?*',
  ]) {
    await context.route(endpoint, async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><h1>Synthetic provider authorization</h1></body></html>',
      });
    });
  }
}

function accountCallback(authorization: URL): URL {
  const redirect = authorization.searchParams.get('redirect_uri');
  const state = authorization.searchParams.get('state');
  if (redirect === null || state === null) throw new Error('Missing plugin callback');
  const callback = new URL(redirect);
  callback.searchParams.set(
    'code',
    `synthetic-browser-oauth-code-${authorization.searchParams.get('code_challenge') ?? ''}`,
  );
  callback.searchParams.set('state', state);
  const issuers = new Map([
    ['github.com', 'https://github.com/login/oauth'],
    ['accounts.google.com', 'https://accounts.google.com'],
  ]);
  const issuer = issuers.get(authorization.hostname);
  if (issuer === undefined) throw new Error('Missing synthetic provider issuer');
  callback.searchParams.set('iss', issuer);
  return callback;
}

function createGate(): { wait: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

async function readLogin(request: APIRequestContext, origin: string): Promise<AuthStatus> {
  const response = await request.get(`${origin}/api/auth/status`);
  const value: unknown = await response.json();
  if (!response.ok() || !Value.Check(AuthStatusSchema, value))
    throw new Error('Invalid application login');
  return value;
}

async function readSkillStatus(
  request: APIRequestContext,
  origin: string,
  id: string,
): Promise<SkillConnectionStatus> {
  const response = await request.get(`${origin}/api/skill-connections/${id}`);
  const text = await response.text();
  expect(text).not.toContain(CLIENT_SECRET);
  expect(text).not.toContain('accessToken');
  expect(text).not.toContain('refreshToken');
  const value: unknown = JSON.parse(text);
  if (!response.ok() || !Value.Check(SkillConnectionStatusSchema, value))
    throw new Error('Invalid plugin authorization status');
  return value;
}

async function createManualTokenAccount(
  request: APIRequestContext,
  origin: string,
): Promise<ConnectionView> {
  const status = await readLogin(request, origin);
  if (status.csrfToken === null) throw new Error('Missing fixture CSRF');
  const headers = { Origin: origin, 'X-CSRF-Token': status.csrfToken };
  const created = await request.post(`${origin}/api/connections`, {
    headers,
    data: {
      serviceId: 'github',
      name: 'Other manual account',
      authMode: 'token',
      clientId: '',
      scopes: [],
    },
  });
  const account: unknown = await created.json();
  if (!created.ok() || !Value.Check(ConnectionViewSchema, account))
    throw new Error('Invalid manual account');
  const saved = await request.post(`${origin}/api/connections/${account.id}/token`, {
    headers,
    data: {
      expectedRevision: account.revision,
      expectedAccessEpoch: account.accessEpoch,
      value: 'synthetic-browser-connection-token-second',
    },
  });
  const connected: unknown = await saved.json();
  if (!saved.ok() || !Value.Check(ConnectionViewSchema, connected))
    throw new Error('Invalid connected manual account');
  return connected;
}

async function readConnections(
  request: APIRequestContext,
  origin: string,
): Promise<ConnectionView[]> {
  const response = await request.get(`${origin}/api/connections`);
  const value: unknown = await response.json();
  if (!response.ok() || !Value.Check(Type.Array(ConnectionViewSchema), value))
    throw new Error('Invalid manual accounts');
  return value;
}

async function readRemoteServers(
  request: APIRequestContext,
  origin: string,
): Promise<RemoteMcpView[]> {
  const response = await request.get(`${origin}/api/mcp/remote-servers`);
  const value: unknown = await response.json();
  if (!response.ok() || !Value.Check(Type.Array(RemoteMcpViewSchema), value))
    throw new Error('Invalid App configurations');
  return value;
}
