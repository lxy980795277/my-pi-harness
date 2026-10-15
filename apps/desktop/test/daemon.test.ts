import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDaemon } from '../src/main/daemon.js';

vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => '/temporary-profile' } }));

type FixtureMode =
  | 'invalid-ready'
  | 'oversized-ready'
  | 'exit-before-ready'
  | 'await-ready'
  | 'valid-ready';

interface Fixture {
  resources: string;
  statePath: string;
}

const FixtureStateSchema = Type.Object({
  pid: Type.Integer({ minimum: 1 }),
  origin: Type.String({ minLength: 1 }),
  shutdownCount: Type.Integer({ minimum: 0 }),
  exitCode: Type.Union([Type.Integer(), Type.Null()]),
  sessionLogRoot: Type.String(),
  developmentOrigins: Type.Array(Type.Object({ key: Type.String(), value: Type.String() })),
});

type FixtureState = Static<typeof FixtureStateSchema>;

const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
let fixture: Fixture | undefined;

async function prepareFixture(mode: FixtureMode): Promise<Fixture> {
  const resources = await mkdtemp(join(tmpdir(), 'my-pi-harness-supervisor-'));
  fixture = { resources, statePath: join(resources, 'fixture-state.json') };
  vi.stubEnv('MY_PI_HARNESS_SESSION_LOG_ROOT', join(resources, '.my-pi-harness'));
  const nodeDirectory = join(resources, 'node');
  const daemonDirectory = join(resources, 'daemon');
  const bootstrapDirectory = join(daemonDirectory, 'dist');
  await mkdir(nodeDirectory, { recursive: true });
  await mkdir(bootstrapDirectory, { recursive: true });
  await copyFile(
    process.execPath,
    join(nodeDirectory, process.platform === 'win32' ? 'node.exe' : 'node'),
  );
  await writeFile(join(daemonDirectory, 'package.json'), '{"type":"module"}\n');
  await writeFile(
    join(bootstrapDirectory, 'bootstrap.js'),
    `import { createServer } from 'node:http';
import { renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const mode = ${JSON.stringify(mode)};
const statePath = fileURLToPath(new URL('../../fixture-state.json', import.meta.url));
let shutdownCount = 0;
let origin = '';
const save = (exitCode) => {
  writeFileSync(statePath + '.tmp', JSON.stringify({
    pid: process.pid, origin, shutdownCount, exitCode,
    sessionLogRoot: process.env.MY_PI_HARNESS_SESSION_LOG_ROOT,
    developmentOrigins: Object.entries(process.env)
      .filter(([key]) => key.toUpperCase() === 'MY_PI_HARNESS_DEVELOPMENT_ORIGIN')
      .map(([key, value]) => ({ key, value })),
  }));
  renameSync(statePath + '.tmp', statePath);
};
process.on('exit', (code) => save(code));
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ pid: process.pid }));
});
const close = () => server.close(() => {
  process.exitCode = 0;
  if (process.connected) process.disconnect();
});
process.on('message', (message) => {
  if (message?.type !== 'daemon.shutdown') return;
  shutdownCount += 1;
  save(null);
  close();
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No TCP address');
  origin = 'http://127.0.0.1:' + address.port;
  save(null);
  if (mode === 'exit-before-ready') { close(); return; }
  if (mode === 'await-ready') return;
  if (mode === 'oversized-ready') {
    process.stdout.write('x'.repeat(65 * 1024) + '\\n');
    return;
  }
  const record = JSON.stringify({
    type: 'daemon.ready',
    host: mode === 'invalid-ready' ? '0.0.0.0' : '127.0.0.1',
    port: address.port,
    instanceId: 'fixture-' + process.pid,
  }) + '\\n';
  const midpoint = Math.floor(record.length / 2);
  process.stdout.write(record.slice(0, midpoint));
  setImmediate(() => process.stdout.write(record.slice(midpoint)));
});
`,
  );
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value: resources,
  });
  return fixture;
}

async function readState(current: Fixture): Promise<FixtureState> {
  const value: unknown = JSON.parse(await readFile(current.statePath, 'utf8'));
  if (!Value.Check(FixtureStateSchema, value)) throw new Error('Invalid fixture state');
  return value;
}

async function readAvailableState(current: Fixture): Promise<FixtureState | undefined> {
  try {
    return await readState(current);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

afterEach(async () => {
  const current = fixture;
  fixture = undefined;
  try {
    if (current !== undefined) {
      const state = await readAvailableState(current);
      if (state !== undefined && state.exitCode === null && processExists(state.pid)) {
        const pid = state.pid;
        process.kill(pid, 'SIGKILL');
        await expect.poll(() => processExists(pid), { timeout: 5_000 }).toBe(false);
      }
    }
  } finally {
    vi.unstubAllEnvs();
    if (originalResourcesPath === undefined) Reflect.deleteProperty(process, 'resourcesPath');
    else Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
    if (current !== undefined) await rm(current.resources, { recursive: true, force: true });
  }
});

describe('desktop daemon supervisor', { concurrent: false }, () => {
  it('requires a repository log root before spawning a standalone packaged daemon', async () => {
    const current = await prepareFixture('valid-ready');
    vi.stubEnv('MY_PI_HARNESS_SESSION_LOG_ROOT', undefined);
    await expect(startDaemon()).rejects.toThrow('MY_PI_HARNESS_SESSION_LOG_ROOT');
    expect(await readAvailableState(current)).toBeUndefined();
  });
  it.each(['MY_PI_HARNESS_DEVELOPMENT_ORIGIN', 'My_Pi_Harness_Development_Origin'])(
    'removes inherited %s from the real packaged child',
    async (key) => {
      vi.stubEnv(key, 'http://127.0.0.1:5174');
      const current = await prepareFixture('valid-ready');
      const daemon = await startDaemon();
      try {
        const state = await readState(current);
        expect(state.developmentOrigins).toEqual([]);
        expect(state.sessionLogRoot).toBe(join(current.resources, '.my-pi-harness'));
      } finally {
        await daemon.stop();
      }
    },
  );
  it.each([
    ['invalid-ready', '本机服务启动记录无效'],
    ['oversized-ready', '本机服务启动记录过大'],
  ] as const)('reclaims its child after %s startup input', async (mode, message) => {
    const current = await prepareFixture(mode);
    await expect(startDaemon()).rejects.toThrow(message);
    const state = await readState(current);
    expect(processExists(state.pid)).toBe(false);
    expect(state.shutdownCount).toBe(1);
    expect(state.exitCode).toBe(0);
  });

  it('rejects a child that exits naturally before publishing readiness', async () => {
    const current = await prepareFixture('exit-before-ready');
    await expect(startDaemon()).rejects.toThrow('本机服务在就绪前退出');
    const state = await readState(current);
    expect(processExists(state.pid)).toBe(false);
    expect(state.shutdownCount).toBe(0);
    expect(state.exitCode).toBe(0);
  });

  it('cancels pending readiness and waits for its child to exit normally', async () => {
    const current = await prepareFixture('await-ready');
    const controller = new AbortController();
    const reason = new Error('Owner ended startup');
    const startup = startDaemon({ signal: controller.signal }).then(
      (daemon) => ({ type: 'ready' as const, daemon }),
      (error: unknown) => ({ type: 'failed' as const, error }),
    );
    try {
      await expect
        .poll(() => readAvailableState(current), { timeout: 5_000 })
        .toMatchObject({ exitCode: null });
      controller.abort(reason);
      const outcome = await startup;
      expect(outcome.type).toBe('failed');
      if (outcome.type !== 'failed') throw new Error('Canceled daemon became ready');
      expect(outcome.error).toBe(reason);
      const state = await readState(current);
      expect(processExists(state.pid)).toBe(false);
      expect(state.shutdownCount).toBe(1);
      expect(state.exitCode).toBe(0);
    } finally {
      controller.abort(reason);
      const outcome = await startup;
      if (outcome.type === 'ready') await outcome.daemon.stop();
    }
  });

  it('accepts streamed readiness and stops repeated callers through one normal shutdown', async () => {
    const current = await prepareFixture('valid-ready');
    const daemon = await startDaemon();
    const running = await readState(current);
    expect(daemon.origin).toBe(running.origin);
    const response = await fetch(daemon.origin, { signal: AbortSignal.timeout(5_000) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pid: running.pid });

    await Promise.all([daemon.stop(), daemon.stop()]);
    await daemon.stop();
    const stopped = await readState(current);
    expect(stopped.shutdownCount).toBe(1);
    expect(stopped.exitCode).toBe(0);
    expect(processExists(stopped.pid)).toBe(false);
    await expect(fetch(daemon.origin, { signal: AbortSignal.timeout(5_000) })).rejects.toThrow();
  });
});
