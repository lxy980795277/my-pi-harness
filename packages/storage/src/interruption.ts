import type { SessionSummary, ToolCallRecord, WorkState } from '@my-pi-harness/protocol';
import type { EventInput } from './types.js';

/** Build terminal facts for resources abandoned by the previous daemon; no work is executed. */
export function interruptionEvents(
  session: SessionSummary,
  states: readonly WorkState[],
  tools: readonly ToolCallRecord[],
  at: number,
): EventInput[] {
  const work: EventInput[] = states.map((state) => ({
    type: 'work.updated',
    runId: null,
    at,
    data: {
      state: {
        ...state,
        revision: state.revision + 1,
        plan:
          state.plan?.review === 'pending' ? { ...state.plan, review: 'interrupted' } : state.plan,
        questions: state.questions.map((question) =>
          question.status === 'pending' ? { ...question, status: 'interrupted' } : question,
        ),
      },
    },
  }));
  if (session.activeRunId === null) return work;
  return [
    ...tools.map(
      (tool): EventInput => ({
        type: 'tool.updated',
        runId: session.activeRunId,
        at,
        data: {
          tool: {
            ...tool,
            status: 'interrupted',
            updatedAt: at,
            summary: 'Daemon stopped before the tool completed',
          },
        },
      }),
    ),
    ...work,
    {
      type: 'run.finished',
      runId: session.activeRunId,
      at,
      data: {
        status: 'interrupted',
        finishedAt: at,
        error: 'Daemon stopped before a durable terminal outcome',
      },
    },
  ];
}
