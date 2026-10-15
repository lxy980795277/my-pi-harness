import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';
import { afterEach, describe, expect, it } from 'vitest';
import { openProfileStore, type ProfileStore } from '../src/index.js';

const require = createRequire(import.meta.url);
const fixturePath = fileURLToPath(new URL('./fixtures/profile-owner.ts', import.meta.url));
const fixtures: { directory: string; child?: ChildProcess; store?: ProfileStore }[] = [];
const ReadySchema = Type.Union([
  Type.Object({ status: Type.Literal('ready') }),
  Type.Object({ status: Type.Literal('error'), code: Type.String() }),
]);

async function fixture(): Promise<(typeof fixtures)[number]> {
  const value = { directory: await mkdtemp(join(tmpdir(), 'my-pi-profile-lock-')) };
  fixtures.push(value);
  return value;
}

async function startOwner(
  current: (typeof fixtures)[number],
  mode = 'idle',
): Promise<Static<typeof ReadySchema>> {
  const child = spawn(
    process.execPath,
    ['--import', require.resolve('tsx/esm'), fixturePath, current.directory, mode],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  current.child = child;
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  return new Promise((resolve, reject) => {
    const finish = (value: unknown, error?: Error): void => {
      clearTimeout(timeout);
      child.off('message', message);
      child.off('error', failed);
      child.off('exit', exited);
      if (error) reject(error);
      else if (Value.Check(ReadySchema, value)) resolve(value);
      else reject(new Error('Invalid child readiness record'));
    };
    const message = (value: unknown): void => finish(value);
    const failed = (error: Error): void => finish(undefined, error);
    const exited = (): void =>
      finish(undefined, new Error(`Owner exited before readiness: ${stderr}`));
    const timeout = setTimeout(
      () => finish(undefined, new Error(`Owner readiness timed out: ${stderr}`)),
      10_000,
    );
    child.once('message', message);
    child.once('error', failed);
    child.once('exit', exited);
  });
}

afterEach(async () => {
  for (const current of fixtures.splice(0)) {
    try {
      if (
        current.child?.pid &&
        current.child.exitCode === null &&
        current.child.signalCode === null
      ) {
        const exited = once(current.child, 'exit');
        current.child.kill('SIGKILL');
        await exited;
      }
      current.store?.close();
    } finally {
      await rm(current.directory, { recursive: true, force: true });
    }
  }
});

describe('real profile OS ownership', () => {
  it('rejects another process while the profile owner remains alive', async () => {
    const current = await fixture();
    current.store = await openProfileStore(current.directory);
    expect(await startOwner(current)).toEqual({ status: 'error', code: 'PROFILE_LOCKED' });
    expect(current.store.listSessions()).toEqual([]);
    current.store.close();
    current.store = await openProfileStore(current.directory);
  });

  it('takes over after a killed owner and marks its committed active run interrupted', async () => {
    const current = await fixture();
    expect(await startOwner(current, 'running')).toEqual({ status: 'ready' });
    await expect(openProfileStore(current.directory)).rejects.toMatchObject({
      code: 'PROFILE_LOCKED',
    });
    const child = current.child;
    if (child === undefined) throw new Error('Owner child is missing');
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    current.store = await openProfileStore(current.directory);
    const snapshot = current.store.getSnapshot('crash-session');
    expect(snapshot.runs[0]?.status).toBe('interrupted');
    expect(snapshot.messages[0]).toMatchObject({
      text: 'Committed before kill',
      status: 'interrupted',
    });
    expect(current.store.readEvents('crash-session').map((event) => event.type)).toEqual([
      'session.created',
      'run.accepted',
      'message.started',
      'run.finished',
    ]);
  });
});
