import { describe, expect, it } from 'vitest';
import { AgentRequestScheduler } from '../src/agents/request-scheduler.js';

describe('agent model request scheduling', () => {
  it('admits only the configured number of requests and wakes waiters in order', async () => {
    const scheduler = new AgentRequestScheduler(2);
    const first = await scheduler.request([], new AbortController().signal);
    const second = await scheduler.request([], new AbortController().signal);
    const controller = new AbortController();
    const entered: string[] = [];
    const third = scheduler.request([], controller.signal);
    const fourth = scheduler.request([], controller.signal);
    const observed = Promise.all([
      third.then(
        () => entered.push('third'),
        () => undefined,
      ),
      fourth.then(
        () => entered.push('fourth'),
        () => undefined,
      ),
    ]);
    try {
      await Promise.resolve();
      expect(entered).toEqual([]);
      first();
      const releaseThird = await third;
      await Promise.resolve();
      expect(entered).toEqual(['third']);
      second();
      const releaseFourth = await fourth;
      await observed;
      expect(entered).toEqual(['third', 'fourth']);
      releaseThird();
      releaseFourth();
    } finally {
      controller.abort();
      first();
      second();
      (await third.catch(() => undefined))?.();
      (await fourth.catch(() => undefined))?.();
      await observed;
    }
  });

  it('removes aborted waiters without taking the next request slot', async () => {
    const scheduler = new AgentRequestScheduler(1);
    const first = await scheduler.request([], new AbortController().signal);
    const cancelled = new AbortController();
    const pending = scheduler.request([], cancelled.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'AGENT_CANCELLED' });
    cancelled.abort(new Error('test cancellation'));
    await rejected;
    const next = scheduler.request([], new AbortController().signal);
    first();
    const release = await next;
    release();
  });

  it('rejects an already cancelled request without occupying a slot', async () => {
    const scheduler = new AgentRequestScheduler(1);
    const cancelled = new AbortController();
    const reason = new Error('cancelled before admission');
    cancelled.abort(reason);
    await expect(scheduler.request([], cancelled.signal)).rejects.toBe(reason);
    const release = await scheduler.request([], new AbortController().signal);
    release();
  });

  it('returns a granted slot when cancellation arrives before admission resumes', async () => {
    const scheduler = new AgentRequestScheduler(1);
    const cancelled = new AbortController();
    const pending = scheduler.request([], cancelled.signal);
    const reason = new Error('cancelled during admission');
    cancelled.abort(reason);
    await expect(pending).rejects.toBe(reason);
    const release = await scheduler.request([], new AbortController().signal);
    release();
  });

  it('honors every ancestor ceiling while skipping a blocked subtree at the queue head', async () => {
    const scheduler = new AgentRequestScheduler(3);
    const scope = { id: 'limited-parent', concurrency: 1 };
    const first = await scheduler.request(
      [scope, { id: 'a', concurrency: 2 }],
      new AbortController().signal,
    );
    const blockedController = new AbortController();
    let entered = false;
    const blocked = scheduler.request(
      [scope, { id: 'b', concurrency: 2 }],
      blockedController.signal,
    );
    const observed = blocked.then(
      () => {
        entered = true;
      },
      () => undefined,
    );
    let independent: (() => void) | undefined;
    try {
      independent = await scheduler.request(
        [{ id: 'other', concurrency: 1 }],
        new AbortController().signal,
      );
      await Promise.resolve();
      expect(entered).toBe(false);
      first();
      const release = await blocked;
      release();
      await observed;
      expect(entered).toBe(true);
    } finally {
      blockedController.abort();
      first();
      independent?.();
      (await blocked.catch(() => undefined))?.();
      await observed;
    }
  });

  it('releases a request once so repeated cleanup cannot bypass a concurrency ceiling', async () => {
    const scheduler = new AgentRequestScheduler(1);
    const first = await scheduler.request([], new AbortController().signal);
    first();
    first();
    const second = await scheduler.request([], new AbortController().signal);
    const controller = new AbortController();
    let entered = false;
    const pending = scheduler.request([], controller.signal);
    const observed = pending.then(
      () => {
        entered = true;
      },
      () => undefined,
    );
    try {
      await Promise.resolve();
      expect(entered).toBe(false);
      second();
      const release = await pending;
      release();
      await observed;
    } finally {
      controller.abort();
      second();
      (await pending.catch(() => undefined))?.();
      await observed;
    }
  });
});
