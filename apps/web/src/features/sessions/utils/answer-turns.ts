import type { MessageView, RunView } from '@my-pi-harness/protocol';
import type { AnswerTurn } from '@/features/sessions/types/session';

/** Each accepted user input starts its own answer, including follow-ups consumed within one Run. */
export const collectAnswerTurns = (messages: readonly MessageView[]): AnswerTurn[] => {
  const turns: AnswerTurn[] = [];
  let turn: AnswerTurn | undefined;
  for (const message of messages) {
    if (message.role === 'user') {
      turn = { user: message, assistants: [] };
      turns.push(turn);
    } else if (turn !== undefined) {
      turn.assistants.push(message);
    }
  }
  return turns;
};

/** A Run may finish several input turns before its own terminal event. */
export const lastAnswerTurnsByRun = (
  turns: readonly AnswerTurn[],
): ReadonlyMap<string, AnswerTurn> => {
  const last = new Map<string, AnswerTurn>();
  for (const turn of turns) {
    for (const message of [turn.user, ...turn.assistants]) {
      if (message.runId !== null) last.set(message.runId, turn);
    }
  }
  return last;
};

/** Inherited branch prefixes retain recorded message timing instead of a discarded Run tail. */
export const answerTurnFinishedAt = (
  turn: AnswerTurn,
  run: RunView | undefined,
  lastInRun: boolean,
  branchId: string | undefined,
): number | undefined => {
  let finishedAt: number | undefined;
  for (const assistant of turn.assistants) {
    if (assistant.finishedAt !== undefined) finishedAt = assistant.finishedAt;
  }
  if (
    lastInRun &&
    run !== undefined &&
    run.status !== 'running' &&
    run.branchId === branchId &&
    run.finishedAt !== null
  ) {
    return run.finishedAt;
  }
  return finishedAt;
};
