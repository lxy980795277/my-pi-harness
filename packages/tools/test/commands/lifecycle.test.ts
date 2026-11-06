import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sandbox from '@my-pi-harness/sandbox';
import type { ManagedProcess, ProcessObserver } from '@my-pi-harness/sandbox';
import { CommandManager } from '../../src/commands/manager';
import type { CommandResourceLease } from '../../src/commands/manager';
import type {
  WorkspaceToolContext,
  CommandToolHandlers,
  ToolOwner,
} from '../../src/lib/tool-context';

interface Gate<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

let directory: string;
let context: WorkspaceToolContext;

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'command-lifecycle-')));
  const workspaceRoot = join(directory, 'workspace');
  const profileDirectory = join(directory, 'profile');
  await mkdir(workspaceRoot);
  await mkdir(profileDirectory);
  context = {
    workspaceRoot,
    profileDirectory,
    readOnly: false,
    signal: new AbortController().signal,
  };
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function gate<T>(): Gate<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function commandId(result: unknown): string {
  if (
    typeof result === 'object' &&
    result !== null &&
    'commandId' in result &&
    typeof result.commandId === 'string'
  )
    return result.commandId;
  throw new Error('Command fixture did not return an ID');
}

async function ready(commands: CommandToolHandlers, id: string): Promise<void> {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const result = await commands.wait(id, 100, 0, context.signal);
    if (
      typeof result === 'object' &&
      result !== null &&
      'output' in result &&
      Array.isArray(result.output) &&
      result.output.some(
        (chunk: unknown) =>
          typeof chunk === 'object' &&
          chunk !== null &&
          'text' in chunk &&
          typeof chunk.text === 'string' &&
          chunk.text.includes('ready'),
      )
    )
      return;
  }
  throw new Error('Command fixture did not produce its readiness output');
}

describe.skipIf(process.platform !== 'darwin')('command owner cleanup', () => {
  it.each([false, true])(
    'settles in-flight resource verification before releasing a physically closed command, revoked: %s',
    async (revoked) => {
      const manager = new CommandManager();
      const enteredVerification = gate<void>();
      const verification = gate<void>();
      const enteredRelease = gate<void>();
      const release = gate<void>();
      const physicallyClosed = gate<void>();
      let periodic = false;
      let released = false;
      let observer: ProcessObserver | undefined;
      const process: ManagedProcess = {
        closed: physicallyClosed.promise,
        exit: Promise.resolve({ code: 0, signal: null }),
        write: () => Promise.reject(new Error('Unexpected fixture write')),
        diagnostics: () => '',
        close: () => {
          physicallyClosed.resolve();
          return physicallyClosed.promise;
        },
      };
      const start = vi.spyOn(sandbox, 'startProcess').mockImplementation((_launch, callbacks) => {
        observer = callbacks;
        return Promise.resolve(process);
      });
      vi.useFakeTimers();
      const commands = manager.bind({
        owner: { sessionId: 'verification-session', runId: 'verification-run', taskId: null },
        access: 'full-access',
        workspace: () => Promise.resolve(context),
        resources: () =>
          Promise.resolve({
            readOnlyDirectories: [],
            verify: async () => {
              if (!periodic) return;
              enteredVerification.resolve();
              await verification.promise;
              if (released) throw new Error('Fixture resource was released during verification');
              if (revoked) throw new Error('Fixture resource authorization revoked');
            },
            release: async () => {
              released = true;
              enteredRelease.resolve();
              await release.promise;
            },
          }),
      });
      try {
        const id = commandId(
          await commands.run(
            { command: 'fixture-command', yieldTimeMs: 0 },
            { toolCallId: 'verification-call', signal: context.signal },
          ),
        );
        periodic = true;
        await vi.advanceTimersByTimeAsync(1000);
        await enteredVerification.promise;
        if (observer === undefined) throw new Error('Fixture process was not started');
        observer.exit?.({ code: 0, signal: null });
        physicallyClosed.resolve();
        await Promise.resolve();
        expect(released).toBe(false);
        verification.resolve();
        await enteredRelease.promise;
        release.resolve();
        const result = await commands.wait(id, 5000, 0, context.signal);
        expect(result).toMatchObject({
          status: revoked ? 'failed' : 'completed',
          exitCode: 0,
          error: revoked ? 'Fixture resource authorization revoked' : null,
        });
      } finally {
        verification.resolve();
        release.resolve();
        physicallyClosed.resolve();
        await manager.close();
        vi.useRealTimers();
        start.mockRestore();
      }
    },
  );

  it('waits for a starting workspace acquisition and its resource release before closing', async () => {
    const manager = new CommandManager();
    const enteredWorkspace = gate<void>();
    const workspace = gate<WorkspaceToolContext>();
    const enteredRelease = gate<void>();
    const release = gate<void>();
    let releases = 0;
    const lease: CommandResourceLease = {
      readOnlyDirectories: [],
      verify: async () => {},
      release: async () => {
        enteredRelease.resolve();
        await release.promise;
        releases += 1;
      },
    };
    const commands = manager.bind({
      owner: { sessionId: 'fixture-session', runId: 'fixture-run', taskId: null },
      access: 'full-access',
      workspace: async () => {
        enteredWorkspace.resolve();
        return await workspace.promise;
      },
      resources: () => Promise.resolve(lease),
    });
    const running = commands.run(
      { command: 'printf unexpected > started.txt', yieldTimeMs: 0 },
      { toolCallId: 'fixture-call', signal: context.signal },
    );
    running.catch(() => {});
    await enteredWorkspace.promise;
    let closed = false;
    const closing = manager.close().then(() => {
      closed = true;
    });
    try {
      workspace.resolve(context);
      await enteredRelease.promise;
      await Promise.resolve();
      expect(closed).toBe(false);
      expect(releases).toBe(0);
      release.resolve();
      await expect(running).rejects.toHaveProperty('code', 'COMMAND_CLOSED');
      await closing;
      expect(releases).toBe(1);
      await expect(readFile(join(context.workspaceRoot, 'started.txt'))).rejects.toHaveProperty(
        'code',
        'ENOENT',
      );
    } finally {
      workspace.resolve(context);
      release.resolve();
      await Promise.allSettled([running, closing]);
      await manager.close();
    }
  });

  it('settles a completed job as failed when its resource release rejects and remains closable', async () => {
    const manager = new CommandManager();
    let releases = 0;
    let writerRetains = 0;
    let writerReleases = 0;
    const commands = manager.bind({
      owner: { sessionId: 'fixture-session', runId: 'fixture-run', taskId: null },
      access: 'full-access',
      workspace: () => Promise.resolve(context),
      retainExecution: (signal) => {
        signal.throwIfAborted();
        writerRetains += 1;
        return Promise.resolve(() => {
          writerReleases += 1;
        });
      },
      resources: () =>
        Promise.resolve({
          readOnlyDirectories: [],
          verify: async () => {},
          release: () => {
            releases += 1;
            return Promise.reject(new Error('fixture resource release failed'));
          },
        }),
    });
    try {
      const result = await commands.run(
        { command: 'printf completed', yieldTimeMs: 5000 },
        { toolCallId: 'fixture-call', signal: context.signal },
      );
      expect(result).toMatchObject({
        status: 'failed',
        exitCode: 0,
        error: 'fixture resource release failed',
      });
      expect(releases).toBe(1);
      expect(writerRetains).toBe(1);
      expect(writerReleases).toBe(1);
      await manager.close();
      expect(releases).toBe(1);
      expect(writerReleases).toBe(1);
    } finally {
      await manager.close();
    }
  });

  it.each(['stop', 'finish'] as const)(
    'retains the execution writer after yielding and releases it once after %s and resource cleanup',
    async (mode) => {
      const manager = new CommandManager();
      const owner: ToolOwner = { sessionId: 'writer-session', runId: 'writer-run', taskId: null };
      const other: ToolOwner = { ...owner, runId: 'other-run', taskId: 'other-task' };
      const enteredRelease = gate<void>();
      const resourceRelease = gate<void>();
      let retains = 0;
      let releases = 0;
      let resourceReleases = 0;
      const commands = manager.bind({
        owner,
        access: 'full-access',
        workspace: () => Promise.resolve(context),
        resources: () =>
          Promise.resolve({
            readOnlyDirectories: [],
            verify: () => Promise.resolve(),
            release: async () => {
              resourceReleases += 1;
              enteredRelease.resolve();
              await resourceRelease.promise;
            },
          }),
        retainExecution: (signal) => {
          signal.throwIfAborted();
          retains += 1;
          return Promise.resolve(() => {
            releases += 1;
          });
        },
      });
      let completing: Promise<unknown> | undefined;
      try {
        const result = await commands.run(
          {
            command:
              'printf ready; while [ ! -f finish.txt ]; do /bin/sleep 0.02; done; printf finished',
            yieldTimeMs: 0,
            lifetimeMs: 10000,
          },
          { toolCallId: 'writer-call', signal: context.signal },
        );
        const id = commandId(result);
        await ready(commands, id);
        expect(retains).toBe(1);
        expect(releases).toBe(0);
        expect(() => manager.assertWriteAvailable(owner)).not.toThrow();
        expect(() => manager.assertWriteAvailable(other)).toThrow(
          expect.objectContaining({ code: 'COMMAND_WRITE_CONFLICT' }),
        );
        if (mode === 'stop') completing = commands.stop(id, context.signal);
        else {
          await writeFile(join(context.workspaceRoot, 'finish.txt'), 'finish');
          completing = commands.wait(id, 5000, 0, context.signal);
        }
        completing.catch(() => {});
        await enteredRelease.promise;
        expect(releases).toBe(0);
        expect(() => manager.assertWriteAvailable(other)).toThrow(
          expect.objectContaining({ code: 'COMMAND_WRITE_CONFLICT' }),
        );
        resourceRelease.resolve();
        await expect(completing).resolves.toMatchObject({
          status: mode === 'stop' ? 'stopped' : 'completed',
        });
        expect(resourceReleases).toBe(1);
        expect(releases).toBe(1);
        expect(() => manager.assertWriteAvailable(other)).not.toThrow();
        await commands.stop(id, context.signal);
        await manager.close();
        expect(releases).toBe(1);
      } finally {
        resourceRelease.resolve();
        await completing?.catch(() => {});
        await manager.close();
      }
    },
  );

  it.each(['full-access', 'read-only'] as const)(
    'checks another Run against an active %s command before starting writes',
    async (access) => {
      const manager = new CommandManager();
      const owner: ToolOwner = { sessionId: 'writer-session', runId: 'first-run', taskId: null };
      const other: ToolOwner = { ...owner, runId: 'second-run', taskId: 'second-task' };
      const base = {
        workspace: () => Promise.resolve(context),
        resources: () =>
          Promise.resolve({
            readOnlyDirectories: [],
            verify: () => Promise.resolve(),
            release: () => {},
          }),
      };
      const first = manager.bind({ ...base, owner, access });
      const second = manager.bind({ ...base, owner: other, access: 'full-access' });
      try {
        const id = commandId(
          await first.run(
            {
              command: 'printf ready; while [ ! -f finish.txt ]; do /bin/sleep 0.02; done',
              yieldTimeMs: 0,
              lifetimeMs: 10000,
            },
            { toolCallId: 'first-call', signal: context.signal },
          ),
        );
        await ready(first, id);
        const invocation = { toolCallId: 'second-call', signal: context.signal };
        const input = { command: 'printf allowed > second-run.txt', yieldTimeMs: 5000 };
        expect(() =>
          manager.assertWriteAvailable({ ...other, sessionId: 'independent-session' }),
        ).not.toThrow();
        if (access === 'full-access') {
          expect(() => manager.assertWriteAvailable(other)).toThrow(
            expect.objectContaining({ code: 'COMMAND_WRITE_CONFLICT' }),
          );
          await expect(second.run(input, invocation)).rejects.toHaveProperty(
            'code',
            'COMMAND_WRITE_CONFLICT',
          );
          await expect(
            readFile(join(context.workspaceRoot, 'second-run.txt')),
          ).rejects.toHaveProperty('code', 'ENOENT');
          await first.stop(id, context.signal);
          expect(() => manager.assertWriteAvailable(other)).not.toThrow();
        } else {
          expect(() => manager.assertWriteAvailable(other)).not.toThrow();
          await expect(second.run(input, invocation)).resolves.toMatchObject({
            status: 'completed',
            exitCode: 0,
          });
          expect(await readFile(join(context.workspaceRoot, 'second-run.txt'), 'utf8')).toBe(
            'allowed',
          );
        }
      } finally {
        await manager.close();
      }
    },
  );

  it('shares an in-flight Session close, rejects new jobs until resource cleanup, and accepts a newly bound Run afterwards', async () => {
    const manager = new CommandManager();
    const owner: ToolOwner = { sessionId: 'closing-session', runId: 'closing-run', taskId: null };
    const enteredRelease = gate<void>();
    const release = gate<void>();
    let releases = 0;
    let newStarts = 0;
    const commands = manager.bind({
      owner,
      access: 'full-access',
      workspace: () => Promise.resolve(context),
      resources: () =>
        Promise.resolve({
          readOnlyDirectories: [],
          verify: () => Promise.resolve(),
          release: async () => {
            enteredRelease.resolve();
            await release.promise;
            releases += 1;
          },
        }),
    });
    const nextBinding = {
      access: 'full-access' as const,
      workspace: () => {
        newStarts += 1;
        return Promise.resolve(context);
      },
      resources: () =>
        Promise.resolve({
          readOnlyDirectories: [],
          verify: () => Promise.resolve(),
          release: () => {},
        }),
    };
    let closing: Promise<void> | undefined;
    try {
      const id = commandId(
        await commands.run(
          {
            command: 'printf ready; while [ ! -f finish.txt ]; do /bin/sleep 0.02; done',
            yieldTimeMs: 0,
            lifetimeMs: 10000,
          },
          { toolCallId: 'closing-call', signal: context.signal },
        ),
      );
      await ready(commands, id);
      closing = manager.closeSession(owner.sessionId);
      expect(manager.closeSession(owner.sessionId)).toBe(closing);
      let closed = false;
      const observed = closing.then(() => {
        closed = true;
      });
      observed.catch(() => {});
      await enteredRelease.promise;
      expect(closed).toBe(false);
      expect(releases).toBe(0);
      const duringClose = manager.bind({ ...nextBinding, owner: { ...owner, runId: 'late-run' } });
      await expect(
        duringClose.run(
          { command: 'printf leaked > leaked.txt', yieldTimeMs: 0 },
          { toolCallId: 'late-call', signal: context.signal },
        ),
      ).rejects.toHaveProperty('code', 'COMMAND_CLOSED');
      expect(newStarts).toBe(0);
      await expect(readFile(join(context.workspaceRoot, 'leaked.txt'))).rejects.toHaveProperty(
        'code',
        'ENOENT',
      );
      expect(manager.closeSession(owner.sessionId)).toBe(closing);
      release.resolve();
      await observed;
      expect(releases).toBe(1);
      await expect(commands.wait(id, 0, 0, context.signal)).rejects.toHaveProperty(
        'code',
        'COMMAND_NOT_FOUND',
      );
      const renewed = manager.bind({ ...nextBinding, owner: { ...owner, runId: 'renewed-run' } });
      await expect(
        renewed.run(
          { command: 'printf reopened > reopened.txt', yieldTimeMs: 5000 },
          { toolCallId: 'renewed-call', signal: context.signal },
        ),
      ).resolves.toMatchObject({ status: 'completed', exitCode: 0 });
      expect(newStarts).toBe(1);
      expect(await readFile(join(context.workspaceRoot, 'reopened.txt'), 'utf8')).toBe('reopened');
    } finally {
      release.resolve();
      await closing?.catch(() => {});
      await manager.close();
    }
  });
});
