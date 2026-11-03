import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';
import { agentFixture, agentsIdle } from './support/agent-fixture.js';
import { delegate, hasResult, waitForResults } from './support/agent-tools.js';

describe('Shared preparation of root and delegated Runs', () => {
  it('preserves root selection defaults, child field absence and each atomic acceptance batch', async () => {
    const f = await agentFixture({
      response: (context) => {
        if (
          context.messages.some(
            (message) => message.role === 'user' && message.content === 'CHILD_FIELDS',
          )
        )
          return fauxAssistantMessage('Child result');
        if (!hasResult(context, 'spawn_agent')) return delegate('Child fields', 'CHILD_FIELDS');
        if (!hasResult(context, 'wait_agents')) return waitForResults(context);
        return fauxAssistantMessage('Parent result');
      },
    });
    const append = vi.spyOn(f.store, 'append');
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_FIELDS',
        mode: 'send',
        requestId: 'fields',
      });
      await agentsIdle(f);
      const root = f.runtime.getSnapshot(f.session.id);
      const task = f.runtime.subagents.list(f.session.id).tasks[0];
      if (!task) throw new Error('Missing delegated task');
      const child = f.store.getTaskSnapshot(f.session.id, task.id);
      const rootUser = root.messages.find((message) => message.role === 'user');
      const childUser = child.messages.find((message) => message.role === 'user');
      expect(rootUser).toMatchObject({
        text: 'ROOT_FIELDS',
        thinking: '',
        mcpTools: [],
        skills: [],
      });
      expect(childUser).toMatchObject({ text: 'CHILD_FIELDS', thinking: '' });
      expect(Object.keys(rootUser ?? {}).sort()).toEqual([
        'branchId',
        'createdAt',
        'id',
        'mcpTools',
        'role',
        'runId',
        'sessionId',
        'skills',
        'status',
        'stopReason',
        'text',
        'thinking',
      ]);
      expect(Object.keys(childUser ?? {}).sort()).toEqual([
        'branchId',
        'createdAt',
        'id',
        'role',
        'runId',
        'sessionId',
        'status',
        'stopReason',
        'text',
        'thinking',
      ]);
      for (const snapshot of [root, child]) {
        const run = snapshot.runs[0];
        if (!run) throw new Error('Missing accepted Run');
        const batch = append.mock.calls
          .map(([, events]) => events)
          .find((events) =>
            events.some((event) => event.type === 'run.accepted' && event.runId === run.id),
          );
        expect(batch?.map((event) => event.type)).toEqual([
          'work.updated',
          'run.accepted',
          'message.started',
        ]);
        const user = snapshot.messages.find((message) => message.role === 'user');
        expect(batch?.[0]?.at).toBe(user?.createdAt);
        expect(batch?.[1]?.at).toBe(run.createdAt);
        expect(batch?.[2]?.at).toBe(user?.createdAt);
        expect(user?.createdAt).toBeGreaterThanOrEqual(run.createdAt);
        if (run.taskId === undefined) expect(user?.createdAt).toBe(run.createdAt);
      }
      expect(f.leases()).toEqual({ acquired: 2, released: 2 });
      expect(f.errors).toEqual([]);
    } finally {
      append.mockRestore();
      await f.close();
    }
  });

  it.each(['text', 'thinking'] as const)(
    'rejects unsupported root %s before acceptance and releases its lease',
    async (capability) => {
      const f = await agentFixture({
        model: (original) => ({
          ...original,
          ...(capability === 'text' ? { input: ['image'] } : { reasoning: false }),
        }),
        response: () => fauxAssistantMessage('An unsupported model must never be requested'),
      });
      try {
        if (capability === 'thinking')
          await f.runtime.updateSession(f.session.id, { thinkingLevel: 'high' });
        await expect(
          f.runtime.send(f.session.id, {
            text: 'Validate model capabilities',
            mode: 'send',
            requestId: `root-${capability}`,
          }),
        ).rejects.toMatchObject({ code: 'MODEL_CAPABILITY' });
        expect(f.runtime.getSnapshot(f.session.id).runs).toEqual([]);
        expect(f.requests).toEqual([]);
        expect(f.leases()).toEqual({ acquired: 1, released: 1 });
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );

  it.each(['text', 'thinking'] as const)(
    'rejects a role model lacking %s before child acceptance while the parent can finish',
    async (capability) => {
      const f = await agentFixture({
        model: (original, id) =>
          id === 'unsupported'
            ? {
                ...original,
                id,
                ...(capability === 'text' ? { input: ['image'] } : { reasoning: false }),
              }
            : original,
        settings: (settings) => ({
          ...settings,
          roles: settings.roles.map((role) =>
            role.id === 'researcher'
              ? {
                  ...role,
                  providerId: 'role-provider',
                  modelId: 'unsupported',
                  thinkingLevel: capability === 'thinking' ? 'high' : 'off',
                }
              : role,
          ),
        }),
        response: (context) => {
          if (!hasResult(context, 'spawn_agent'))
            return delegate('Unsupported role model', 'CHILD_CAPABILITY');
          if (!hasResult(context, 'wait_agents')) return waitForResults(context);
          return fauxAssistantMessage('The unavailable child was collected');
        },
      });
      try {
        await f.runtime.send(f.session.id, {
          text: 'ROOT_CAPABILITY',
          mode: 'send',
          requestId: `child-${capability}`,
        });
        await agentsIdle(f);
        const task = f.runtime.subagents.list(f.session.id).tasks[0];
        if (!task) throw new Error('The parent did not create the child task');
        expect(task).toMatchObject({ status: 'failed', closeReason: 'failed', latestRunId: null });
        expect(f.store.getTaskSnapshot(f.session.id, task.id).runs).toEqual([]);
        expect(f.requests.some((request) => request.task === 'CHILD_CAPABILITY')).toBe(false);
        expect(f.runtime.getSnapshot(f.session.id).runs[0]?.status).toBe('completed');
        expect(f.leases()).toEqual({ acquired: 2, released: 2 });
        expect(f.errors).toEqual([expect.objectContaining({ code: 'MODEL_CAPABILITY' })]);
      } finally {
        await f.close();
      }
    },
  );
});
