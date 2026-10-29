import { defaultAgentSettings, type AgentLimits } from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import { AgentBudget } from '../src/agents/budget.js';

function limits(overrides: Partial<AgentLimits> = {}): AgentLimits {
  return { ...defaultAgentSettings().limits, ...overrides };
}

describe('agent request budgets', () => {
  it('reserves concurrent requests atomically and replaces reservations with actual usage', async () => {
    const budget = new AgentBudget(limits({ tokenBudget: 1024, maxConcurrentRequests: 2 }));
    const first = await budget.request(400, 400, [], new AbortController().signal);
    await expect(budget.request(200, 200, [], new AbortController().signal)).rejects.toMatchObject({
      code: 'AGENT_BUDGET',
    });
    first(100);
    const next = await budget.request(500, 400, [], new AbortController().signal);
    next(200);
    const last = await budget.request(300, 300, [], new AbortController().signal);
    last(50);
  });

  it('checks each ancestor token ceiling without allocating another root balance', async () => {
    const budget = new AgentBudget(limits({ tokenBudget: 2048, maxConcurrentRequests: 3 }));
    const parent = { id: 'parent', limit: 600 };
    const first = await budget.request(
      200,
      200,
      [parent, { id: 'child-a', limit: 1024 }],
      new AbortController().signal,
    );
    await expect(
      budget.request(
        200,
        100,
        [parent, { id: 'child-b', limit: 1024 }],
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'AGENT_BUDGET' });
    first(50);
    const second = await budget.request(
      300,
      200,
      [parent, { id: 'child-b', limit: 1024 }],
      new AbortController().signal,
    );
    second(150);
  });

  it('charges the reservation when usage is unavailable and releases capacity after rejection', async () => {
    const budget = new AgentBudget(limits({ tokenBudget: 1024, maxConcurrentRequests: 1 }));
    const first = await budget.request(400, 400, [], new AbortController().signal);
    first(undefined);
    await expect(budget.request(200, 200, [], new AbortController().signal)).rejects.toMatchObject({
      code: 'AGENT_BUDGET',
    });
    const next = await budget.request(50, 50, [], new AbortController().signal);
    next(50);
  });

  it('removes aborted waiters without taking the next request capacity', async () => {
    const budget = new AgentBudget(limits({ maxConcurrentRequests: 1 }));
    const first = await budget.request(50, 50, [], new AbortController().signal);
    const cancelled = new AbortController();
    const pending = budget.request(50, 50, [], cancelled.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'AGENT_CANCELLED' });
    cancelled.abort(new Error('test cancellation'));
    await rejected;
    const next = budget.request(50, 50, [], new AbortController().signal);
    first(50);
    const release = await next;
    release(50);
  });

  it('honors a subtree concurrency ceiling without blocking another eligible subtree', async () => {
    const budget = new AgentBudget(limits({ maxConcurrentRequests: 3 }));
    const scope = { id: 'limited-parent', limit: 10_000, concurrency: 1 };
    const first = await budget.request(
      50,
      50,
      [scope, { id: 'a', limit: 10_000 }],
      new AbortController().signal,
    );
    const blockedController = new AbortController();
    let entered = false;
    const blocked = budget.request(
      50,
      50,
      [scope, { id: 'b', limit: 10_000 }],
      blockedController.signal,
    );
    const observed = blocked.then(
      () => {
        entered = true;
      },
      () => undefined,
    );
    let independent: ((usage: number | undefined) => void) | undefined;
    try {
      independent = await budget.request(
        50,
        50,
        [{ id: 'other', limit: 10_000, concurrency: 1 }],
        new AbortController().signal,
      );
      await Promise.resolve();
      expect(entered).toBe(false);
      first(50);
      const release = await blocked;
      release(50);
      await observed;
      expect(entered).toBe(true);
    } finally {
      blockedController.abort();
      first(50);
      independent?.(50);
      const release = await blocked.catch(() => undefined);
      release?.(50);
      await observed;
    }
  });

  it('settles a request once so duplicate release cannot bypass a concurrency ceiling', async () => {
    const budget = new AgentBudget(limits({ maxConcurrentRequests: 1 }));
    const first = await budget.request(50, 50, [], new AbortController().signal);
    first(50);
    first(50);
    const second = await budget.request(50, 50, [], new AbortController().signal);
    const controller = new AbortController();
    let entered = false;
    const pending = budget.request(50, 50, [], controller.signal);
    const observed = pending.then(
      () => {
        entered = true;
      },
      () => undefined,
    );
    try {
      await Promise.resolve();
      expect(entered).toBe(false);
      second(50);
      const release = await pending;
      release(50);
      await observed;
    } finally {
      controller.abort();
      second(50);
      const release = await pending.catch(() => undefined);
      release?.(50);
      await observed;
    }
  });
});
