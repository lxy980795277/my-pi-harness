import type { MessageView, RunView } from '@my-pi-harness/protocol';

interface UnattachedRunFailure {
  run: RunView;
  text: string;
}

export interface RunFailures {
  messages: ReadonlyMap<string, string>;
  unattached: readonly UnattachedRunFailure[];
}

const DEFAULT_REQUEST_ERROR = '模型请求失败，请稍后重试。';
const GENERIC_ERROR =
  /^(?:(?:the )?model (?:request|response|run) failed|(?:the )?model request did not complete|request failed)[.!]?$/iu;

/** Historical generic failures use product text without changing their recorded value. */
export const requestFailureText = (error: string | null): string => {
  const text = error?.trim();
  if (text === undefined || text.length === 0 || GENERIC_ERROR.test(text))
    return DEFAULT_REQUEST_ERROR;
  return text;
};

/** Match a failed execution to its terminal partial answer; completed text never owns its error. */
export const buildRunFailures = (
  messages: readonly MessageView[],
  runs: readonly RunView[],
  branchId?: string,
): RunFailures => {
  const errors = new Map<string, string>();
  const lastAssistantByRun = new Map<string, MessageView>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    if (message.status === 'failed') errors.set(message.id, DEFAULT_REQUEST_ERROR);
    if (message.runId !== null) lastAssistantByRun.set(message.runId, message);
  }
  const unattached: UnattachedRunFailure[] = [];
  for (const run of runs) {
    if (run.status !== 'failed') continue;
    const text = requestFailureText(run.error);
    const target = lastAssistantByRun.get(run.id);
    if (target !== undefined && target.status !== 'complete' && target.status !== 'streaming')
      errors.set(target.id, text);
    else if (branchId === undefined || run.branchId === branchId) unattached.push({ run, text });
  }
  return { messages: errors, unattached };
};
