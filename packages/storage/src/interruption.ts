import { ToolCallRecordSchema, type SessionSummary, type WorkState } from '@my-pi-harness/protocol';
import type { EventInput } from './types.js';
import { checked } from './validation.js';

/** Build terminal facts for resources abandoned by the previous daemon; no work is executed. */
export function interruptionEvents(
  session: SessionSummary,
  states: readonly WorkState[],
  toolEvents: readonly EventInput[],
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
  if (session.activeRunId === null) return [...toolEvents, ...work];
  return [
    ...toolEvents,
    ...work,
    {
      type: 'run.finished',
      runId: session.activeRunId,
      at,
      data: {
        status: toolEvents.some(
          (event) =>
            event.type === 'tool.updated' &&
            checked(ToolCallRecordSchema, event.data['tool']).status === 'unknown',
        )
          ? 'failed'
          : 'interrupted',
        finishedAt: at,
        error: 'Daemon stopped before a durable terminal outcome',
      },
    },
  ];
}
