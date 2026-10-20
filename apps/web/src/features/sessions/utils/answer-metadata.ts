import type { MessageView, RunView } from '@my-pi-harness/protocol';
import type { AnswerFooter, AnswerMetadata } from '@/features/sessions/types/answer-metadata';

interface AnswerTurn {
  user: MessageView;
  assistants: MessageView[];
}

const COMPACT_TOKENS = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const EXACT_TOKENS = new Intl.NumberFormat('zh-CN');
const SECONDS = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
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

const collectTurns = (messages: readonly MessageView[]): AnswerTurn[] => {
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

const describeUsage = (
  assistants: readonly MessageView[],
): Pick<AnswerMetadata, 'tokensLabel' | 'tokensTitle'> => {
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let recorded = 0;
  for (const assistant of assistants) {
    const usage = assistant.usage;
    if (usage === undefined) continue;
    totalTokens += usage.totalTokens;
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    cacheReadTokens += usage.cacheReadTokens;
    cacheWriteTokens += usage.cacheWriteTokens;
    recorded += 1;
  }
  if (recorded === 0) {
    return { tokensLabel: '用量未记录', tokensTitle: '未记录本次回答的模型用量' };
  }
  let tokensLabel = `用量 ${COMPACT_TOKENS.format(totalTokens)} tok`;
  let prefix = '';
  if (recorded < assistants.length) {
    tokensLabel = `部分用量 ${COMPACT_TOKENS.format(totalTokens)} tok`;
    prefix = `已记录 ${recorded} / ${assistants.length} 次模型调用；`;
  }
  return {
    tokensLabel,
    tokensTitle:
      `${prefix}总计 ${EXACT_TOKENS.format(totalTokens)} tok；` +
      `输入 ${EXACT_TOKENS.format(inputTokens)}，输出 ${EXACT_TOKENS.format(outputTokens)}；` +
      `缓存读取 ${EXACT_TOKENS.format(cacheReadTokens)}，缓存写入 ${EXACT_TOKENS.format(cacheWriteTokens)}；` +
      '仅主对话模型调用（含工具轮）',
  };
};

const describeDuration = (durationMs: number): string => {
  const seconds = Math.max(0, durationMs) / 1_000;
  if (seconds < 60) return `用时 ${SECONDS.format(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `用时 ${minutes} 分 ${remainder} 秒`;
};

/** Keys settled input turns by their last assistant so actions follow trailing tool calls. */
export const buildAnswerFooters = (
  messages: readonly MessageView[],
  runs: readonly RunView[],
  activeRunId: string | null,
  branchId: string | undefined,
): ReadonlyMap<string, AnswerFooter> => {
  const turns = collectTurns(messages);
  const runsById = new Map(
    runs.map((run) => {
      return [run.id, run];
    }),
  );
  const lastTurnByRun = new Map<string, AnswerTurn>();
  for (const turn of turns) {
    for (const message of [turn.user, ...turn.assistants]) {
      if (message.runId !== null) lastTurnByRun.set(message.runId, turn);
    }
  }
  const footers = new Map<string, AnswerFooter>();
  for (const turn of turns) {
    const tail = turn.assistants.at(-1);
    if (tail === undefined) continue;
    let answer: MessageView | undefined;
    let finishedAt: number | undefined;
    let streaming = false;
    for (const assistant of turn.assistants) {
      if (assistant.status === 'streaming') streaming = true;
      if (assistant.status !== 'streaming' && assistant.text.length > 0) answer = assistant;
      if (assistant.finishedAt !== undefined) finishedAt = assistant.finishedAt;
    }
    if (answer === undefined || streaming) continue;
    const runId = answer.runId;
    let run: RunView | undefined;
    if (runId !== null) run = runsById.get(runId);
    const lastInRun = runId !== null && lastTurnByRun.get(runId) === turn;
    if (lastInRun && (run?.status === 'running' || runId === activeRunId)) continue;
    if (
      lastInRun &&
      run !== undefined &&
      run.status !== 'running' &&
      run.branchId === branchId &&
      run.finishedAt !== null
    ) {
      finishedAt = run.finishedAt;
    }
    let durationLabel = '用时未记录';
    let durationTitle = '本次回答未记录完整的结束时间';
    let timestamp = answer.createdAt;
    let timeTitle = `开始生成：${ANSWER_DATE.format(timestamp)}`;
    if (finishedAt !== undefined) {
      durationLabel = describeDuration(finishedAt - turn.user.createdAt);
      durationTitle = '从本次输入到回答结束，包含工具执行时间';
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
      metadata: {
        ...describeUsage(turn.assistants),
        durationLabel,
        durationTitle,
        timeLabel: ANSWER_TIME.format(timestamp),
        timeTitle,
        dateTime: new Date(timestamp).toISOString(),
      },
    });
  }
  return footers;
};

/** Equivalent historical statistics keep answer action rows reusable during later token updates. */
export const equalAnswerMetadata = (
  previous: AnswerMetadata | undefined,
  next: AnswerMetadata | undefined,
): boolean => {
  if (previous === next) return true;
  if (previous === undefined || next === undefined) return false;
  return (
    previous.tokensLabel === next.tokensLabel &&
    previous.tokensTitle === next.tokensTitle &&
    previous.durationLabel === next.durationLabel &&
    previous.durationTitle === next.durationTitle &&
    previous.timeLabel === next.timeLabel &&
    previous.timeTitle === next.timeTitle &&
    previous.dateTime === next.dateTime
  );
};
