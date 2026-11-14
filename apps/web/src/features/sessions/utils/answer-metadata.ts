import type { MessageView, RunView } from '@my-pi-harness/protocol';
import type { AnswerFooter, AnswerTimestamp } from '@/features/sessions/types/answer-metadata';
import {
  answerTurnFinishedAt,
  collectAnswerTurns,
  lastAnswerTurnsByRun,
} from '@/features/sessions/utils/answer-turns';

const ANSWER_TIME = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const ANSWER_DATE = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** Keys settled input turns by their last assistant so actions follow trailing tool calls. */
export const buildAnswerFooters = (
  messages: readonly MessageView[],
  runs: readonly RunView[],
  activeRunId: string | null,
  branchId: string | undefined,
): ReadonlyMap<string, AnswerFooter> => {
  const turns = collectAnswerTurns(messages);
  const runsById = new Map(
    runs.map((run) => {
      return [run.id, run];
    }),
  );
  const lastTurnByRun = lastAnswerTurnsByRun(turns);
  const footers = new Map<string, AnswerFooter>();
  for (const turn of turns) {
    const tail = turn.assistants.at(-1);
    if (tail === undefined) continue;
    let answer: MessageView | undefined;
    let streaming = false;
    for (const assistant of turn.assistants) {
      if (assistant.status === 'streaming') streaming = true;
      if (assistant.status !== 'streaming' && assistant.text.length > 0) answer = assistant;
    }
    if (answer === undefined || streaming) continue;
    const runId = answer.runId;
    let run: RunView | undefined;
    if (runId !== null) run = runsById.get(runId);
    const lastInRun = runId !== null && lastTurnByRun.get(runId) === turn;
    if (lastInRun && (run?.status === 'running' || runId === activeRunId)) continue;
    const finishedAt = answerTurnFinishedAt(turn, run, lastInRun, branchId);
    let timestamp = answer.createdAt;
    let timeTitle = `开始生成：${ANSWER_DATE.format(timestamp)}`;
    if (finishedAt !== undefined) {
      timestamp = finishedAt;
      timeTitle = ANSWER_DATE.format(timestamp);
    }
    const body = turn.assistants.flatMap((assistant) => {
      if (assistant.text.length === 0) return [];
      return [assistant.text];
    });
    footers.set(tail.id, {
      inputId: turn.user.id,
      copyText: body.join('\n\n'),
      memoryMessage: answer,
      timestamp: {
        timeLabel: ANSWER_TIME.format(timestamp),
        timeTitle,
        dateTime: new Date(timestamp).toISOString(),
      },
    });
  }
  return footers;
};

/** Equivalent recorded timestamps keep answer action rows reusable during later token updates. */
export const equalAnswerTimestamp = (
  previous: AnswerTimestamp | undefined,
  next: AnswerTimestamp | undefined,
): boolean => {
  if (previous === next) return true;
  if (previous === undefined || next === undefined) return false;
  return (
    previous.timeLabel === next.timeLabel &&
    previous.timeTitle === next.timeTitle &&
    previous.dateTime === next.dateTime
  );
};
