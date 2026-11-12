import { Value } from 'typebox/value';
import type { MemoryMutationResult } from '@my-pi-harness/protocol';
import { describe, expect, it, vi } from 'vitest';
import { nativeTool } from '../src/workspace-tool-registry';
import type { ToolAvailability, ToolContext } from '../src/index';

const available: ToolAvailability = {
  workspace: false,
  work: true,
  skills: false,
  skillDirectory: false,
  agents: false,
  canSpawn: false,
  memoryMutations: true,
  images: true,
  platform: process.platform,
};
const result: MemoryMutationResult = {
  entry: null,
  receipt: {
    requestId: 'durable-id',
    memoryId: 'memory',
    operation: 'create',
    revision: 1,
    status: 'applied',
  },
};
const inputs = {
  save: { scope: 'user', category: 'preference', body: 'Be concise' },
  learn: { scope: 'workspace', category: 'fact', body: 'Use project commands' },
  update: { memoryId: 'memory', expectedRevision: 1, category: 'fact', body: 'Changed' },
  delete: { memoryId: 'memory', expectedRevision: 1 },
};

describe('direct memory mutation contributions', () => {
  it.each(['save', 'learn', 'update', 'delete'] as const)(
    '%s binds a default mutating operation and never accepts host authority from the model',
    async (name) => {
      const tool = nativeTool(`${name}_memory`);
      if (!tool) throw new Error('Missing memory tool');
      const input = inputs[name];
      expect(tool.loading).toBe('default');
      expect(tool.readOnly).toBe(false);
      expect(tool.source.kind).toBe('session');
      expect(tool.available(available)).toBe(true);
      expect(tool.available({ ...available, memoryMutations: false })).toBe(false);
      expect(tool.policy(input, false)).toEqual({
        summary: `${name}_memory`,
        mutating: true,
        approvalRequired: name === 'delete',
      });
      expect(Value.Check(tool.definition.parameters, input)).toBe(true);
      for (const extra of [
        { source: { kind: 'manual' } },
        { ownerUserId: 'forged' },
        { confirmed: true },
        { toolCallId: 'forged' },
        { workspaceId: 'other' },
        { learning: true },
      ])
        expect(Value.Check(tool.definition.parameters, { ...input, ...extra })).toBe(false);
      const handler = vi.fn(() => Promise.resolve(result));
      const ports: ToolContext = {
        owner: { sessionId: 'session', runId: 'run', taskId: null },
        readOnly: false,
        workspace: () => Promise.reject(new Error('No filesystem needed')),
        memory: {
          search: () => Promise.resolve({ entries: [], mode: 'lexical', truncated: false }),
          [name]: handler,
        },
      };
      const invocation = {
        toolCallId: 'actual-durable-tool',
        signal: new AbortController().signal,
      };
      const actual = await tool.bind(ports)(input, invocation);
      expect(handler).toHaveBeenCalledExactlyOnceWith(input, invocation);
      expect(actual.content).toEqual([{ type: 'text', text: JSON.stringify(result.receipt) }]);
      await expect(
        tool.bind({
          owner: ports.owner,
          readOnly: ports.readOnly,
          workspace: (signal) => ports.workspace(signal),
        })(input, invocation),
      ).rejects.toMatchObject({ code: 'MEMORY_UNAVAILABLE' });
    },
  );
});
