import { beforeEach, describe, expect, it } from 'vitest';
import { useTraceStore } from '../src/features/trace/stores/trace';
import {
  traceDuration,
  traceStatusLabel,
  updateTraceFilter,
} from '../src/features/trace/utils/trace-view';

beforeEach(() => {
  useTraceStore.getState().reset();
});

describe('trace presentation ownership', () => {
  it('keeps cursor and watermark together, while changing scope clears only presentation selection', () => {
    const actions = useTraceStore.getState();
    actions.open('session', 'branch');
    actions.select('request:one');
    actions.next({ cursor: 120, watermark: 400 });
    expect(useTraceStore.getState()).toMatchObject({
      filters: { branchId: 'branch' },
      entryId: null,
      positions: [{ cursor: 0 }, { cursor: 120, watermark: 400 }],
    });
    actions.previous();
    expect(useTraceStore.getState().positions).toEqual([{ cursor: 0 }]);
    actions.filter({ taskId: 'task', includeDescendants: true });
    expect(useTraceStore.getState()).toMatchObject({
      entryId: null,
      positions: [{ cursor: 0 }],
      filters: { taskId: 'task', includeDescendants: true },
    });
  });

  it('old-target cleanup cannot close a newly selected conversation', () => {
    const actions = useTraceStore.getState();
    actions.open('old', 'old-branch');
    actions.open('new', 'new-branch');
    actions.close('old');
    expect(useTraceStore.getState().sessionId).toBe('new');
    actions.reset();
    expect(useTraceStore.getState()).toMatchObject({
      sessionId: null,
      entryId: null,
      filters: {},
      positions: [{ cursor: 0 }],
    });
  });

  it('selects task/run subtrees without retaining the incompatible scope', () => {
    const task = updateTraceFilter({ branchId: 'branch', runId: 'root' }, 'taskId', 'child');
    expect(task).toEqual({ branchId: 'branch', taskId: 'child', includeDescendants: true });
    expect(updateTraceFilter(task, 'runId', 'other')).toEqual({
      branchId: 'branch',
      runId: 'other',
      includeDescendants: true,
    });
    expect(updateTraceFilter(task, 'taskId', 'all')).toEqual({ branchId: 'branch' });
    expect(updateTraceFilter(task, 'kind', 'arbitrary')).toEqual(task);
  });

  it('retains unknown observations and host outcome names', () => {
    expect(traceDuration(null)).toBe('未记录');
    expect(traceDuration(0)).toBe('0 ms');
    expect(traceDuration(1234)).toBe('1.2 秒');
    expect(traceStatusLabel('future-state')).toBe('future-state');
  });
});
