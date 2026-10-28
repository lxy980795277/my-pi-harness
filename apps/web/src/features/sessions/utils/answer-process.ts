import type { MessageView, RunView } from '@my-pi-harness/protocol';
import type {
  AnswerTurn,
  TimelineContentEntry,
  TimelineEntry,
} from '@/features/sessions/types/session';
import {
  answerTurnFinishedAt,
  collectAnswerTurns,
  lastAnswerTurnsByRun,
} from '@/features/sessions/utils/answer-turns';

const hasUnsettledContent = (entries: readonly TimelineContentEntry[]): boolean => {
  return entries.some((entry) => {
    if (entry.type === 'message') return entry.message.status !== 'complete';
    return (
      entry.tool.status === 'running' ||
      entry.tool.status === 'reviewing' ||
      entry.tool.status === 'awaiting_approval' ||
      entry.tool.status === 'unknown'
    );
  });
};

const durationLabel = (start: number, end: number | undefined): string => {
  if (end === undefined) return '';
  const seconds = Math.floor(Math.max(0, end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const collapseTurn = (
  entries: readonly TimelineEntry[],
  turn: AnswerTurn,
  run: RunView | undefined,
  lastInRun: boolean,
  activeRunId: string | null,
  branchId: string | undefined,
): readonly TimelineEntry[] => {
  const content = entries.filter((entry): entry is TimelineContentEntry => {
    return entry.type === 'message' || entry.type === 'tool';
  });
  const final = content.at(-1);
  if (
    final?.type !== 'message' ||
    final.part === 'thinking' ||
    final.message.role !== 'assistant' ||
    final.message.text.trim().length === 0 ||
    final.message.status !== 'complete' ||
    (final.message.stopReason !== 'stop' && final.message.stopReason !== 'length') ||
    final.message.runId === null ||
    final.message.runId !== turn.user.runId ||
    hasUnsettledContent(content) ||
    !entries.some((entry) => {
      return entry.type === 'answer-footer';
    })
  )
    return entries;
  if (lastInRun) {
    if (final.message.runId === activeRunId) return entries;
    if (run === undefined || branchId === undefined) return entries;
    if (run.branchId === branchId) {
      if (run.status !== 'completed') return entries;
    } else if (final.message.branchId === branchId || final.message.finishedAt === undefined)
      return entries;
  }
  const process = content.slice(0, -1);
  if (process.length === 0) return entries;
  const finishedAt = answerTurnFinishedAt(turn, run, lastInRun, branchId);
  return [
    {
      type: 'process',
      id: `process:${turn.user.id}`,
      sessionId: turn.user.sessionId,
      inputId: turn.user.id,
      durationLabel: durationLabel(turn.user.createdAt, finishedAt),
      entries: process,
    },
    final,
    ...entries.filter((entry) => {
      return entry.type !== 'message' && entry.type !== 'tool';
    }),
  ];
};

/** Settled successful input turns replace process rows with one measured disclosure entry. */
export const collapseAnswerProcesses = (
  entries: readonly TimelineEntry[],
  messages: readonly MessageView[],
  runs: readonly RunView[],
  activeRunId: string | null,
  branchId: string | undefined,
): TimelineEntry[] => {
  const turns = collectAnswerTurns(messages);
  const lastByRun = lastAnswerTurnsByRun(turns);
  const turnsByInput = new Map(
    turns.map((turn) => {
      return [turn.user.id, turn];
    }),
  );
  const runsById = new Map(
    runs.map((run) => {
      return [run.id, run];
    }),
  );
  const output: TimelineEntry[] = [];
  let turn: AnswerTurn | undefined;
  let pending: TimelineEntry[] = [];
  const flush = (): void => {
    if (turn === undefined) {
      output.push(...pending);
    } else {
      const runId = turn.assistants.at(-1)?.runId;
      let run: RunView | undefined;
      let lastInRun = true;
      if (runId !== undefined && runId !== null) {
        run = runsById.get(runId);
        lastInRun = lastByRun.get(runId) === turn;
      }
      output.push(...collapseTurn(pending, turn, run, lastInRun, activeRunId, branchId));
    }
    pending = [];
  };
  for (const entry of entries) {
    if (entry.type === 'message' && entry.message.role === 'user') {
      flush();
      output.push(entry);
      turn = turnsByInput.get(entry.message.id);
    } else {
      pending.push(entry);
    }
  }
  flush();
  return output;
};
