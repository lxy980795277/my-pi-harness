import assert from 'node:assert/strict';
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
const temporary = await mkdtemp(join(tmpdir(), 'my-pi-harness-desktop-'));
const output = join(root, 'output', 'playwright');
await mkdir(output, { recursive: true });
let application;
let stderr = '';
const env = {
  ...process.env,
  MY_PI_HARNESS_NODE_PATH: '/missing-development-node',
  MY_PI_HARNESS_RENDERER_URL: 'http://127.0.0.1:1',
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
  assert.deepEqual(
    await application.evaluate(({ app }) => ({
      version: app.getVersion(),
      packaged: app.isPackaged,
    })),
    { version, packaged: true },
  );
  await expect(page.getByTestId('runtime-connection')).toHaveAttribute('data-state', 'ready');
  const origin = new URL(page.url()).origin;
  const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5_000) });
  const health = await response.json();
  assert.equal(health.appVersion, version);
  assert.equal(health.nodeVersion, (await readFile(join(root, '.node-version'), 'utf8')).trim());
  const bridge = await page.evaluate(`(async () => ({
    keys: Object.keys(window.desktop), info: await window.desktop.getInfo(),
    require: 'require' in window, process: 'process' in window
  }))()`);
  assert.deepEqual(bridge.keys, ['getInfo']);
  assert.deepEqual(bridge.info, { appVersion: version, platform: process.platform });
  assert.equal(bridge.require, false);
  assert.equal(bridge.process, false);
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
