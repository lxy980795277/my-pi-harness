import { fauxAssistantMessage, type Usage } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { agentFixture, agentsIdle, firstTask } from './support/agent-fixture.js';
import { delegate, hasResult, resultCount, waitForResults } from './support/agent-tools.js';
import { call } from './support/work-fixture.js';

const reported: Usage = {
  input: 12_000,
  output: 500,
  cacheRead: 24_546,
  cacheWrite: 0,
  totalTokens: 37_046,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const unavailable: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe('Agent usage facts through real Pi and temporary journals', () => {
  it('rejects a retired token budget in delegation arguments without creating a task', async () => {
    let rejected = false;
    const f = await agentFixture({
      response: (context) => {
        const result = context.messages.find(
          (message) => message.role === 'toolResult' && message.toolName === 'spawn_agent',
        );
        if (result?.role === 'toolResult') {
          rejected = result.isError;
          return fauxAssistantMessage('Delegation arguments were rejected; no task was started');
        }
        return call(
          'spawn_agent',
          {
            title: 'Rejected budget',
            task: 'This task must not start',
            roleId: 'researcher',
            limits: { tokenBudget: 200_000 },
          },
          'retired-budget',
        );
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'ROOT_RETIRED_LIMIT',
        mode: 'send',
        requestId: 'retired-limit',
      });
      await agentsIdle(f);
      expect(rejected).toBe(true);
      expect(f.runtime.agents.list(f.session.id).tasks).toEqual([]);
      expect(f.runtime.getSnapshot(f.session.id).runs[0]?.status).toBe('completed');
      expect(f.requests).toHaveLength(2);
      expect(f.leases()).toEqual({ acquired: 1, released: 1 });
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it.each([
    { kind: 'reported', preDelegationRequests: 9, usage: reported },
    { kind: 'unavailable', preDelegationRequests: 14, usage: unavailable },
  ])(
    'completes first delegation and nested result collection after $kind usage',
    async ({ kind, preDelegationRequests, usage }) => {
      const f = await agentFixture({
        settings: (settings) => ({
          ...settings,
          limits: { ...settings.limits, maxConcurrentRequests: 1, maxTurns: 32 },
        }),
        reportedUsage: () => usage,
        response: (context) => {
          const task = firstTask(context);
          if (task === 'USAGE_LEAF') return fauxAssistantMessage('Leaf usage observation');
          if (task === 'USAGE_PARENT') {
            if (!hasResult(context, 'spawn_agent')) return delegate('Usage leaf', 'USAGE_LEAF');
            if (!hasResult(context, 'wait_agents')) return waitForResults(context);
            return fauxAssistantMessage('Parent collected the leaf');
          }
          const preparatory = resultCount(context, 'get_plan');
          if (preparatory < preDelegationRequests)
            return call('get_plan', {}, `prepare-${String(preparatory)}`);
          if (!hasResult(context, 'spawn_agent')) return delegate('Usage parent', 'USAGE_PARENT');
          if (!hasResult(context, 'wait_agents')) return waitForResults(context);
          return fauxAssistantMessage('Root summarized the complete task tree');
        },
      });
      try {
        await f.runtime.send(f.session.id, {
          text: 'ROOT_USAGE',
          mode: 'send',
          requestId: kind,
        });
        await agentsIdle(f);
        const root = f.runtime.getSnapshot(f.session.id);
        const tasks = f.runtime.agents.list(f.session.id).tasks;
        expect(root.runs[0]).toMatchObject({ status: 'completed', error: null });
        expect(root.messages.at(-1)?.text).toBe('Root summarized the complete task tree');
        expect(root.tools.find((tool) => tool.name === 'wait_agents')?.result).toContain(
          'Parent collected the leaf',
        );
        expect(tasks).toHaveLength(2);
        expect(tasks.every((task) => task.status === 'completed' && task.closedAt !== null)).toBe(
          true,
        );
        const parent = tasks.find((task) => task.title === 'Usage parent');
        const leaf = tasks.find((task) => task.title === 'Usage leaf');
        if (!parent || !leaf) throw new Error('Missing completed usage task tree');
        expect(leaf.parentTaskId).toBe(parent.id);
        const parentSnapshot = f.store.getTaskSnapshot(f.session.id, parent.id);
        const leafSnapshot = f.store.getTaskSnapshot(f.session.id, leaf.id);
        expect(parentSnapshot.tools.find((tool) => tool.name === 'wait_agents')?.result).toContain(
          'Leaf usage observation',
        );
        const assistants = root.messages.filter((message) => message.role === 'assistant');
        if (kind === 'reported') {
          const priorUsage = assistants
            .slice(0, preDelegationRequests)
            .reduce((total, message) => total + (message.usage?.totalTokens ?? 0), 0);
          expect(priorUsage).toBe(333_414);
          expect(priorUsage).toBeGreaterThan(200_000);
          expect(leaf.usage).toEqual({
            inputTokens: reported.input,
            outputTokens: reported.output,
            cacheReadTokens: reported.cacheRead,
            cacheWriteTokens: reported.cacheWrite,
            totalTokens: reported.totalTokens,
          });
          expect(parent.usage).toEqual({
            inputTokens: reported.input * 4,
            outputTokens: reported.output * 4,
            cacheReadTokens: reported.cacheRead * 4,
            cacheWriteTokens: reported.cacheWrite * 4,
            totalTokens: reported.totalTokens * 4,
          });
        } else {
          expect(assistants.every((message) => message.usage === undefined)).toBe(true);
          expect(parentSnapshot.messages.every((message) => message.usage === undefined)).toBe(
            true,
          );
          expect(leafSnapshot.messages.every((message) => message.usage === undefined)).toBe(true);
          expect(parent.usage).toBeNull();
          expect(leaf.usage).toBeNull();
        }
        expect(f.requests.filter((request) => request.task === 'ROOT_USAGE')).toHaveLength(
          preDelegationRequests + 3,
        );
        expect(f.requests.filter((request) => request.task === 'USAGE_PARENT')).toHaveLength(3);
        expect(f.requests.filter((request) => request.task === 'USAGE_LEAF')).toHaveLength(1);
        expect(f.maxRequests()).toBe(1);
        expect(f.leases()).toEqual({ acquired: 3, released: 3 });
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );
});
