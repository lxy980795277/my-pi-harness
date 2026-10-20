import {
  initialWorkState,
  type Compaction,
  type ContextUsage,
  type MessageView,
  type WorkSnapshot,
} from '@my-pi-harness/protocol';
import { describe, expect, it } from 'vitest';
import {
  compareSummaries,
  resolveCompaction,
  usageCategories,
} from '../src/features/work/utils/context-view';
import { countConversationTurns, usageLabel } from '../src/features/work/utils/work-view';
const first: Compaction = {
  id: 'one',
  parentId: null,
  throughMessageId: 'message',
  summary: 'project facts',
  structured: {
    objective: 'Implement project',
    constraints: ['No compatibility'],
    decisions: [],
    completed: [],
    pending: ['Validate'],
    blockers: [],
    nextAction: 'Run tests',
  },
  strategy: 'model',
  beforeTokens: 9000,
  afterTokens: 1200,
  sourceMessages: 10,
  runId: 'run',
  createdAt: 1,
  reason: 'automatic',
};
describe('context versions and measurements', () => {
  it('prefers the selected summary, then active summary, then newest saved version', () => {
    const newest = { ...first, id: 'newest', parentId: first.id };
    const work: WorkSnapshot = {
      state: { ...initialWorkState('branch'), compaction: first },
      checkpoints: [],
      compactions: [first, newest],
    };
    expect(resolveCompaction(work, newest.id)).toBe(newest);
    expect(resolveCompaction(work, 'missing')).toBe(first);
    work.state.compaction = null;
    expect(resolveCompaction(work, '')).toBe(newest);
    work.compactions = [];
    expect(resolveCompaction(work, 'missing')).toBeNull();
    work.state.compaction = first;
    expect(resolveCompaction(work, '')).toBe(first);
  });
  it('compares semantic fields and keeps an empty section explicit', () => {
    const rows = compareSummaries(first, {
      ...first,
      id: 'two',
      parentId: first.id,
      structured: {
        ...first.structured,
        completed: ['Validate'],
        pending: [],
        nextAction: 'Deliver',
      },
    });
    expect(
      rows.find((row) => {
        return row.label === '目标';
      })?.changed,
    ).toBe(false);
    expect(
      rows.find((row) => {
        return row.label === '待完成';
      }),
    ).toMatchObject({ changed: true, left: 'Validate', right: '—' });
    expect(
      rows.find((row) => {
        return row.label === '下一步';
      })?.right,
    ).toBe('Deliver');
  });
  it('shows category estimates and distinguishes unknown context from measured zero', () => {
    const usage: ContextUsage = {
      estimatedTokens: 500,
      windowTokens: 10000,
      inputBudget: 9000,
      reservedOutput: 1000,
      trimmedMessages: 2,
      prunedMessages: 3,
      source: 'provider',
      providerInputTokens: 480,
      categories: {
        system: 10,
        rules: 20,
        tools: 30,
        messages: 300,
        attachments: 40,
        summary: 50,
        workingState: 50,
      },
    };
    expect(
      usageCategories(usage).find((row) => {
        return row.label === '对话与工具结果';
      }),
    ).toEqual({ label: '对话与工具结果', tokens: '300' });
    expect(usageLabel(null)).toBe('上下文 —');
    expect(usageLabel(usage)).toBe('上下文 5%');
    expect(usageLabel({ ...usage, estimatedTokens: 0 })).toBe('上下文 0%');
  });
  it('counts accepted user messages including inherited history while excluding assistant tool steps', () => {
    const inherited: MessageView = {
      id: 'inherited-question',
      sessionId: 'session',
      branchId: 'parent',
      runId: 'previous-run',
      role: 'user',
      text: 'Inherited question',
      thinking: '',
      createdAt: 1,
      status: 'complete',
      stopReason: null,
    };
    expect(countConversationTurns([])).toBe(0);
    expect(
      countConversationTurns([
        inherited,
        { ...inherited, id: 'tool-step', role: 'assistant', text: '', stopReason: 'toolUse' },
        { ...inherited, id: 'answer', role: 'assistant', text: 'Answer', stopReason: 'stop' },
        { ...inherited, id: 'new-question', branchId: 'selected', runId: 'current-run' },
      ]),
    ).toBe(2);
  });
});
