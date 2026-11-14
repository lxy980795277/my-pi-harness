import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
import { openProfileStore } from '@my-pi-harness/storage';
import { run } from './node-runtime.mjs';
import release from './desktop-release.cjs';
import signing from './verify-desktop-signing.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
release.desktopBuildArguments(['installer'], process.platform, process.arch);
const { mode } = release.desktopSigningMode(process.env);
const artifact = join(
  root,
  'release',
  `My-Pi-Harness-${version}-${process.platform === 'darwin' ? 'mac' : 'win'}-${process.arch}-${mode}.${process.platform === 'darwin' ? 'dmg' : 'exe'}`,
);
await access(artifact);
await signing.verifyDesktopInstallers([artifact]);
const artifactHash = createHash('sha256');
for await (const bytes of createReadStream(artifact)) artifactHash.update(bytes);
const artifactSha256 = artifactHash.digest('hex');
const artifactBytes = (await stat(artifact)).size;
const directory = await mkdtemp(join(tmpdir(), 'my-pi-install-中文 空格-'));
const volume = join(directory, '安装卷');
const installed = join(directory, '安装位置');
const executable =
  process.platform === 'darwin'
    ? join(installed, 'My Pi Harness.app', 'Contents', 'MacOS', 'My Pi Harness')
    : join(installed, 'My Pi Harness.exe');
let mounted = false;
let windowsUninstalled = false;

async function uninstallWindowsCandidate() {
  if (windowsUninstalled) return;
  const uninstaller = join(installed, 'Uninstall My Pi Harness.exe');
  try {
    await access(uninstaller);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  await run(uninstaller, ['/S'], { timeout: 120_000 });
  await expect
    .poll(
      async () => {
        try {
          await access(executable);
          return false;
        } catch (error) {
          if (error.code === 'ENOENT') return true;
          throw error;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  windowsUninstalled = true;
}

async function install() {
  if (process.platform === 'darwin') {
    await rm(installed, { recursive: true, force: true });
    await mkdir(installed);
    await cp(join(volume, 'My Pi Harness.app'), join(installed, 'My Pi Harness.app'), {
      recursive: true,
      dereference: false,
      // Dependency links stay relative to the copied app, not the mounted source volume.
      verbatimSymlinks: true,
    });
  } else {
    // NSIS requires /D last; spawn argv preserves the spaces and Chinese path without shell quoting.
    await run(artifact, ['/S', `/D=${installed}`], { timeout: 120_000 });
  }
  await access(executable);
  await signing.verifyDesktopApplication(installed, process.platform, 'My Pi Harness');
}

async function retainedHistory() {
  const profileDirectory = join(directory, '已有用户数据', 'profiles', 'default');
  const sessionLogRoot = join(directory, '旧日志位置', '.my-pi-harness');
  await mkdir(join(directory, '旧日志位置'), { recursive: true });
  const token = randomBytes(32).toString('base64url');
  const login = randomBytes(32).toString('base64url');
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  const sessionId = randomUUID();
  const createdAt = Date.now();
  const store = await openProfileStore(profileDirectory, { sessionLogRoot });
  try {
    const client = store.auth.createLocalClient({
      id: randomUUID(),
      tokenHash: digest(token),
      csrfToken: randomBytes(32).toString('base64url'),
      createdAt,
      expiresAt: createdAt + 86_400_000,
    });
    store.auth.completeLogin(
      {
        providerId: 'github',
        issuer: 'https://github.com',
        subject: '90000002',
        name: 'Installer Smoke',
        avatarUrl: null,
      },
      client.id,
      { id: randomUUID(), tokenHash: digest(login), createdAt, expiresAt: createdAt + 86_400_000 },
    );
    store.createSession({
      id: sessionId,
      branchId: randomUUID(),
      title: '安装替换后保留的对话',
      providerId: 'missing-provider',
      modelId: 'fixture-model',
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'ask',
      at: createdAt,
    });
  } finally {
    store.close();
  }
  for (const phase of ['before-reinstall', 'after-reinstall']) {
    if (phase === 'after-reinstall') await install();
    const isolated = Object.fromEntries(
      [
        'PATH',
        'HOME',
        'USERPROFILE',
        'APPDATA',
        'SystemRoot',
        'WINDIR',
        'COMSPEC',
        'LANG',
        'LC_ALL',
        'DISPLAY',
      ].flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])),
    );
    const application = await electron.launch({
      executablePath: executable,
      args: [`--user-data-dir=${join(directory, phase)}`],
      cwd: directory,
      timeout: 30_000,
      env: {
        ...isolated,
        MY_PI_HARNESS_PROFILE_DIRECTORY: profileDirectory,
        MY_PI_HARNESS_SESSION_LOG_ROOT: sessionLogRoot,
      },
    });
    let origin;
    try {
      const page = await application.firstWindow();
      await expect(page.getByTestId('login-page')).toBeVisible();
      origin = new URL(page.url()).origin;
      await application.evaluate(
        async ({ session }, credentials) => {
          for (const [name, value] of Object.entries(credentials.tokens)) {
            await session.defaultSession.cookies.set({
              url: credentials.origin,
              name,
              value,
              path: '/api',
              httpOnly: true,
              sameSite: 'strict',
            });
          }
        },
        { origin, tokens: { my_pi_local: token, my_pi_session: login } },
      );
      const history = await page.evaluate(async (id) => {
        const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
        if (!response.ok) throw new Error(`Installed history unavailable: ${response.status}`);
        return await response.json();
      }, sessionId);
      assert.equal(history.session.title, '安装替换后保留的对话');
      assert.equal(history.session.id, sessionId);
    } finally {
      await application.close();
    }
    await assert.rejects(
      fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2_000) }),
      (error) => error.cause?.code === 'ECONNREFUSED',
    );
  }
  if (process.platform === 'win32') {
    await uninstallWindowsCandidate();
  } else {
    await rm(installed, { recursive: true });
  }
  const retained = await openProfileStore(profileDirectory, { sessionLogRoot });
  try {
    assert.equal(retained.getSnapshot(sessionId).session.title, '安装替换后保留的对话');
  } finally {
    retained.close();
  }
  return {
    sessionId,
    preserved: true,
    explicitExistingLogRoot: true,
    replacement: 'same-candidate reinstall',
    removedApplicationPreservesHistory: true,
  };
}

try {
  if (process.platform === 'win32') {
    // NSIS uses the stable product identity in the user registry; do not replace a real installation.
    await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference = 'Stop'; $roots = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'); foreach ($root in $roots) { if (Test-Path -LiteralPath $root) { $found = @(Get-ChildItem -LiteralPath $root | Get-ItemProperty | Where-Object { $_.DisplayName -like 'My Pi Harness*' }); if ($found.Count -gt 0) { throw 'Installer smoke refuses to replace an existing registered application' } } }",
    ]);
  }
  if (process.platform === 'darwin') {
    await mkdir(volume);
    await run('hdiutil', ['verify', artifact]);
    await run('hdiutil', ['attach', artifact, '-readonly', '-nobrowse', '-mountpoint', volume]);
    mounted = true;
  }
  await install();
  await run(process.execPath, ['--import', 'tsx', join(root, 'scripts/smoke-desktop.mjs')], {
    cwd: root,
    env: { ...process.env, MY_PI_HARNESS_SMOKE_EXECUTABLE: executable },
  });
  const retention = await retainedHistory();
  const output = join(root, 'output', 'm7.5');
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, `installer-${process.platform}-${process.arch}.json`),
    `${JSON.stringify({ at: new Date().toISOString(), version, platform: process.platform, architecture: process.arch, mode, artifact, artifactSha256, artifactBytes, installedPathContainsChineseAndSpaces: true, noExternalLogRootStartup: true, retention }, null, 2)}\n`,
  );
  process.stdout.write(
    `Installed desktop smoke passed (${process.platform}/${process.arch}, ${mode}, ${version}).\n`,
  );
} finally {
  if (process.platform === 'win32') await uninstallWindowsCandidate();
  if (mounted) await run('hdiutil', ['detach', volume]);
  await rm(directory, { recursive: true, force: true });
}
