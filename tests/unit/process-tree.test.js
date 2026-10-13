import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnOwnedProcess, withNodeRuntimePath } from '../../scripts/process-tree.mjs';

const execute = promisify(execFile);
const fixtures = [];

async function deadline(operation, timeout = 5_000) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Fixture did not reach its expected state')),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function request(origin) {
  return new Promise((resolve, reject) => {
    const connection = get(origin, { agent: false }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.once('error', reject);
      response.once('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    connection.once('error', reject);
    connection.setTimeout(5_000, () => connection.destroy(new Error('Fixture HTTP timeout')));
  });
}

async function liveGroup(group) {
  const { stdout } = await execute('/bin/ps', ['-A', '-o', 'pid=,pgid=,stat='], {
    timeout: 1_000,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
  });
  return stdout.split('\n').flatMap((line) => {
    const [pid, pgid, status] = line.trim().split(/\s+/);
    return Number(pgid) === group && status !== undefined && !status.startsWith('Z')
      ? [Number(pid)]
      : [];
  });
}

async function startFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-harness-process-tree-'));
  const entry = join(directory, 'fixture.mjs');
  const identity = directory;
  const fixture = { directory, owned: undefined, ready: undefined };
  fixtures.push(fixture);
  await writeFile(
    entry,
    `import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
const [role, identity] = process.argv.slice(2);
if (role !== 'leader') process.on('SIGTERM', () => {});
if (role === 'leaf') {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ identity, pid: process.pid }));
  });
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('No TCP address');
    process.send({ type: 'ready', pids: [process.pid], origin: 'http://127.0.0.1:' + address.port });
  });
} else {
  const child = fork(fileURLToPath(import.meta.url), [role === 'leader' ? 'branch' : 'leaf', identity], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  child.once('message', (ready) => {
    process.send({ ...ready, pids: [process.pid, ...ready.pids] });
  });
  process.on('message', (message) => {
    if (role === 'leader' && message?.type === 'exit') process.exit(0);
  });
  setInterval(() => {}, 1_000);
}
`,
  );
  fixture.owned = spawnOwnedProcess(process.execPath, [entry, 'leader', identity], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const [ready] = await deadline(once(fixture.owned.child, 'message'));
  if (
    typeof ready !== 'object' ||
    ready === null ||
    ready.type !== 'ready' ||
    !Array.isArray(ready.pids) ||
    ready.pids.length !== 3 ||
    !ready.pids.every((pid) => Number.isInteger(pid) && pid > 0) ||
    typeof ready.origin !== 'string'
  )
    throw new Error('Invalid fixture readiness');
  fixture.ready = ready;
  return fixture;
}

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map(async ({ owned, directory }) => {
      try {
        if (owned !== undefined) {
          try {
            await owned.stop();
          } catch (error) {
            if (process.platform === 'win32' || owned.child.pid === undefined) throw error;
            try {
              process.kill(-owned.child.pid, 'SIGKILL');
            } catch (killError) {
              if (
                !(killError instanceof Error && 'code' in killError && killError.code === 'ESRCH')
              )
                throw killError;
            }
            await expect.poll(() => liveGroup(owned.child.pid), { timeout: 5_000 }).toEqual([]);
            throw error;
          }
        }
      } finally {
        if (owned?.child.connected) owned.child.disconnect();
        await rm(directory, { recursive: true, force: true });
      }
    }),
  );
});

describe('owned development process trees', () => {
  it.runIf(process.platform !== 'win32')(
    'reclaims TERM-ignoring descendants without stopping another owned group',
    async () => {
      const target = await startFixture();
      const unrelated = await startFixture();
      expect(await request(target.ready.origin)).toEqual({
        identity: target.directory,
        pid: target.ready.pids[2],
      });
      const first = target.owned.stop();
      expect(target.owned.stop()).toBe(first);
      await first;
      expect(target.owned.child.exitCode !== null || target.owned.child.signalCode !== null).toBe(
        true,
      );
      expect(await liveGroup(target.ready.pids[0])).toEqual([]);
      await expect(request(target.ready.origin)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
      await target.owned.stop();
      expect(await request(unrelated.ready.origin)).toEqual({
        identity: unrelated.directory,
        pid: unrelated.ready.pids[2],
      });
    },
  );

  it.runIf(process.platform !== 'win32')(
    'reclaims the original group after its leader has exited',
    async () => {
      const fixture = await startFixture();
      const exited = once(fixture.owned.child, 'exit');
      fixture.owned.child.send({ type: 'exit' });
      expect(await deadline(exited)).toEqual([0, null]);
      expect(await request(fixture.ready.origin)).toEqual({
        identity: fixture.directory,
        pid: fixture.ready.pids[2],
      });
      await fixture.owned.stop();
      expect(await liveGroup(fixture.ready.pids[0])).toEqual([]);
      await expect(request(fixture.ready.origin)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    },
  );

  it('observes a fast leader exit and allows repeated cleanup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-harness-fast-exit-'));
    const owned = spawnOwnedProcess(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
    });
    fixtures.push({ directory, owned });
    const exited = once(owned.child, 'exit');
    expect(await deadline(exited)).toEqual([0, null]);
    await owned.stop();
    expect(owned.child.exitCode !== null || owned.child.signalCode !== null).toBe(true);
    await owned.stop();
  });

  it.runIf(process.platform === 'win32')(
    'waits for taskkill and the owned Windows tree to exit',
    async () => {
      const fixture = await startFixture();
      await fixture.owned.stop();
      expect(fixture.owned.child.exitCode !== null || fixture.owned.child.signalCode !== null).toBe(
        true,
      );
      for (const pid of fixture.ready.pids) {
        await expect
          .poll(
            () => {
              try {
                process.kill(pid, 0);
                return true;
              } catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
                  return false;
                throw error;
              }
            },
            { timeout: 5_000 },
          )
          .toBe(false);
      }
      await expect(request(fixture.ready.origin)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    },
  );
});

describe('development Node PATH', () => {
  it('keeps one Windows PATH key and preserves the inherited Path value', () => {
    const original = { Path: 'C:\\Windows\\System32', OTHER: 'preserved' };
    expect(withNodeRuntimePath('C:\\Runtime\\node.exe', original, 'win32')).toEqual({
      PATH: 'C:\\Runtime;C:\\Windows\\System32',
      OTHER: 'preserved',
    });
    expect(original).toEqual({ Path: 'C:\\Windows\\System32', OTHER: 'preserved' });
  });

  it('removes duplicate Windows variants using the same key ordering as Node spawn', () => {
    const env = withNodeRuntimePath(
      'C:\\Runtime\\node.exe',
      {
        Path: 'second',
        PATH: 'first',
        path: 'third',
      },
      'win32',
    );
    expect(Object.keys(env).filter((key) => key.toUpperCase() === 'PATH')).toEqual(['PATH']);
    expect(env.PATH).toBe('C:\\Runtime;first');
  });

  it('preserves case-sensitive Unix variables and prepends the selected runtime', () => {
    expect(
      withNodeRuntimePath('/runtime/bin/node', { PATH: '/usr/bin', Path: 'unrelated' }, 'darwin'),
    ).toEqual({ PATH: '/runtime/bin:/usr/bin', Path: 'unrelated' });
  });
});
