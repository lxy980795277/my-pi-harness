import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CommandManager, type CommandToolHandlers, type ToolOwner } from '../../src/index.js';

interface Page {
  commandId: string;
  status: string;
  exitCode: number | null;
  output: { text: string; stream: string }[];
  nextCursor: number;
  error: string | null;
}
let directory: string;
let manager: CommandManager;
let port: CommandToolHandlers;
let releases: number;
let revoked: boolean;
const owner: ToolOwner = { sessionId: 'session', runId: 'root', taskId: null };
const signal = new AbortController().signal;
function bind(
  current: ToolOwner = owner,
  access: 'read-only' | 'full-access' = 'full-access',
): CommandToolHandlers {
  return manager.bind({
    owner: current,
    access,
    workspace: () =>
      Promise.resolve({
        workspaceRoot: join(directory, 'workspace'),
        profileDirectory: join(directory, 'profile'),
        readOnly: access === 'read-only',
        signal,
      }),
    resources: () =>
      Promise.resolve({
        readOnlyDirectories: [],
        verify: () => {
          if (revoked) return Promise.reject(new Error('revoked'));
          return Promise.resolve();
        },
        release: () => {
          releases++;
        },
      }),
  });
}
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'command-owner-')));
  await mkdir(join(directory, 'workspace'));
  await mkdir(join(directory, 'profile'));
  manager = new CommandManager();
  port = bind();
  releases = 0;
  revoked = false;
});
afterEach(async () => {
  await manager.close();
  await rm(directory, { recursive: true, force: true });
});
it.skipIf(process.platform !== 'darwin')(
  'yields a live job, pages output, and keeps root ownership across subsequent Runs',
  async () => {
    const first = (await port.run(
      { command: 'printf first; sleep 0.1; printf second >&2', yieldTimeMs: 0, lifetimeMs: 5000 },
      { toolCallId: 'call', signal },
    )) as Page;
    expect(first.status).toBe('running');
    const later = bind({ ...owner, runId: 'next' });
    const done = (await later.wait(first.commandId, 5000, 0, signal)) as Page;
    expect(done).toMatchObject({ status: 'completed', exitCode: 0 });
    expect(done.output.map((c) => c.text).join('')).toContain('first');
    expect(done.output.some((c) => c.stream === 'stderr' && c.text === 'second')).toBe(true);
    expect(
      ((await later.wait(first.commandId, 0, done.nextCursor, signal)) as Page).output,
    ).toEqual([]);
    manager.assertSuccessfulProducer(owner, first.commandId);
    expect(releases).toBe(1);
  },
);
it.skipIf(process.platform !== 'darwin')(
  'rejects other task owners and stops the entire task before releasing resources',
  async () => {
    const task = { ...owner, taskId: 'child', runId: 'child-run' };
    const child = bind(task);
    const job = (await child.run(
      { command: 'sleep 30', yieldTimeMs: 0 },
      { toolCallId: 'child-call', signal },
    )) as Page;
    await expect(port.wait(job.commandId, 0, 0, signal)).rejects.toMatchObject({
      code: 'COMMAND_NOT_FOUND',
    });
    expect(() => manager.assertSuccessfulProducer(task, job.commandId)).toThrow('尚未成功');
    await manager.closeTask('session', 'child');
    expect(((await child.wait(job.commandId, 0, 0, signal)) as Page).status).toBe('stopped');
    expect(releases).toBe(1);
  },
);
it.skipIf(process.platform !== 'darwin')(
  'enforces read-only command scope while retaining normal output',
  async () => {
    await writeFile(join(directory, 'workspace', 'source.txt'), 'original');
    const child = bind({ ...owner, taskId: 'readonly' }, 'read-only');
    const job = (await child.run(
      { command: 'cat source.txt; printf changed > source.txt', yieldTimeMs: 5000 },
      { toolCallId: 'read-call', signal },
    )) as Page;
    expect(job.status).toBe('failed');
    expect(await readFile(join(directory, 'workspace', 'source.txt'), 'utf8')).toBe('original');
    expect(job.output.map((c) => c.text).join('')).toContain('original');
  },
);
it.skipIf(process.platform !== 'darwin')(
  'a cancelled wait leaves the job owned and explicit stop releases it',
  async () => {
    const job = (await port.run(
      { command: 'sleep 30', yieldTimeMs: 0 },
      { toolCallId: 'call', signal },
    )) as Page;
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(port.wait(job.commandId, 10000, 0, cancelled.signal)).rejects.toBeDefined();
    expect(((await port.wait(job.commandId, 0, 0, signal)) as Page).status).toBe('running');
    await port.stop(job.commandId, signal);
    expect(releases).toBe(1);
  },
);
it.skipIf(process.platform !== 'darwin')(
  'revoked resources terminate a job even after its Run has yielded',
  async () => {
    const job = (await port.run(
      { command: 'sleep 30', yieldTimeMs: 0 },
      { toolCallId: 'call', signal },
    )) as Page;
    revoked = true;
    const done = (await port.wait(job.commandId, 5000, 0, signal)) as Page;
    expect(done.status).toBe('failed');
    expect(done.error).toContain('revoked');
    expect(releases).toBe(1);
  },
);
