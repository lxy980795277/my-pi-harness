import type { SessionSnapshot } from '@my-pi-harness/protocol';
import { createElement, type EffectCallback, type FC } from 'react';
import type * as React from 'react';
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
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('session Work invalidation ownership', () => {
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
