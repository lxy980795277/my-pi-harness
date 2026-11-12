import type { SessionSnapshot, ToolCallView } from '@my-pi-harness/protocol';
import { createElement, type EffectCallback, type FC } from 'react';
import type * as React from 'react';
import type * as MemoryCache from '../src/features/memory/queries/cache';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionProjection } from '../../../tests/fixtures/session-projection';
import { useSession } from '../src/features/sessions/hooks/use-session';
import type { SessionConnectionStatus } from '../src/features/sessions/types/session';

interface Observer {
  snapshot: (snapshot: SessionSnapshot) => void;
  connection: (status: SessionConnectionStatus, error: string | null) => void;
}
interface Subscription {
  id: string;
  observer: Observer;
  closed: boolean;
}
interface Gate {
  promise: Promise<void>;
  release: () => void;
}

const owned = vi.hoisted(() => {
  return {
    effects: [] as EffectCallback[],
    subscriptions: [] as Subscription[],
    invalidate: vi.fn<(filter: { queryKey: readonly unknown[] }) => Promise<void>>(),
    refreshMemory: vi.fn<() => Promise<void>>(),
  };
});
vi.mock('react', async (original) => {
  const react = await original<typeof React>();
  return {
    ...react,
    useEffect: (effect: EffectCallback): void => {
      owned.effects.push(effect);
    },
  };
});
vi.mock('@tanstack/react-query', () => {
  return {
    useQuery: () => {
      return {};
    },
    useQueryClient: () => {
      return { invalidateQueries: owned.invalidate };
    },
  };
});
vi.mock('../src/features/sessions/queries/projection', () => {
  return { mergeSessionSnapshot: vi.fn(), retainNewestSnapshot: vi.fn() };
});
vi.mock('../src/features/memory/queries/cache', async (original) => {
  const cache = await original<typeof MemoryCache>();
  return { ...cache, refreshMemoryFacts: owned.refreshMemory };
});
vi.mock('../src/features/sessions/queries/live-session', () => {
  return {
    subscribeLiveSession: (id: string, observer: Observer): (() => void) => {
      const entry = { id, observer, closed: false };
      owned.subscriptions.push(entry);
      return (): void => {
        entry.closed = true;
      };
    },
  };
});

function gate(): Gate {
  let release = (): void => {
    throw new Error('Missing query gate');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function subscription(index = 0): Subscription {
  const entry = owned.subscriptions[index];
  if (entry === undefined) throw new Error('Missing subscription');
  return entry;
}
function memoryWrite(id: string, status: ToolCallView['status'] = 'completed'): ToolCallView {
  return {
    id,
    sessionId: 'session',
    runId: 'run',
    branchId: 'main',
    afterMessageId: 'assistant',
    name: 'save_memory',
    arguments: { body: '实际保存的偏好' },
    binding: { kind: 'accepted', source: { kind: 'session' }, fingerprint: 'a'.repeat(64) },
    dispatch: { state: 'not_applicable' },
    status,
    summary: '保存记忆',
    result: null,
    diff: null,
    createdAt: 1,
    updatedAt: 2,
  };
}
function renderHook(id = 'session'): () => () => void {
  const Probe: FC = () => {
    useSession(id);
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  const effects = owned.effects.splice(0);
  return (): (() => void) => {
    const cleanups = effects.map((effect) => {
      return effect();
    });
    return (): void => {
      for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup();
    };
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  owned.effects.length = 0;
  owned.subscriptions.length = 0;
  owned.invalidate.mockReset();
  owned.refreshMemory.mockReset().mockResolvedValue();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('session Work invalidation ownership', () => {
  it('refreshes current memory facts on completed native writes, not running, failed or repeated tool snapshots', async () => {
    owned.invalidate.mockResolvedValue();
    const close = renderHook()();
    try {
      subscription().observer.snapshot({
        ...sessionProjection(1),
        tools: [memoryWrite('write', 'running')],
      });
      await vi.advanceTimersByTimeAsync(300);
      expect(owned.refreshMemory).not.toHaveBeenCalled();
      subscription().observer.snapshot({ ...sessionProjection(2), tools: [memoryWrite('write')] });
      await vi.advanceTimersByTimeAsync(300);
      expect(owned.refreshMemory).toHaveBeenCalledOnce();
      subscription().observer.snapshot({
        ...sessionProjection(3),
        tools: [memoryWrite('write'), memoryWrite('failed', 'failed')],
      });
      await vi.advanceTimersByTimeAsync(300);
      expect(owned.refreshMemory).toHaveBeenCalledOnce();
      subscription().observer.snapshot({
        ...sessionProjection(4),
        tools: [
          memoryWrite('write'),
          {
            ...memoryWrite('lookalike'),
            binding: {
              kind: 'accepted',
              fingerprint: 'b'.repeat(64),
              source: {
                kind: 'mcp',
                serverId: 'remote',
                serverRevision: 1,
                remoteToolName: 'save_memory',
              },
            },
          },
        ],
      });
      await vi.advanceTimersByTimeAsync(300);
      expect(owned.refreshMemory).toHaveBeenCalledOnce();
      close();
      subscription().observer.snapshot({ ...sessionProjection(5), tools: [memoryWrite('late')] });
      await vi.advanceTimersByTimeAsync(300);
      expect(owned.refreshMemory).toHaveBeenCalledOnce();
    } finally {
      close();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not lose a second memory completion while a prior refresh is still held', async () => {
    const first = gate();
    owned.invalidate.mockReturnValueOnce(first.promise).mockResolvedValue();
    const close = renderHook()();
    try {
      subscription().observer.snapshot({ ...sessionProjection(1), tools: [memoryWrite('first')] });
      await vi.advanceTimersByTimeAsync(300);
      expect(owned.refreshMemory).toHaveBeenCalledOnce();
      subscription().observer.snapshot({
        ...sessionProjection(2),
        tools: [memoryWrite('first'), memoryWrite('second')],
      });
      await vi.advanceTimersByTimeAsync(300);
      expect(owned.refreshMemory).toHaveBeenCalledOnce();
      first.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(owned.refreshMemory).toHaveBeenCalledTimes(2);
    } finally {
      close();
      first.release();
    }
  });
  it('reads the last durable Work update after an older read completes without waiting for another event', async () => {
    const first = gate();
    owned.invalidate.mockReturnValueOnce(first.promise).mockResolvedValue();
    const close = renderHook()();
    try {
      subscription().observer.snapshot(sessionProjection(3));
      await vi.advanceTimersByTimeAsync(300);
      expect(owned.invalidate).toHaveBeenCalledTimes(1);
      subscription().observer.snapshot(sessionProjection(4));
      await vi.advanceTimersByTimeAsync(300);
      expect(owned.invalidate).toHaveBeenCalledTimes(1);
      first.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(owned.invalidate).toHaveBeenCalledTimes(2);
      subscription().observer.snapshot(sessionProjection(4, 'live only', 8));
      await vi.advanceTimersByTimeAsync(300);
      expect(owned.invalidate).toHaveBeenCalledTimes(2);
      subscription().observer.connection('connecting', null);
      subscription().observer.snapshot(sessionProjection(4, 'reconnected', 9));
      await vi.advanceTimersByTimeAsync(300);
      expect(owned.invalidate).toHaveBeenCalledTimes(3);
    } finally {
      close();
      first.release();
    }
    expect(subscription().closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps cleanup and replay owners independent when an older read is still held', async () => {
    const first = gate();
    const second = gate();
    owned.invalidate
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue();
    const mount = renderHook();
    let close = mount();
    try {
      subscription().observer.snapshot(sessionProjection(3));
      await vi.advanceTimersByTimeAsync(300);
      subscription().observer.snapshot(sessionProjection(4));
      close();
      close = mount();
      subscription(1).observer.snapshot(sessionProjection(5));
      await vi.advanceTimersByTimeAsync(300);
      expect(owned.invalidate).toHaveBeenCalledTimes(2);
      first.release();
      await vi.advanceTimersByTimeAsync(0);
      subscription(1).observer.snapshot(sessionProjection(6));
      await vi.advanceTimersByTimeAsync(300);
      expect(owned.invalidate).toHaveBeenCalledTimes(2);
      second.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(owned.invalidate).toHaveBeenCalledTimes(3);
      close();
      subscription().observer.snapshot(sessionProjection(7));
      subscription(1).observer.snapshot(sessionProjection(8));
      await vi.advanceTimersByTimeAsync(1000);
      expect(owned.invalidate).toHaveBeenCalledTimes(3);
    } finally {
      close();
      first.release();
      second.release();
    }
    expect(
      owned.subscriptions.every((entry) => {
        return entry.closed;
      }),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never refreshes an old target after switching to another session', async () => {
    const oldRead = gate();
    owned.invalidate.mockReturnValueOnce(oldRead.promise).mockResolvedValue();
    const closeOld = renderHook('old-session')();
    subscription().observer.snapshot(sessionProjection(1));
    await vi.advanceTimersByTimeAsync(300);
    subscription().observer.snapshot(sessionProjection(2));
    closeOld();
    const closeNew = renderHook('new-session')();
    try {
      subscription(1).observer.snapshot(sessionProjection(1));
      await vi.advanceTimersByTimeAsync(300);
      oldRead.release();
      await vi.advanceTimersByTimeAsync(300);
      expect(owned.invalidate.mock.calls).toEqual([
        [{ queryKey: ['work', 'old-session'] }],
        [{ queryKey: ['work', 'new-session'] }],
      ]);
    } finally {
      closeNew();
      oldRead.release();
    }
  });
});
