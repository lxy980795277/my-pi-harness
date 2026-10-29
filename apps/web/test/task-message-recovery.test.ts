import type { AgentMessageInput, AgentTaskSummary } from '@my-pi-harness/protocol';
import { defaultAgentSettings } from '@my-pi-harness/protocol';
import { createElement, type EffectCallback, type FC } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskDetail } from '../src/features/tasks/hooks/use-task-detail';
import { taskMessageKey, useTaskMessageStore } from '../src/features/tasks/stores/messages';
import type { TaskDetailState } from '../src/features/tasks/types/tasks';
import type * as TaskMessages from '../src/features/tasks/stores/messages';
import { RequestError } from '../src/services/base-request';

const owned = vi.hoisted(() => {
  return {
    effects: [] as EffectCallback[],
    send: vi.fn<
      (
        session: string,
        task: string,
        input: AgentMessageInput,
        signal: AbortSignal,
      ) => Promise<void>
    >(),
    invalidate: vi.fn<() => Promise<void>>(),
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
// Server rendering otherwise selects Zustand's initial snapshot instead of current client drafts.
vi.mock('../src/features/tasks/stores/messages', async (original) => {
  const actual = await original<typeof TaskMessages>();
  const store = actual.useTaskMessageStore;
  const read = <Result>(selector: (state: ReturnType<typeof store.getState>) => Result): Result => {
    return selector(store.getState());
  };
  return { ...actual, useTaskMessageStore: Object.assign(read, store) };
});
vi.mock('@tanstack/react-query', () => {
  return {
    useQuery: () => {
      return { data: undefined };
    },
    useQueryClient: () => {
      return { invalidateQueries: owned.invalidate };
    },
  };
});
vi.mock('../src/features/tasks/services/agents', () => {
  return { sendAgentMessage: owned.send };
});

function task(changes: Partial<AgentTaskSummary> = {}): AgentTaskSummary {
  const settings = defaultAgentSettings();
  const role = settings.roles[0];
  if (role === undefined) throw new Error('Missing fixture role');
  return {
    id: 'task',
    sessionId: 'session',
    branchId: 'main',
    parentRunId: 'parent',
    parentTaskId: null,
    rootRunId: 'parent',
    sourceToolCallId: 'spawn',
    title: 'Task',
    role,
    limits: settings.limits,
    createdAt: 1,
    updatedAt: 2,
    latestRunId: 'old-run',
    status: 'completed',
    waiting: null,
    finishedAt: 2,
    closedAt: null,
    closeReason: null,
    error: null,
    usage: null,
    ...changes,
  };
}

function mount(taskValue: AgentTaskSummary): { state: TaskDetailState; close: () => void } {
  let state: TaskDetailState | undefined;
  const Probe: FC = () => {
    state = useTaskDetail(taskValue);
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  const cleanups = owned.effects.splice(0).map((effect) => {
    return effect();
  });
  if (state === undefined) throw new Error('Missing task hook');
  return {
    state,
    close: (): void => {
      for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup();
    },
  };
}

beforeEach(() => {
  owned.effects.length = 0;
  owned.send.mockReset();
  owned.invalidate.mockReset().mockResolvedValue();
  useTaskMessageStore.getState().reset();
  useTaskMessageStore
    .getState()
    .setDraft(taskMessageKey('session', 'task'), 'original instruction');
});
afterEach(() => {
  useTaskMessageStore.getState().reset();
});

describe('task input outcome ownership', () => {
  it('manually retries the same complete request after a lost response, SSE changes and closing the detail', async () => {
    owned.send.mockRejectedValueOnce(new TypeError('Response lost')).mockResolvedValue();
    const first = mount(task());
    first.state.sending.run();
    await vi.waitFor(() => {
      expect(owned.send).toHaveBeenCalledTimes(1);
    });
    const original = owned.send.mock.calls[0]?.[2];
    expect(original).toMatchObject({
      text: 'original instruction',
      continue: true,
      expectedRunId: 'old-run',
    });
    first.close();
    const reopened = mount(
      task({ latestRunId: 'new-run', status: 'failed', closedAt: 4, closeReason: 'failed' }),
    );
    try {
      expect(reopened.state).toMatchObject({
        canMessage: true,
        uncertain: true,
        draftLocked: true,
        continuing: true,
        text: 'original instruction',
      });
      useTaskMessageStore
        .getState()
        .setDraft(taskMessageKey('session', 'task'), 'another instruction');
      expect(useTaskMessageStore.getState().drafts[taskMessageKey('session', 'task')]).toBe(
        'original instruction',
      );
      expect(owned.send).toHaveBeenCalledTimes(1);
      reopened.state.sending.run();
      await vi.waitFor(() => {
        expect(owned.send).toHaveBeenCalledTimes(2);
        expect(useTaskMessageStore.getState().attempts).toEqual({});
      });
      expect(owned.send.mock.calls[1]?.[2]).toBe(original);
      expect(useTaskMessageStore.getState().drafts).toEqual({});
    } finally {
      reopened.close();
    }
  });

  it('unlocks the draft after an explicit rejection while transport/server errors retain the attempt', async () => {
    owned.send.mockRejectedValueOnce(new RequestError('Input rejected', 409));
    const first = mount(task());
    first.state.sending.run();
    await vi.waitFor(() => {
      expect(owned.send).toHaveBeenCalledTimes(1);
    });
    const original = owned.send.mock.calls[0]?.[2];
    expect(useTaskMessageStore.getState().attempts).toEqual({});
    first.close();
    const key = taskMessageKey('session', 'task');
    useTaskMessageStore.getState().setDraft(key, 'corrected instruction');
    owned.send.mockRejectedValueOnce(new RequestError('Server error', 500));
    const second = mount(task({ latestRunId: 'new-run', status: 'running' }));
    second.state.sending.run();
    await vi.waitFor(() => {
      expect(owned.send).toHaveBeenCalledTimes(2);
    });
    second.close();
    const retry = useTaskMessageStore.getState().attempts[key];
    expect(retry).toMatchObject({
      text: 'corrected instruction',
      continue: false,
      expectedRunId: 'new-run',
    });
    expect(retry?.requestId).not.toBe(original?.requestId);
    expect(useTaskMessageStore.getState().drafts[key]).toBe('corrected instruction');
  });

  it('keeps an aborted submission for confirmation and ignores its late response after a remount', async () => {
    let release = (): void => {
      throw new Error('Missing response gate');
    };
    const response = new Promise<void>((resolve) => {
      release = resolve;
    });
    owned.send.mockReturnValueOnce(response).mockResolvedValue();
    const first = mount(task());
    first.state.sending.run();
    first.close();
    expect(owned.send.mock.calls[0]?.[3].aborted).toBe(true);
    const reopened = mount(task({ latestRunId: 'new-run', status: 'running' }));
    try {
      expect(reopened.state.uncertain).toBe(true);
      reopened.state.sending.run();
      await vi.waitFor(() => {
        expect(useTaskMessageStore.getState().attempts).toEqual({});
      });
      const key = taskMessageKey('session', 'task');
      useTaskMessageStore.getState().setDraft(key, 'next instruction');
      const next = useTaskMessageStore.getState().prepare(key, {
        requestId: 'next',
        text: 'next instruction',
        continue: false,
        expectedRunId: 'new-run',
      });
      release();
      await vi.waitFor(() => {
        expect(owned.invalidate).toHaveBeenCalledTimes(3);
      });
      expect(useTaskMessageStore.getState().attempts[key]).toBe(next);
      expect(useTaskMessageStore.getState().drafts[key]).toBe('next instruction');
    } finally {
      release();
      reopened.close();
    }
  });

  it('does not let an aborted old rejection clear the same request being confirmed by a new detail', async () => {
    let rejectFirst = (_reason: Error): void => {
      throw new Error('Missing rejection gate');
    };
    let confirmRetry = (): void => {
      throw new Error('Missing confirmation gate');
    };
    const firstResponse = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const retryResponse = new Promise<void>((resolve) => {
      confirmRetry = resolve;
    });
    owned.send.mockReturnValueOnce(firstResponse).mockReturnValueOnce(retryResponse);
    const first = mount(task());
    first.state.sending.run();
    first.close();
    const key = taskMessageKey('session', 'task');
    const original = useTaskMessageStore.getState().attempts[key];
    const reopened = mount(task({ latestRunId: 'new-run', status: 'running' }));
    try {
      reopened.state.sending.run();
      expect(owned.send.mock.calls[1]?.[2]).toBe(original);
      rejectFirst(new RequestError('Old rejected response', 422));
      await expect(firstResponse).rejects.toThrow('Old rejected response');
      expect(owned.send).toHaveBeenCalledTimes(2);
      expect(useTaskMessageStore.getState().attempts[key]).toBe(original);
      confirmRetry();
      await vi.waitFor(() => {
        expect(useTaskMessageStore.getState().attempts).toEqual({});
      });
    } finally {
      confirmRetry();
      reopened.close();
    }
  });
});
