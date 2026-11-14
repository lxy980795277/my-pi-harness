import { createElement, type FC } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTaskSummary, SessionSnapshot } from '@my-pi-harness/protocol';
import type * as TraceStore from '../src/features/trace/stores/trace';
import { useTraceDialog } from '../src/features/trace/hooks/use-trace-dialog';
import { useTraceStore } from '../src/features/trace/stores/trace';
import { sessionProjection } from '../../../tests/fixtures/session-projection';

interface ObservedQuery {
  queryKey: readonly unknown[];
  gcTime: number;
  refetchInterval: () => number | false;
}

const owned = vi.hoisted(() => {
  return {
    query: undefined as ObservedQuery | undefined,
    taskStatus: undefined as AgentTaskSummary['status'] | undefined,
  };
});

vi.mock('@tanstack/react-query', () => {
  return {
    useQuery: (query: ObservedQuery) => {
      owned.query = query;
      return {};
    },
    useQueryClient: () => {
      return { invalidateQueries: vi.fn().mockResolvedValue(undefined) };
    },
  };
});
vi.mock('../src/features/tasks/hooks/use-agent-tasks', () => {
  return {
    useAgentTasks: () => {
      const tasks: { status: AgentTaskSummary['status'] }[] = [];
      if (owned.taskStatus !== undefined) tasks.push({ status: owned.taskStatus });
      return { data: { tasks } };
    },
  };
});
vi.mock('../src/features/trace/stores/trace', async (original) => {
  const module = await original<typeof TraceStore>();
  const hook = Object.assign(
    (selector: (state: ReturnType<typeof module.useTraceStore.getState>) => unknown) => {
      return selector(module.useTraceStore.getState());
    },
    module.useTraceStore,
  );
  return { ...module, useTraceStore: hook };
});

function render(snapshot: SessionSnapshot): ObservedQuery {
  const Probe: FC = () => {
    useTraceDialog(snapshot);
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  if (owned.query === undefined) throw new Error('Missing trace query');
  return owned.query;
}

beforeEach(() => {
  owned.query = undefined;
  owned.taskStatus = undefined;
  useTraceStore.getState().reset();
});

describe('trace observation lifetime', () => {
  it('stops static completed-history polling but resumes while the root or a child is active', () => {
    const snapshot = sessionProjection();
    snapshot.session.activeRunId = null;
    expect(render(snapshot).refetchInterval()).toBe(false);
    for (const status of ['queued', 'running', 'waiting'] as const) {
      owned.taskStatus = status;
      expect(render(snapshot).refetchInterval()).toBe(1000);
    }
    owned.taskStatus = 'completed';
    expect(render(snapshot).refetchInterval()).toBe(false);
    snapshot.session.activeRunId = 'root';
    expect(render(snapshot).refetchInterval()).toBe(1000);
  });

  it('keeps a frozen older page static during active execution and disposes page content immediately', () => {
    const snapshot = sessionProjection();
    const store = useTraceStore.getState();
    store.open('session', 'main');
    store.next({ cursor: 120, watermark: 300 });
    const page = render(snapshot);
    expect(page.refetchInterval()).toBe(false);
    expect(page.gcTime).toBe(0);
    expect(page.queryKey).toEqual([
      'trace',
      'session',
      0,
      { branchId: 'main', cursor: 120, watermark: 300, limit: 50 },
    ]);
    store.firstPage();
    expect(render(snapshot).refetchInterval()).toBe(1000);
  });
});
