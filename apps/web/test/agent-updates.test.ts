import { createElement, type EffectCallback, type FC } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentUpdates } from '../src/features/tasks/hooks/use-agent-updates';

interface Gate {
  promise: Promise<void>;
  release: () => void;
}

const owned = vi.hoisted(() => {
  return {
    effects: [] as EffectCallback[],
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
    useQueryClient: () => {
      return { invalidateQueries: owned.invalidate };
    },
  };
});

class SourceFixture extends EventTarget {
  static instances: SourceFixture[] = [];
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    super();
    SourceFixture.instances.push(this);
  }
  close(): void {
    this.closed = true;
  }
  notify(kind: 'ready' | 'changed'): void {
    this.dispatchEvent(new MessageEvent('agents.changed', { data: JSON.stringify({ kind }) }));
  }
}

function gate(): Gate {
  let release = (): void => {
    throw new Error('Uninitialized gate');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function source(index: number): SourceFixture {
  const value = SourceFixture.instances[index];
  if (value === undefined) throw new Error('Missing source fixture');
  return value;
}

/** Replays React's setup/cleanup cycle while retaining the Hook's actual refs and event bridge. */
function renderHook(): () => () => void {
  const Probe: FC = () => {
    useAgentUpdates();
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  const effects = owned.effects.splice(0);
  return (): (() => void) => {
    const cleanups = effects.map((effect) => effect());
    return (): void => {
      for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup();
    };
  };
}

function queries() {
  const gates: Gate[] = [];
  const calls: string[] = [];
  let taskCalls = 0;
  owned.invalidate.mockImplementation(({ queryKey }) => {
    const name = queryKey[0];
    if (typeof name !== 'string') throw new Error('Invalid fixture query key');
    calls.push(name);
    if (name === 'agent-settings') return Promise.resolve();
    const index = Math.floor(taskCalls++ / 3);
    let current = gates[index];
    if (current === undefined) {
      current = gate();
      gates[index] = current;
    }
    return current.promise;
  });
  return {
    gates,
    calls,
    release: (index: number): void => {
      const current = gates[index];
      if (current === undefined) throw new Error('Missing query gate');
      current.release();
    },
    taskCalls: (): number => {
      return calls.filter((name) => name !== 'agent-settings').length;
    },
    settingsCalls: (): number => {
      return calls.filter((name) => name === 'agent-settings').length;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  owned.effects.length = 0;
  owned.invalidate.mockReset();
  SourceFixture.instances = [];
  vi.stubGlobal('EventSource', SourceFixture);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('task SSE invalidation ownership', () => {
  it('refreshes again when a newer change or reconnect arrives while old query responses are held', async () => {
    const reads = queries();
    const mount = renderHook();
    const close = mount();
    try {
      source(0).notify('ready');
      await vi.advanceTimersByTimeAsync(0);
      expect(reads.taskCalls()).toBe(3);
      source(0).notify('changed');
      source(0).notify('ready');
      source(0).notify('changed');
      await vi.advanceTimersByTimeAsync(300);
      expect(reads.taskCalls()).toBe(3);
      reads.release(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(reads.taskCalls()).toBe(6);
      expect(reads.settingsCalls()).toBe(1);
      reads.release(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(reads.settingsCalls()).toBe(2);
      expect(reads.taskCalls()).toBe(6);
    } finally {
      close();
      for (const pending of reads.gates) pending.release();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(source(0).closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let an aborted old setup issue queries or release the new setup's active refresh", async () => {
    const reads = queries();
    const mount = renderHook();
    let close = mount();
    try {
      source(0).notify('ready');
      await vi.advanceTimersByTimeAsync(0);
      source(0).notify('ready');
      close();
      close = mount();
      source(1).notify('ready');
      await vi.advanceTimersByTimeAsync(0);
      expect(reads.taskCalls()).toBe(6);
      reads.release(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(reads.settingsCalls()).toBe(0);
      source(1).notify('changed');
      await vi.advanceTimersByTimeAsync(300);
      expect(reads.taskCalls()).toBe(6);
      reads.release(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(reads.taskCalls()).toBe(9);
      expect(reads.settingsCalls()).toBe(1);
      close();
      source(0).notify('ready');
      source(1).notify('ready');
      reads.release(2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(reads.taskCalls()).toBe(9);
      expect(reads.settingsCalls()).toBe(1);
    } finally {
      close();
      for (const pending of reads.gates) pending.release();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(SourceFixture.instances.every((entry) => entry.closed)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
