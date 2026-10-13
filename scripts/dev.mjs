import { fileURLToPath } from 'node:url';
import { ensureNode } from './node-runtime.mjs';
import { spawnOwnedProcess, withNodeRuntimePath } from './process-tree.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const node = await ensureNode();
const pnpm = process.env['npm_execpath'];
if (!pnpm) throw new Error('请通过 pnpm dev 或 pnpm dev:desktop 启动');
const desktop = process.argv.includes('--desktop');
const children = [];
let stopPromise;
let cleanupReported = false;

function start(name) {
  const env = {
    ...withNodeRuntimePath(node, process.env),
    MY_PI_HARNESS_NODE_PATH: node,
    MY_PI_HARNESS_RENDERER_URL: 'http://127.0.0.1:5174',
    MY_PI_HARNESS_PARENT_PID: String(process.pid),
  };
  delete env['ELECTRON_RUN_AS_NODE'];
  const owned = spawnOwnedProcess(node, [pnpm, '--filter', `@my-pi-harness/${name}`, 'dev'], {
    cwd: root,
    stdio: 'inherit',
    env,
  });
  children.push(owned);
  const child = owned.child;
  child.once('error', (error) => {
    process.stderr.write(`${error.message}\n`);
    requestStop(1);
  });
  child.once('exit', (code) => {
    if (stopPromise === undefined) requestStop(code ?? 1);
  });
}

function stop(code = 0) {
  if (code !== 0 || process.exitCode === undefined) process.exitCode = code;
  stopPromise ??= Promise.allSettled(children.map((owned) => owned.stop())).then((results) => {
    const failures = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length > 0) {
      process.exitCode = 1;
      throw new AggregateError(failures, 'Development process cleanup failed');
    }
  });
  return stopPromise;
}

function requestStop(code = 0) {
  void stop(code).catch((error) => {
    if (cleanupReported) return;
    cleanupReported = true;
    console.error(error);
  });
}

process.on('SIGINT', () => requestStop());
process.on('SIGTERM', () => requestStop());
start('web');
start(desktop ? 'desktop' : 'daemon');
