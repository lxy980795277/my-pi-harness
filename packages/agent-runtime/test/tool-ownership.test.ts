import { mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionSummary } from '@my-pi-harness/protocol';
import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vitest';
import * as execution from '@my-pi-harness/execution';
import { RuntimeError } from '../src/errors.js';
import type { EventInput } from '../src/sessions/ports.js';
import { ToolRuntime, toolCallRecordId } from '../src/tools/runtime.js';
import type { ToolRunContext } from '../src/tools/types.js';

async function fixture() {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-tool-owner-')));
  const directory = join(temporary, 'workspace');
  await mkdir(directory);
  await mkdir(join(temporary, 'profile'));
  const events: EventInput[] = [];
  const session: SessionSummary = {
    id: 'session',
    title: 'Task execution',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: 'workspace',
    approvalMode: 'full-access',
    createdAt: 1,
    updatedAt: 1,
    activeBranchId: 'branch',
    activeRunId: 'run',
    snapshotSeq: 0,
  };
  const context: ToolRunContext = {
    session,
    readOnly: false,
    run: {
      id: 'run',
      sessionId: 'session',
      branchId: 'branch',
      providerId: 'provider',
      modelId: 'model',
      status: 'running',
      createdAt: 1,
      finishedAt: null,
      error: null,
    },
    signal: new AbortController().signal,
    supportsImages: false,
    recorded: new Set<string>(),
    assistantMessageId: () => 'assistant',
    commit: (records) => events.push(...records),
    persistenceFailure: (error) => {
      throw error;
    },
    outcomeUnknown: () => {
      throw new Error('Unexpected unknown tool result');
    },
  };
  const runtime = new ToolRuntime({
    profileDirectory: join(temporary, 'profile'),
    resolveWorkspace: () =>
      Promise.resolve({
        id: 'workspace',
        name: 'Temporary workspace',
        rootPath: directory,
        icon: 'folder',
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
  });
  return {
    directory,
    context,
    runtime,
    events,
    close: async () => await rm(temporary, { recursive: true, force: true }),
  };
}

describe('task tool ownership', () => {
  it.each([
    { name: 'write_file', args: { path: 'blocked.txt', content: 'blocked', expectedHash: null } },
    { name: 'shell', args: { command: 'touch blocked.txt' } },
    {
      name: 'web_fetch',
      args: { url: 'https://fixture.invalid/', method: 'POST', body: 'blocked' },
    },
  ])(
    'denies read-only $name before approval, writer admission or execution',
    async ({ name, args }) => {
      const f = await fixture();
      const fetch = vi
        .spyOn(execution, 'executeWebFetch')
        .mockRejectedValue(new Error('Web execution must not start'));
      let admissions = 0;
      const context: ToolRunContext = {
        ...f.context,
        readOnly: true,
        beforeTool: () => {
          admissions += 1;
          return Promise.resolve(() => undefined);
        },
      };
      try {
        const tool = f.runtime
          .createTools(context, f.runtime.selectToolset(context.session))
          .find((item) => item.name === name);
        if (!tool) throw new Error('Missing forbidden tool fixture');
        expect((await tool.execute('forbidden-call', args)).isError).toBe(true);
        expect(admissions).toBe(0);
        expect(fetch).not.toHaveBeenCalled();
        await expect(stat(join(f.directory, 'blocked.txt'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
        expect(f.events.filter((event) => event.type === 'tool.updated')).toMatchObject([
          { data: { tool: { status: 'denied', result: '当前运行仅允许只读操作。' } } },
        ]);
        const records = f.events.map((event) => event.data['tool']);
        expect(records).not.toContainEqual(
          expect.objectContaining({ status: 'awaiting_approval' }),
        );
        expect(records).not.toContainEqual(expect.objectContaining({ status: 'reviewing' }));
      } finally {
        fetch.mockRestore();
        await f.close();
      }
    },
  );

  it('rejects a competing write before touching its target and retains the failed call', async () => {
    const f = await fixture();
    try {
      const policies: boolean[] = [];
      f.context.beforeTool = (mutating) => {
        policies.push(mutating);
        return Promise.reject(new RuntimeError('TASK_WRITE_CONFLICT', 'Another task owns writes'));
      };
      const write = f.runtime
        .createTools(f.context, f.runtime.selectToolset(f.context.session))
        .find((tool) => tool.name === 'write_file');
      if (!write) throw new Error('Missing write tool');
      const result = await write.execute('write-call', {
        path: 'result.txt',
        content: 'must not be written',
        expectedHash: null,
      });
      expect(result.isError).toBe(true);
      expect(policies).toEqual([true]);
      await expect(stat(join(f.directory, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(f.events.filter((event) => event.type === 'tool.updated')).toMatchObject([
        { data: { tool: { status: 'failed', result: 'Another task owns writes' } } },
      ]);
    } finally {
      await f.close();
    }
  });

  it('releases an admitted write after the real operation and its terminal audit settle', async () => {
    const f = await fixture();
    try {
      let released = 0;
      f.context.beforeTool = (mutating) => {
        expect(mutating).toBe(true);
        return Promise.resolve(() => {
          expect(f.events.at(-1)?.type).toBe('tool.context');
          released += 1;
        });
      };
      const write = f.runtime
        .createTools(f.context, f.runtime.selectToolset(f.context.session))
        .find((tool) => tool.name === 'write_file');
      if (!write) throw new Error('Missing write tool');
      const result = await write.execute('write-call', {
        path: 'result.txt',
        content: 'owned output',
        expectedHash: null,
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(await readFile(join(f.directory, 'result.txt'), 'utf8')).toBe('owned output');
      expect(released).toBe(1);
    } finally {
      await f.close();
    }
  });

  it('passes the committed tool identity to task controls and releases a failed control', async () => {
    const f = await fixture();
    try {
      let released = 0;
      const calls: string[] = [];
      f.context.beforeTool = (mutating) => {
        expect(mutating).toBe(false);
        return Promise.resolve(() => {
          released += 1;
        });
      };
      f.context.agents = {
        has: (name) => name === 'spawn_agent',
        execute: (_name, _args, toolCallId) => {
          calls.push(toolCallId);
          expect(f.events.at(-1)?.type).toBe('tool.requested');
          return Promise.reject(new RuntimeError('TASK_LIMIT', 'Task limit reached'));
        },
      };
      const definition = {
        name: 'spawn_agent',
        description: 'Delegate a test task',
        parameters: Type.Object({}, { additionalProperties: false }),
      };
      const tool = f.runtime
        .createTools(f.context, f.runtime.selectToolset(f.context.session, [], [definition]))
        .find((entry) => entry.name === 'spawn_agent');
      if (!tool) throw new Error('Missing agent control');
      const result = await tool.execute('provider-call', {});
      expect(result.isError).toBe(true);
      expect(calls).toEqual([toolCallRecordId('run', 'assistant', 'provider-call')]);
      expect(released).toBe(1);
      expect(f.events.filter((event) => event.type === 'tool.updated')).toMatchObject([
        { data: { tool: { status: 'failed', result: 'Task limit reached' } } },
      ]);
    } finally {
      await f.close();
    }
  });
});
