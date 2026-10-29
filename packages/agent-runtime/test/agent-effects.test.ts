import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { text as streamText } from 'node:stream/consumers';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';
import type { ExternalTools, FrozenMcpTool } from '../src/tools/external.js';
import {
  agentChanged,
  agentFixture,
  agentGate,
  agentsIdle,
  firstTask,
  waitAtGate,
} from './support/agent-fixture.js';
import { delegate, hasResult, waitForResults } from './support/agent-tools.js';
import { call } from './support/work-fixture.js';

const mutation: FrozenMcpTool = {
  selection: {
    serverId: 'synthetic-service',
    serverRevision: 1,
    remoteToolName: 'mutate',
    definitionFingerprint: 'a'.repeat(64),
  },
  definition: {
    name: 'mcp_mutate',
    description: 'Synthetic remote mutation',
    parameters: Type.Object({}, { additionalProperties: false }),
  },
  authorization: {
    ownerId: 'synthetic-owner',
    identityEpoch: 1,
    accessEpoch: 1,
    credentialEpoch: 1,
    grantId: 'synthetic-grant',
    workspaceId: '',
    workspaceRoot: 'https://fixture.invalid',
    scope: 'full-access',
    startupFingerprint: 'b'.repeat(64),
  },
};

describe('Agent tree effect ownership', () => {
  it('fails the root on an unknown dispatched child effect and aborts its sibling without retrying', async () => {
    const siblingStarted = agentGate();
    const siblingBlocked = agentGate();
    let siblingAborted = false;
    let effectCalls = 0;
    let unexpectedRequests = 0;
    const external: ExternalTools = {
      freezeSelections: (_workspace, _mode, selected) =>
        Promise.resolve(selected.length > 0 ? [mutation] : []),
      restoreBindings: (tools) => Promise.resolve(tools),
      validateBindings: () => Promise.resolve(),
      assertBindingsCurrent: () => undefined,
      call: async (input) => {
        effectCalls += 1;
        await input.beforeDispatch();
        await waitAtGate(siblingStarted, input.signal);
        return { kind: 'unknown', message: 'Synthetic mutation outcome unknown' };
      },
    };
    const f = await agentFixture({
      approvalMode: 'full-access',
      externalTools: external,
      beforeStream: async (context, signal) => {
        if (firstTask(context) !== 'UNKNOWN_SIBLING') return;
        siblingStarted.release();
        try {
          await waitAtGate(siblingBlocked, signal);
        } catch (error) {
          siblingAborted = signal?.aborted === true;
          throw error;
        }
      },
      response: (context) => {
        const task = firstTask(context);
        if (task === 'UNKNOWN_WRITER') {
          if (!hasResult(context, 'mcp_mutate')) return call('mcp_mutate', {}, 'external-effect');
          unexpectedRequests += 1;
          return fauxAssistantMessage('A second child request must not happen');
        }
        if (task === 'UNKNOWN_SIBLING') {
          unexpectedRequests += 1;
          return fauxAssistantMessage('Sibling must remain aborted');
        }
        if (!hasResult(context, 'spawn_agent'))
          return fauxAssistantMessage(
            [
              {
                type: 'toolCall',
                id: 'writer',
                name: 'spawn_agent',
                arguments: { title: 'Unknown writer', task: 'UNKNOWN_WRITER', roleId: 'worker' },
              },
              {
                type: 'toolCall',
                id: 'sibling',
                name: 'spawn_agent',
                arguments: { title: 'Sibling', task: 'UNKNOWN_SIBLING', roleId: 'researcher' },
              },
            ],
            { stopReason: 'toolUse' },
          );
        if (!hasResult(context, 'wait_agents')) return waitForResults(context);
        unexpectedRequests += 1;
        return fauxAssistantMessage('Root must not summarize an unknown mutation as success');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_UNKNOWN',
        mode: 'send',
        requestId: 'unknown-effect',
        mcpTools: [mutation.selection],
      });
      await agentsIdle(f);
      const root = f.runtime.getSnapshot(f.session.id);
      expect(root.runs[0]?.status).toBe('failed');
      expect(root.runs[0]?.error).toBe('Synthetic mutation outcome unknown');
      const tasks = f.runtime.agents.list(f.session.id).tasks;
      expect(tasks).toHaveLength(2);
      const writer = tasks.find((task) => task.title === 'Unknown writer');
      const sibling = tasks.find((task) => task.title === 'Sibling');
      if (!writer || !sibling) throw new Error('Missing effect task tree');
      const child = f.store.getTaskSnapshot(f.session.id, writer.id);
      expect(child.runs[0]?.status).toBe('failed');
      expect(child.tools.filter((tool) => tool.name === 'mcp_mutate')).toHaveLength(1);
      expect(child.tools.find((tool) => tool.name === 'mcp_mutate')).toMatchObject({
        status: 'unknown',
        dispatch: { state: 'may_have_started' },
      });
      expect(siblingAborted).toBe(true);
      expect(sibling.closedAt).not.toBeNull();
      expect(['failed', 'cancelled']).toContain(sibling.status);
      expect(effectCalls).toBe(1);
      expect(unexpectedRequests).toBe(0);
      expect(tasks.every((task) => task.closedAt !== null)).toBe(true);
      const log = await streamText(f.store.exportSessionLog(f.session.id).content);
      expect(log).toContain('"status":"unknown"');
      expect(log).toContain('Synthetic mutation outcome unknown');
      expect(f.leases()).toEqual({ acquired: 3, released: 3 });
    } finally {
      siblingBlocked.release();
      await f.close();
    }
  });

  it('returns a nested writer past an already-closing parent so the root can write after joining', async () => {
    const leafBlocked = agentGate();
    const f = await agentFixture({
      workspace: true,
      approvalMode: 'full-access',
      beforeStream: async (context, signal) => {
        if (firstTask(context) === 'WRITER_LEAF') await waitAtGate(leafBlocked, signal);
      },
      response: (context) => {
        const task = firstTask(context);
        if (task === 'WRITER_LEAF') {
          if (!hasResult(context, 'write_file'))
            return call(
              'write_file',
              { path: 'leaf.txt', content: 'leaf written', expectedHash: null },
              'leaf-write',
            );
          return fauxAssistantMessage('Leaf completed');
        }
        if (task === 'WRITER_PARENT') {
          if (!hasResult(context, 'spawn_agent'))
            return delegate('Leaf writer', 'WRITER_LEAF', 'leaf-spawn', 'worker');
          return fauxAssistantMessage('Parent B answered before its leaf ended');
        }
        if (!hasResult(context, 'spawn_agent'))
          return delegate('Intermediate writer', 'WRITER_PARENT', 'parent-spawn', 'worker');
        if (!hasResult(context, 'wait_agents')) return waitForResults(context);
        if (!hasResult(context, 'write_file'))
          return call(
            'write_file',
            { path: 'root.txt', content: 'root writer restored', expectedHash: null },
            'root-write',
          );
        return fauxAssistantMessage('Nested writer tree settled');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_NESTED_WRITER',
        mode: 'send',
        requestId: 'nested-writer',
      });
      await agentChanged(
        f,
        () => {
          const parent = f.runtime.agents
            .list(f.session.id)
            .tasks.find((task) => task.title === 'Intermediate writer');
          return (
            parent !== undefined &&
            f.store
              .getTaskSnapshot(f.session.id, parent.id)
              .messages.some(
                (message) =>
                  message.text === 'Parent B answered before its leaf ended' &&
                  message.status === 'complete',
              )
          );
        },
        'Intermediate writer did not enter its join phase',
      );
      expect(f.runtime.getSnapshot(f.session.id).session.activeRunId).not.toBeNull();
      leafBlocked.release();
      await agentsIdle(f);
      expect(await readFile(join(f.directory, 'workspace', 'leaf.txt'), 'utf8')).toBe(
        'leaf written',
      );
      expect(await readFile(join(f.directory, 'workspace', 'root.txt'), 'utf8')).toBe(
        'root writer restored',
      );
      expect(
        f.runtime.agents
          .list(f.session.id)
          .tasks.every((task) => task.status === 'completed' && task.closedAt !== null),
      ).toBe(true);
      expect(
        f.runtime.getSnapshot(f.session.id).tools.find((tool) => tool.name === 'write_file')
          ?.status,
      ).toBe('completed');
      expect(f.errors).toEqual([]);
    } finally {
      leafBlocked.release();
      await f.close();
    }
  });
});
