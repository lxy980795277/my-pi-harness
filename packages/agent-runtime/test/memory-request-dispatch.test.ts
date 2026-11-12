import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
  normalizeContext,
  type Message,
} from '@earendil-works/pi-ai';
import type { MemoryRequestSnapshot } from '@my-pi-harness/protocol/internal';
import { describe, expect, it, vi } from 'vitest';
import { dispatchRequest } from '../src/runs/request';
import type { PreparedContext } from '../src/context/request-context';
import { AgentRequestScheduler } from '../src/subagents/request-scheduler';

const model = fauxProvider().models[0];
const previous: MemoryRequestSnapshot = {
  fingerprint: 'a'.repeat(64),
  entries: [
    {
      id: 'fact',
      scope: { kind: 'user' },
      category: 'fact',
      body: 'old fact',
      revision: 1,
      source: { kind: 'manual' },
    },
  ],
};

function draft(memory: MemoryRequestSnapshot, commit: () => void): PreparedContext {
  return {
    memory,
    messages: [{ role: 'system', content: JSON.stringify(memory), timestamp: 1 }],
    isCurrent: () => true,
    commit,
  };
}

function terminal() {
  const result = createAssistantMessageEventStream();
  const message = fauxAssistantMessage('done');
  result.push({ type: 'done', reason: 'stop', message });
  result.end(message);
  return result;
}

describe('memory dispatch after shared request admission', () => {
  it.each(['edit', 'forget'] as const)(
    'releases stale admission before %s reprojection and a concurrency-one summary',
    async (change) => {
      const scheduler = new AgentRequestScheduler(1);
      const controller = new AbortController();
      const occupied = await scheduler.request([], controller.signal);
      let current = previous;
      const committed = vi.fn();
      let prepared = draft(previous, committed);
      const provider = vi.fn((_model, context: { messages: Message[] }) => {
        expect(JSON.stringify(context.messages)).not.toContain('old fact');
        return Promise.resolve(terminal());
      });
      const reprepare = vi.fn(async () => {
        // The actual compaction stream uses the same scheduler; this would deadlock under the stale lease.
        const summaryLease = await scheduler.request([], controller.signal);
        summaryLease();
        prepared = draft(current, committed);
      });
      const request = dispatchRequest({
        identity: { sessionId: 'session', workspaceId: null, query: '', signal: controller.signal },
        hooks: {
          acquireRequest: (signal) => scheduler.request([], signal),
          trackRequest: () => undefined,
        },
        memory: {
          readSnapshot: () => Promise.resolve(current),
          isCurrent: (_input, fingerprint) => fingerprint === current.fingerprint,
        },
        draft: () => prepared,
        prepare: reprepare,
        validate: () => Promise.resolve(),
        stream: provider,
        onError: () => undefined,
      })(model, normalizeContext({ messages: [] }), { signal: controller.signal });
      current = {
        fingerprint: 'b'.repeat(64),
        entries:
          change === 'forget'
            ? []
            : previous.entries.map((entry) => ({ ...entry, body: 'new fact', revision: 2 })),
      };
      occupied();
      await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
      await request;
      expect(reprepare).toHaveBeenCalledOnce();
      expect(committed).toHaveBeenCalledOnce();
      const released = await scheduler.request([], controller.signal);
      released();
    },
  );

  it('cancels an admitted waiter without recording or sending its draft', async () => {
    const scheduler = new AgentRequestScheduler(1);
    const signal = new AbortController();
    const occupied = await scheduler.request([], signal.signal);
    const cancelled = new AbortController();
    const commit = vi.fn();
    const provider = vi.fn(() => Promise.resolve(terminal()));
    const pending = dispatchRequest({
      identity: { sessionId: 'session', workspaceId: null, query: '', signal: cancelled.signal },
      hooks: {
        acquireRequest: (abort) => scheduler.request([], abort),
        trackRequest: () => undefined,
      },
      draft: () => draft(previous, commit),
      prepare: () => Promise.resolve(),
      validate: () => Promise.resolve(),
      stream: provider,
      onError: () => undefined,
    })(model, normalizeContext({ messages: [] }), { signal: cancelled.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'AGENT_CANCELLED' });
    cancelled.abort();
    await rejected;
    expect(commit).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    occupied();
    (await scheduler.request([], signal.signal))();
  });

  it('keeps concurrency occupied after returning a stream until its terminal result settles', async () => {
    const scheduler = new AgentRequestScheduler(1);
    const controller = new AbortController();
    const result = createAssistantMessageEventStream();
    const dispatched = dispatchRequest({
      identity: { sessionId: 'session', workspaceId: null, query: '', signal: controller.signal },
      hooks: {
        acquireRequest: (signal) => scheduler.request([], signal),
        trackRequest: () => undefined,
      },
      draft: () => draft(previous, () => undefined),
      prepare: () => Promise.resolve(),
      validate: () => Promise.resolve(),
      stream: () => Promise.resolve(result),
      onError: () => undefined,
    })(model, normalizeContext({ messages: [] }), { signal: controller.signal });
    await dispatched;
    let nextEntered = false;
    const next = scheduler.request([], controller.signal).then((release) => {
      nextEntered = true;
      return release;
    });
    await Promise.resolve();
    expect(nextEntered).toBe(false);
    result.end(fauxAssistantMessage('settled'));
    (await next)();
  });

  it('bounds local churn and never sends an abandoned draft or leaks an admission slot', async () => {
    const scheduler = new AgentRequestScheduler(1);
    const controller = new AbortController();
    const commit = vi.fn();
    const reprepare = vi.fn(() => Promise.resolve());
    const provider = vi.fn(() => Promise.resolve(terminal()));
    await expect(
      dispatchRequest({
        identity: { sessionId: 'session', workspaceId: null, query: '', signal: controller.signal },
        hooks: {
          acquireRequest: (signal) => scheduler.request([], signal),
          trackRequest: () => undefined,
        },
        memory: { readSnapshot: () => Promise.resolve(previous), isCurrent: () => false },
        draft: () => draft(previous, commit),
        prepare: reprepare,
        validate: () => Promise.resolve(),
        stream: provider,
        onError: () => undefined,
      })(model, normalizeContext({ messages: [] }), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'MEMORY_CONTEXT_CHANGED' });
    expect(reprepare).toHaveBeenCalledTimes(2);
    expect(commit).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    (await scheduler.request([], controller.signal))();
  });
});
