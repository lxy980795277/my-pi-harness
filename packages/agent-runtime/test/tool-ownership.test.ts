import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionSummary } from '@my-pi-harness/protocol';
import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vitest';
import * as execution from '@my-pi-harness/execution';
import { RuntimeError } from '../src/errors.js';
import type { EventInput } from '../src/sessions/ports.js';
import { ToolRuntime } from '../src/tools/runtime.js';
import { recordHostToolOutcome, toolCallRecordId } from '../src/tools/ledger.js';
import { RunToolset } from '../src/tools/toolset.js';
import { SESSION_TOOL_DEFINITIONS } from '../src/work/tools.js';
import { AGENT_TOOL_DEFINITIONS } from '../src/agents/definitions.js';
import { DISCOVERY_TOOL_DEFINITIONS, SKILL_TOOL_DEFINITIONS } from '../src/capabilities/run.js';
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
        const records = f.events.flatMap((event) =>
          event.type === 'tool.requested' || event.type === 'tool.updated' ? [event.data.tool] : [],
        );
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

  it('preserves all 34 builtin declarations and rejects mismatched or unknown sources', async () => {
    const f = await fixture();
    try {
      const controls = [
        ...SESSION_TOOL_DEFINITIONS,
        ...AGENT_TOOL_DEFINITIONS,
        ...DISCOVERY_TOOL_DEFINITIONS,
        ...SKILL_TOOL_DEFINITIONS,
      ];
      expect(f.runtime.selectToolset(f.context.session, [], controls).definitions).toHaveLength(27);
      expect(f.runtime.selectToolset({ workspaceId: null }, [], controls).definitions).toHaveLength(
        21,
      );
      const full = f.runtime.selectToolset(
        f.context.session,
        [],
        controls,
        execution.OFFICE_TOOL_DEFINITIONS,
      );
      expect(f.runtime.createTools(f.context, full).map(({ name }) => name)).toEqual(
        full.definitions.map(({ name }) => name),
      );
      expect(new Set(full.definitions.map(({ name }) => name)).size).toBe(34);
      for (const selection of [
        {
          source: { kind: 'session' as const },
          definition: {
            name: 'read_file',
            description: 'Wrong source',
            parameters: Type.Object({}),
          },
        },
        {
          source: { kind: 'workspace' as const },
          definition: {
            name: 'ask_user',
            description: 'Wrong source',
            parameters: Type.Object({}),
          },
        },
        {
          source: { kind: 'session' as const },
          definition: {
            name: 'unknown_control',
            description: 'No owned handler',
            parameters: Type.Object({}),
          },
        },
      ]) {
        const tools = new RunToolset([selection]);
        const executable = f.runtime.createTools(f.context, tools)[0];
        if (!executable) throw new Error('Missing accepted definition');
        expect(executable.name).toBe(selection.definition.name);
        const result = executable.execute(selection.definition.name, {});
        if (selection.source.kind === 'workspace') await expect(result).rejects.toThrow();
        else expect((await result).isError).toBe(true);
      }
      expect(f.events.filter(({ type }) => type === 'tool.context')).toHaveLength(2);
      expect(f.events.filter(({ type }) => type === 'tool.requested')).toMatchObject([
        { data: { tool: { name: 'read_file', binding: { kind: 'accepted' } } } },
        { data: { tool: { name: 'unknown_control', binding: { kind: 'accepted' } } } },
      ]);
    } finally {
      await f.close();
    }
  });

  it('does not let unrelated controller predicates capture a workspace invocation', async () => {
    const f = await fixture();
    const wrongRoute = vi.fn(() => Promise.reject(new Error('Wrong controller family')));
    try {
      f.context.agents = { has: () => true, execute: wrongRoute };
      await writeFile(join(f.directory, 'observed.txt'), 'actual file');
      const read = f.runtime
        .createTools(f.context, f.runtime.selectToolset(f.context.session))
        .find(({ name }) => name === 'read_file');
      if (!read) throw new Error('Missing read tool');
      const result = await read.execute('owned-route', { path: 'observed.txt' });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.content)).toContain('actual file');
      expect(wrongRoute).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });

  it.each(['failed', 'interrupted'] as const)(
    'records a host %s outcome and its canonical context once in one batch',
    async (status) => {
      const f = await fixture();
      const commit = vi.spyOn(f.context, 'commit');
      try {
        const call = {
          assistantMessageId: 'assistant',
          providerCallId: 'host-call',
          name: 'read_file',
          arguments: { path: 'input.txt', startLine: 0.5 },
        };
        const outcome = {
          status,
          reason: 'Not dispatched',
          content: [{ type: 'text' as const, text: 'Original SDK result' }],
        };
        expect(recordHostToolOutcome(f.context, call, outcome)).toBe(true);
        expect(recordHostToolOutcome(f.context, call, outcome)).toBe(false);
        expect(commit).toHaveBeenCalledTimes(1);
        expect(commit.mock.calls[0]?.[0].map(({ type }) => type)).toEqual([
          'tool.requested',
          'tool.context',
        ]);
        expect(f.events[0]?.data).toMatchObject({
          tool: {
            status,
            arguments: call.arguments,
            binding: { kind: 'rejected' },
            dispatch: { state: 'not_applicable' },
          },
        });
        if (status === 'interrupted')
          expect(f.events[0]?.data).toHaveProperty('afterMessageId', 'assistant');
        else expect(f.events[0]?.data).not.toHaveProperty('afterMessageId');
        expect(f.events[1]?.data).toMatchObject({ afterMessageId: 'assistant' });
        expect(f.events[1]?.privateData).toMatchObject({
          origin: 'host',
          outcome: status,
          isError: true,
          providerCallId: 'host-call',
          content: outcome.content,
        });
        expect(f.context.recorded.size).toBe(1);
      } finally {
        await f.close();
      }
    },
  );

  it('does not mark an SDK-rejected call recorded when its atomic journal commit fails', async () => {
    const f = await fixture();
    const commit = vi.spyOn(f.context, 'commit').mockImplementationOnce(() => {
      throw new Error('Journal unavailable');
    });
    try {
      const call = {
        assistantMessageId: 'assistant',
        providerCallId: 'host-call',
        name: 'read_file',
        arguments: {},
      };
      const outcome = {
        status: 'failed' as const,
        reason: 'Rejected',
        content: [{ type: 'text' as const, text: 'Rejected' }],
      };
      expect(() => recordHostToolOutcome(f.context, call, outcome)).toThrow('Journal unavailable');
      expect(f.context.recorded.size).toBe(0);
      expect(f.events).toEqual([]);
      expect(recordHostToolOutcome(f.context, call, outcome)).toBe(true);
      expect(commit).toHaveBeenCalledTimes(2);
    } finally {
      await f.close();
    }
  });

  it.each([false, true])(
    'stops a Skill grant revocation only after its terminal context commits (journal failure=%s)',
    async (failJournal) => {
      const f = await fixture();
      const stop = vi.fn(() => {
        expect(f.events.at(-1)?.type).toBe('tool.context');
      });
      try {
        const definition = SKILL_TOOL_DEFINITIONS.find(({ name }) => name === 'revoke_skill_tools');
        if (!definition) throw new Error('Missing Skill revoke declaration');
        f.context.controls = {
          has: (name) => name === definition.name,
          execute: () => Promise.resolve([{ type: 'text', text: 'Grant revoked' }]),
        };
        f.context.stopAfterTool = stop;
        if (failJournal)
          vi.spyOn(f.context, 'commit').mockImplementation((events) => {
            if (events.some(({ type }) => type === 'tool.context'))
              throw new Error('Terminal journal unavailable');
            f.events.push(...events);
          });
        const tool = f.runtime
          .createTools(f.context, f.runtime.selectToolset(f.context.session, [], [definition]))
          .find(({ name }) => name === definition.name);
        if (!tool) throw new Error('Missing Skill revoke tool');
        const result = tool.execute('revoke', { skillId: 'skill' });
        if (failJournal) {
          await expect(result).rejects.toThrow('Terminal journal unavailable');
          expect(stop).not.toHaveBeenCalled();
        } else {
          expect((await result).isError).not.toBe(true);
          expect(stop).toHaveBeenCalledExactlyOnceWith('本次运行的工具授权已撤销。');
        }
      } finally {
        await f.close();
      }
    },
  );
});
