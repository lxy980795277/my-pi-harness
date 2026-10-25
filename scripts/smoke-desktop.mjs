import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const executable =
  process.platform === 'darwin'
    ? join(
        root,
        'release',
        process.arch === 'arm64' ? 'mac-arm64' : 'mac',
        'My Pi Harness.app',
        'Contents',
        'MacOS',
        'My Pi Harness',
      )
    : process.platform === 'win32'
      ? join(
          root,
          'release',
          process.arch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked',
          'My Pi Harness.exe',
        )
      : join(
          root,
          'release',
          process.arch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked',
          'my-pi-harness',
        );
await access(executable);
const resources =
  process.platform === 'darwin'
    ? join(dirname(executable), '..', 'Resources')
    : join(dirname(executable), 'resources');
async function checkResourceLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = relative(resources, await realpath(path));
      assert(
        !isAbsolute(target) &&
          target !== '..' &&
          !target.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`),
        `Resource link escapes the app: ${path}`,
      );
    } else if (entry.isDirectory()) {
      await checkResourceLinks(path);
    }
  }
}
await checkResourceLinks(resources);
await access(
  join(
    resources,
    'daemon',
    'node_modules',
    '@my-pi-harness',
    'integrations',
    'resources',
    'plugins',
    'github',
    'skills',
    'github',
    'SKILL.md',
  ),
);
await access(
  join(
    resources,
    'daemon',
    'node_modules',
    '@my-pi-harness',
    'execution',
    'resources',
    'office',
    'runner.py',
  ),
);
const temporary = await mkdtemp(join(tmpdir(), 'my-pi-harness-desktop-'));
const { openProfileStore } = await import('../packages/storage/dist/index.js');
const profileDirectory =
  process.platform === 'win32'
    ? join(temporary, 'My Pi Harness', 'profiles', 'default')
    : join(temporary, 'profiles', 'default');
const fixtureLocalToken = randomBytes(32).toString('base64url');
const fixtureLoginToken = randomBytes(32).toString('base64url');
const digest = (token) => createHash('sha256').update(token).digest('hex');
// Test-owned profile seeding keeps the shipped application free of authentication bypasses.
const fixtureStore = await openProfileStore(profileDirectory, {
  sessionLogRoot: join(temporary, '.my-pi-harness'),
});
try {
  const createdAt = Date.now();
  const client = fixtureStore.auth.createLocalClient({
    id: randomUUID(),
    tokenHash: digest(fixtureLocalToken),
    csrfToken: randomBytes(32).toString('base64url'),
    createdAt,
    expiresAt: createdAt + 90 * 24 * 3600 * 1000,
  });
  fixtureStore.auth.completeLogin(
    {
      providerId: 'github',
      issuer: 'https://github.com',
      subject: '90000001',
      name: 'Desktop Smoke',
      avatarUrl: null,
    },
    client.id,
    {
      id: randomUUID(),
      tokenHash: digest(fixtureLoginToken),
      createdAt,
      expiresAt: createdAt + 30 * 24 * 3600 * 1000,
    },
  );
} finally {
  fixtureStore.close();
}
const output = join(root, 'output', 'playwright');
await mkdir(output, { recursive: true });
let application;
let stderr = '';
const env = {
  ...process.env,
  ...(process.platform === 'win32' ? { LOCALAPPDATA: temporary } : {}),
  MY_PI_HARNESS_NODE_PATH: '/missing-development-node',
  MY_PI_HARNESS_RENDERER_URL: 'http://127.0.0.1:1',
  MY_PI_HARNESS_DEVELOPMENT_ORIGIN: 'http://127.0.0.1:5174',
  MY_PI_HARNESS_SESSION_LOG_ROOT: join(temporary, '.my-pi-harness'),
};
delete env['ELECTRON_RUN_AS_NODE'];
try {
  application = await electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${temporary}`],
    cwd: temporary,
    timeout: 30_000,
    env,
  });
  application.process().stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const page = await application.firstWindow();
  const policyErrors = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) policyErrors.push(message.text());
  });
  assert.deepEqual(
    await application.evaluate(({ app }) => ({
      version: app.getVersion(),
      packaged: app.isPackaged,
    })),
    { version, packaged: true },
  );
  const userData = await application.evaluate(({ app }) => app.getPath('userData'));
  assert.equal(
    await realpath(userData),
    await realpath(temporary),
    'Smoke profile must be isolated',
  );
  const initialStatus = await page.evaluate(async () => (await fetch('/api/auth/status')).json());
  assert.equal(initialStatus.localAuthorized, true);
  assert.equal(initialStatus.authenticated, false);
  await expect(page.getByTestId('login-page')).toBeVisible();
  await expect(page.getByTestId('workspace-shell')).toHaveCount(0);
  assert.equal(await page.evaluate(async () => (await fetch('/api/sessions')).status), 401);
  await page.screenshot({ path: join(output, 'desktop-login.png'), fullPage: true });
  await application.evaluate(
    async ({ session }, credentials) => {
      for (const [name, value] of Object.entries(credentials.values)) {
        await session.defaultSession.cookies.set({
          url: credentials.origin,
          name,
          value,
          path: '/api',
          httpOnly: true,
          sameSite: 'strict',
          expirationDate: Date.now() / 1000 + 30 * 24 * 3600,
        });
      }
    },
    {
      origin: new URL(page.url()).origin,
      values: { my_pi_local: fixtureLocalToken, my_pi_session: fixtureLoginToken },
    },
  );
  await page.reload();
  await expect(page.getByTestId('workspace-shell')).toBeVisible();
  const status = await page.evaluate(async () => (await fetch('/api/auth/status')).json());
  assert.equal(status.authenticated, true);
  assert.equal(status.user.name, 'Desktop Smoke');
  const documentResult = await page.evaluate(async (csrfToken) => {
    const uploaded = await fetch('/api/attachments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({
        name: 'packaged.rtf',
        mediaType: 'application/rtf',
        data: btoa('{\\rtf1\\ansi Packaged document parser works}'),
      }),
    });
    if (!uploaded.ok) throw new Error(`Packaged document upload failed: ${uploaded.status}`);
    const attachment = await uploaded.json();
    const content = await fetch(`/api/attachments/${encodeURIComponent(attachment.id)}/content`);
    if (!content.ok) throw new Error('Packaged document preview failed');
    return await content.json();
  }, status.csrfToken);
  assert.equal(documentResult.attachment.kind, 'document');
  assert.match(documentResult.text, /Packaged document parser works/);

  const providers = await page.evaluate(async () => (await fetch('/api/providers/catalog')).json());
  assert.equal(
    providers.length,
    6,
    'Bundled Node must load the selected native provider factories',
  );
  await page.getByRole('button', { name: '用户信息，打开菜单', exact: true }).click();
  await page
    .getByRole('dialog', { name: '用户菜单', exact: true })
    .getByRole('button', { name: '设置', exact: true })
    .click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('tab', { name: '模型', exact: true }).click();
  await expect(settings.getByRole('switch')).toHaveCount(6);
  await settings
    .getByRole('region', { name: 'OpenAI', exact: true })
    .getByRole('button', { name: '配置', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: '配置 OpenAI', exact: true });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await page.screenshot({ path: join(output, 'desktop-settings.png'), fullPage: true });
  assert.deepEqual(policyErrors, [], 'Settings styles must satisfy the packaged CSP');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  const workspaceDirectory = join(temporary, 'workspace');
  await mkdir(workspaceDirectory);
  await page.getByRole('button', { name: '添加工作区', exact: true }).click();
  const workspaceDialog = page.getByRole('dialog', { name: '添加工作区', exact: true });
  await expect(workspaceDialog.getByRole('textbox')).toHaveCount(1);
  await workspaceDialog.getByRole('button', { name: '选择工作区图标', exact: true }).click();
  await page.getByRole('button', { name: '使用代码图标', exact: true }).click();
  const dropzone = page.getByTestId('workspace-directory-dropzone');
  const bounds = await dropzone.boundingBox();
  assert(bounds, 'The directory drop surface must be visible');
  const input = await page.context().newCDPSession(page);
  try {
    // Chromium supplies disk-backed File objects; the real preload and main validate the directory.
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await input.send('Input.dispatchDragEvent', {
        type,
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
        data: { items: [], files: [workspaceDirectory], dragOperationsMask: 1 },
      });
    }
  } finally {
    await input.detach();
  }
  await expect(
    workspaceDialog.getByText(await realpath(workspaceDirectory), { exact: true }),
  ).toBeVisible();
  await workspaceDialog.getByLabel('工作区名称', { exact: true }).fill('桌面目录验证');
  await workspaceDialog.getByRole('button', { name: '保存工作区', exact: true }).click();
  await expect(workspaceDialog).not.toBeVisible();
  const workspaceGroup = page.getByRole('group', { name: '桌面目录验证', exact: true });
  await expect(workspaceGroup.locator('[data-workspace-icon="code"]')).toHaveCount(1);
  assert.deepEqual(policyErrors, [], 'Workspace icon styles must satisfy the packaged CSP');
  const syntheticFile = await page.evaluate(`(async () => {
    try { await window.desktop.getDroppedWorkspaceDirectory(new File([], 'synthetic')); return 'unexpected success'; }
    catch (error) { return error.message; }
  })()`);
  assert.match(syntheticFile, /请拖入本机文件夹/);
  await page.getByRole('button', { name: '运行状态', exact: true }).click();
  await expect(page.getByTestId('runtime-connection')).toHaveAttribute('data-state', 'ready');
  const origin = new URL(page.url()).origin;
  const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5_000) });
  const health = await response.json();
  const developmentOrigin = await fetch(`${origin}/api/auth/status`, {
    headers: { Origin: 'http://127.0.0.1:5174' },
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(
    developmentOrigin.status,
    403,
    'Packaged services must reject the development origin',
  );
  assert.equal(health.appVersion, version);
  assert.equal(health.nodeVersion, (await readFile(join(root, '.node-version'), 'utf8')).trim());
  const bridge = await page.evaluate(`(async () => ({
    keys: Object.keys(window.desktop), info: await window.desktop.getInfo(),
    require: 'require' in window, process: 'process' in window
  }))()`);
  assert.deepEqual(
    bridge.keys.sort(),
    [
      'chooseWorkspaceDirectory',
      'getInfo',
      'getDroppedWorkspaceDirectory',
      'openAuth',
      'openExternal',
      'revealSkillDirectory',
    ].sort(),
  );
  assert.deepEqual(bridge.info, { appVersion: version, platform: process.platform });
  assert.equal(bridge.require, false);
  assert.equal(bridge.process, false);
  const missingSkill = await page.evaluate(`(async () => {
    try { await window.desktop.revealSkillDirectory('missing-registered-skill', null); return 'unexpected success'; }
    catch (error) { return error.message; }
  })()`);
  assert.match(missingSkill, /Skill目录不可用/);
  for (const url of [
    'javascript:alert(1)',
    'file:///tmp/private',
    'data:text/html,test',
    'https://user:password@example.invalid/',
    'https://example.invalid/\r\n',
  ]) {
    const rejection = await page.evaluate(
      `(async () => {
        try { await window.desktop.openExternal(${JSON.stringify(url)}); return 'unexpected success'; }
        catch (error) { return error.message; }
      })()`,
    );
    assert.match(rejection, /链接地址无效|仅支持 HTTP 或 HTTPS 链接/);
  }
  const arbitraryUrl = await page.evaluate(
    `(async () => { try { await window.desktop.openAuth('https://example.com/'); return 'unexpected success'; } catch (error) { return error.message; } })()`,
  );
  assert.match(arbitraryUrl, /认证流程参数无效/);
  const missingFlow = await page.evaluate(
    `(async () => { try { await window.desktop.openAuth('missing-flow'); return 'unexpected success'; } catch (error) { return error.message; } })()`,
  );
  assert.match(missingFlow, /认证流程不可用/);
  const preferences = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.nodeIntegration, false);
  await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true });

  const [rogueWindow] = await Promise.all([
    application.waitForEvent('window'),
    application.evaluate(async ({ app, BrowserWindow }) => {
      const original = BrowserWindow.getAllWindows()[0];
      const preload = `${app.getAppPath()}/dist/preload/index.cjs`;
      const rogue = new BrowserWindow({
        show: false,
        webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      await rogue.loadURL(original.webContents.getURL());
    }),
  ]);
  await rogueWindow.waitForFunction('typeof window.desktop === "object"');
  const rejection = await rogueWindow.evaluate(`(async () => {
    try { await window.desktop.getInfo(); return 'unexpected success'; }
    catch (error) { return error.message; }
  })()`);
  const authRejection = await rogueWindow.evaluate(
    `(async () => { try { await window.desktop.openAuth('missing-flow'); return 'unexpected success'; } catch (error) { return error.message; } })()`,
  );
  const externalRejection = await rogueWindow.evaluate(
    `(async () => { try { await window.desktop.openExternal('https://example.invalid/blocked'); return 'unexpected success'; } catch (error) { return error.message; } })()`,
  );
  assert.match(authRejection, /桌面请求来源无效/);
  assert.match(externalRejection, /桌面请求来源无效/);
  assert.match(rejection, /桌面请求来源无效/, 'Untrusted windows must not call the desktop bridge');
  await application.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.close();
  });
  await application.close();
  application = undefined;
  const shutdown = stderr
    .split('\n')
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    })
    .find(
      (record) => record?.instanceId === health.instanceId && record?.msg === 'Stopping daemon',
    );
  assert.equal(shutdown?.reason, 'owner requested shutdown');
  assert.equal(typeof shutdown?.pid, 'number');
  await expect
    .poll(
      () => {
        try {
          process.kill(shutdown.pid, 0);
          return false;
        } catch (error) {
          if (error.code === 'ESRCH') return true;
          throw error;
        }
      },
      { timeout: 5_000 },
    )
    .toBe(true);
  await assert.rejects(
    fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2_000) }),
    (error) => error.cause?.code === 'ECONNREFUSED',
  );
  process.stdout.write(
    `Packaged desktop smoke passed (${process.platform}/${process.arch}, app ${version}, Node ${health.nodeVersion}).\n`,
  );
} catch (error) {
  process.stderr.write(stderr);
  throw error;
} finally {
  await application?.close();
  await rm(temporary, { recursive: true, force: true });
}
