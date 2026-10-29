import {
  AgentBoardSchema,
  AgentSettingsSchema,
  AgentTaskDetailSchema,
  AgentTaskListSchema,
  WorkSnapshotSchema,
  type AgentBoard,
  type AgentBoardQuery,
  type AgentMessageInput,
  type AgentSettings,
  type AgentTaskDetail,
  type AgentTaskList,
  type QuestionResponse,
  type WorkSnapshot,
} from '@my-pi-harness/protocol';
import { getJson, requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

const taskPath = (sessionId: string, taskId: string): string => {
  return `/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(taskId)}`;
};

/** Reads only the selected branch's task summaries. */
export const fetchAgentTasks = async (
  sessionId: string,
  signal: AbortSignal,
): Promise<AgentTaskList> => {
  return parseResponse(
    AgentTaskListSchema,
    await getJson(`/sessions/${encodeURIComponent(sessionId)}/agents`, signal),
  );
};

/** The board is paged by the host rather than loading every child transcript. */
export const fetchAgentBoard = async (
  workspaceId: string | null,
  cursor: number,
  filter: NonNullable<AgentBoardQuery['filter']>,
  signal: AbortSignal,
): Promise<AgentBoard> => {
  const query = new URLSearchParams({ cursor: String(cursor), limit: '100', filter });
  if (workspaceId !== null) query.set('workspaceId', workspaceId);
  return parseResponse(AgentBoardSchema, await getJson(`/agents?${query}`, signal));
};

/** Detail responses are checked against both requested identities before publication. */
export const fetchAgentDetail = async (
  sessionId: string,
  taskId: string,
  cursor: number,
  signal: AbortSignal,
): Promise<AgentTaskDetail> => {
  const detail = parseResponse(
    AgentTaskDetailSchema,
    await getJson(`${taskPath(sessionId, taskId)}?cursor=${cursor}&limit=100`, signal),
  );
  if (detail.task.sessionId !== sessionId || detail.task.id !== taskId)
    throw new Error('任务详情与请求目标不一致。');
  return detail;
};

/** Stop waits for the owned subtree's actual settlement; it is never optimistic. */
export const stopAgentTask = async (
  task: AgentTaskDetail['task'],
  signal: AbortSignal,
): Promise<AgentTaskDetail> => {
  return parseResponse(
    AgentTaskDetailSchema,
    await requestJson(
      `${taskPath(task.sessionId, task.id)}/stop`,
      'POST',
      { expectedRunId: task.latestRunId },
      signal,
      120_000,
    ),
  );
};

/** A continuation is explicit and addresses the last observed Run. */
export const sendAgentMessage = async (
  sessionId: string,
  taskId: string,
  input: AgentMessageInput,
  signal: AbortSignal,
): Promise<AgentTaskDetail> => {
  return parseResponse(
    AgentTaskDetailSchema,
    await requestJson(`${taskPath(sessionId, taskId)}/messages`, 'POST', input, signal),
  );
};

/** Answers the exact question within its task's original WorkState. */
export const answerAgentQuestion = async (
  sessionId: string,
  taskId: string,
  questionId: string,
  answers: QuestionResponse[] | null,
  signal: AbortSignal,
): Promise<WorkSnapshot> => {
  let action = 'cancel';
  let input: { answers?: QuestionResponse[] } = {};
  if (answers !== null) {
    action = 'answer';
    input = { answers };
  }
  return parseResponse(
    WorkSnapshotSchema,
    await requestJson(
      `${taskPath(sessionId, taskId)}/questions/${encodeURIComponent(questionId)}/${action}`,
      'POST',
      input,
      signal,
    ),
  );
};

/** Only the original revision-checked plan review command is exposed in task details. */
export const commandAgentWork = async (
  sessionId: string,
  taskId: string,
  command: string,
  input: unknown,
  signal: AbortSignal,
): Promise<WorkSnapshot> => {
  return parseResponse(
    WorkSnapshotSchema,
    await requestJson(`${taskPath(sessionId, taskId)}/${command}`, 'POST', input, signal),
  );
};

/** Role settings contain public configuration and no credentials. */
export const fetchAgentSettings = async (signal: AbortSignal): Promise<AgentSettings> => {
  return parseResponse(AgentSettingsSchema, await getJson('/agent-settings', signal));
};

/** Saving requires the exact revision the user edited. */
export const saveAgentSettings = async (
  input: AgentSettings,
  signal: AbortSignal,
): Promise<AgentSettings> => {
  return parseResponse(
    AgentSettingsSchema,
    await requestJson('/agent-settings', 'PUT', input, signal),
  );
};
