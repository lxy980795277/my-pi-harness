import {
  defaultAgentSettings,
  initialWorkState,
  type AgentTaskDetail,
  type AgentTaskSummary,
} from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import {
  buildTaskTree,
  retainTaskDetail,
  retainTaskList,
  taskBoardColumns,
  taskNeedsAttention,
  taskStatusLabel,
  taskCanStop,
  taskTranscriptView,
} from '../src/features/tasks/utils/task-view';

function task(id: string, changes: Partial<AgentTaskSummary> = {}): AgentTaskSummary {
  const settings = defaultAgentSettings();
  const role = settings.roles[0];
  if (role === undefined) throw new Error('Missing test role');
  return {
    id,
    sourceToolCallId: `source-${id}`,
    title: id,
    role,
    limits: settings.limits,
    createdAt: 10,
    sessionId: 'session',
    branchId: 'main',
    parentRunId: 'root',
    parentTaskId: null,
    rootRunId: 'root',
    latestRunId: `run-${id}`,
    status: 'running',
    waiting: null,
    updatedAt: 20,
    finishedAt: null,
    closedAt: null,
    closeReason: null,
    error: null,
    usage: null,
    ...changes,
  };
}
function detail(): AgentTaskDetail {
  return {
    task: task('first'),
    messages: [],
    runs: [],
    tools: [],
    work: initialWorkState('main'),
    snapshotSeq: 5,
    liveRevision: 0,
    nextCursor: null,
  };
}

describe('task views use committed facts', () => {
  it('keeps task failure diagnostics on their message page and falls back only at the transcript end', () => {
    const source = detail();
    source.task = { ...source.task, status: 'failed', error: '模型请求超时，请稍后重试。' };
    source.runs = [
      {
        id: 'run-first',
        sessionId: 'session',
        branchId: 'main',
        providerId: 'provider',
        modelId: 'model',
        status: 'failed',
        createdAt: 10,
        finishedAt: 20,
        error: source.task.error,
      },
    ];
    source.nextCursor = 100;
    const firstPage = taskTranscriptView(source);
    expect(firstPage.fallbacks).toEqual([]);
    expect(firstPage.diagnostic).toBe(source.task.error);
    source.nextCursor = null;
    expect(taskTranscriptView(source)).toMatchObject({
      diagnostic: null,
      fallbacks: [{ runId: 'run-first', text: source.task.error }],
    });
    source.messages = [
      {
        id: 'partial',
        sessionId: 'session',
        branchId: 'main',
        runId: 'run-first',
        role: 'assistant',
        text: '部分结果',
        thinking: '',
        createdAt: 11,
        status: 'failed',
        stopReason: 'error',
      },
    ];
    const lastPage = taskTranscriptView(source);
    expect(lastPage.fallbacks).toEqual([]);
    expect(lastPage.diagnostic).toBeNull();
    expect(lastPage.rows[0]).toMatchObject({
      message: { text: '部分结果' },
      failure: source.task.error,
    });
    source.task.error = '子任务未能完成，请查看执行详情。';
    expect(taskTranscriptView(source).diagnostic).toBeNull();
    expect(taskTranscriptView(source).rows[0]?.failure).toBe('模型请求超时，请稍后重试。');
    source.runs = [];
    source.messages = [];
    source.task.latestRunId = null;
    expect(taskTranscriptView(source)).toMatchObject({
      diagnostic: null,
      fallbacks: [{ id: 'task-error:first', runId: null, text: source.task.error }],
    });
  });

  it('keeps nested task ancestry while rooting a filtered branch subset', () => {
    const tree = buildTaskTree([
      task('parent'),
      task('child', { parentTaskId: 'parent' }),
      task('visible', { parentTaskId: 'outside-branch' }),
    ]);
    expect(tree.map((entry) => entry.task.id)).toEqual(['parent', 'visible']);
    expect(tree[0]?.children.map((entry) => entry.task.id)).toEqual(['child']);
  });

  it('distinguishes execution waits from human requests and preserves each terminal outcome', () => {
    expect(taskCanStop(task('preparing-continuation', { status: 'completed' }))).toBe(true);
    expect(taskCanStop(task('closed', { status: 'completed', closedAt: 30 }))).toBe(false);
    expect(taskStatusLabel(task('model', { status: 'waiting', waiting: 'model' }))).toBe(
      '等待模型名额',
    );
    expect(taskNeedsAttention(task('child', { status: 'waiting', waiting: 'children' }))).toBe(
      false,
    );
    expect(taskNeedsAttention(task('answer', { status: 'waiting', waiting: 'user' }))).toBe(true);
    const columns = taskBoardColumns([
      task('new', { status: 'queued' }),
      task('active'),
      task('answer', { status: 'waiting', waiting: 'approval' }),
      task('failed', { status: 'failed', error: 'Known failure' }),
      task('interrupted', { status: 'interrupted' }),
    ]);
    expect(columns.map((column) => column.tasks.map((entry) => entry.id))).toEqual([
      ['new'],
      ['active'],
      ['answer'],
      ['failed', 'interrupted'],
    ]);
    expect(columns[3]?.tasks[0]?.error).toBe('Known failure');
  });

  it('retains newer snapshots and stable untouched rows instead of replacing every task on a delta', () => {
    const first = task('first');
    const second = task('second');
    const initial = { tasks: [first, second], snapshotSeq: 10 };
    expect(retainTaskList(initial, { tasks: [], snapshotSeq: 9 })).toBe(initial);
    const next = retainTaskList(initial, {
      tasks: [{ ...first }, { ...second, status: 'completed', finishedAt: 30 }],
      snapshotSeq: 11,
    });
    expect(next.tasks[0]).toBe(first);
    expect(next.tasks[1]).not.toBe(second);
    const original = detail();
    expect(retainTaskDetail(original, { ...original, snapshotSeq: 4 })).toBe(original);
    expect(retainTaskDetail(original, { ...original, snapshotSeq: 6 }).work).toBe(original.work);
    const live = retainTaskDetail(original, { ...original, liveRevision: 5 });
    expect(live.liveRevision).toBe(5);
    expect(retainTaskDetail(live, { ...original, liveRevision: 2 })).toBe(live);
    expect(retainTaskDetail(live, { ...original, snapshotSeq: 6 }).liveRevision).toBe(0);
  });

  it('does not duplicate pending tool approvals inside folded transcript content', () => {
    const source = detail();
    source.messages = [
      {
        id: 'assistant',
        sessionId: 'session',
        branchId: 'main',
        runId: 'run-first',
        role: 'assistant',
        text: 'Inspecting',
        thinking: '',
        createdAt: 10,
        status: 'streaming',
        stopReason: null,
      },
    ];
    const base = {
      id: 'read',
      sessionId: 'session',
      runId: 'run-first',
      branchId: 'main',
      name: 'read_file',
      arguments: {},
      binding: { kind: 'rejected' as const, reason: 'Fixture' },
      dispatch: { state: 'not_applicable' as const },
      summary: '',
      result: null,
      diff: null,
      createdAt: 10,
      updatedAt: 20,
      afterMessageId: 'assistant',
    };
    source.tools = [
      { ...base, status: 'completed' },
      { ...base, id: 'approve', status: 'awaiting_approval' },
    ];
    expect(taskTranscriptView(source).rows[0]?.tools.map((entry) => entry.id)).toEqual(['read']);
    expect(source.tools).toHaveLength(2);
  });
});
