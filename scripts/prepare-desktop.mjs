import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureNode, run } from './node-runtime.mjs';
import { desktopOAuthEnvironment } from './desktop-oauth.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'out', 'desktop-resources');
const oauthEnvironment = await desktopOAuthEnvironment(root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const pnpm = process.env['npm_execpath'];
if (!pnpm) throw new Error('请通过 pnpm package:desktop 准备资源');
await run(
  process.execPath,
  [
    pnpm,
    '--filter',
    '@my-pi-harness/daemon',
    'deploy',
    '--prod',
    '--legacy',
    join(output, 'daemon'),
  ],
  { cwd: root },
);
// Legacy deploy hoists the daemon's self-link to workspace source; its entry lives in deployed dist.
await rm(
  join(output, 'daemon', 'node_modules', '.pnpm', 'node_modules', '@my-pi-harness', 'daemon'),
  { force: true },
);
await writeFile(join(output, 'daemon', 'desktop-oauth.env'), oauthEnvironment, { mode: 0o600 });
await cp(join(root, 'apps', 'web', 'dist'), join(output, 'web'), { recursive: true });
await mkdir(join(output, 'node'), { recursive: true });
await cp(
  await ensureNode(),
  join(output, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
);
