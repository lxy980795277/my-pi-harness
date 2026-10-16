import {
  RuleSourceSchema,
  WorkSnapshotSchema,
  type RuleSource,
  type QuestionResponse,
  type WorkPatch,
  type WorkSnapshot,
} from '@my-pi-harness/protocol';
import { Type } from 'typebox';
import { getJson, requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

const pathFor = (id: string): string => {
  return `/sessions/${encodeURIComponent(id)}/work`;
};
/** Reads committed branch-local planning and context state. */
export const fetchWork = async (
  id: string,
  branchId: string,
  signal: AbortSignal,
): Promise<WorkSnapshot> => {
  const snapshot = parseResponse(
    WorkSnapshotSchema,
    await getJson(`${pathFor(id)}?branchId=${encodeURIComponent(branchId)}`, signal),
  );
  if (snapshot.state.branchId !== branchId) {
    throw new Error('会话工作状态与请求分支不一致。');
  }
  return snapshot;
};
/** Updates a revision-checked work state, preserving the host as the sole fact owner. */
export const patchWork = async (
  id: string,
  patch: WorkPatch,
  signal: AbortSignal,
): Promise<WorkSnapshot> => {
  const snapshot = parseResponse(
    WorkSnapshotSchema,
    await requestJson(pathFor(id), 'PATCH', patch, signal),
  );
  if (snapshot.state.branchId !== patch.expectedBranchId) {
    throw new Error('工作状态更新响应与原分支不一致。');
  }
  return snapshot;
};
/** Runs explicit context/checkpoint commands without optimistic history changes. */
export const commandWork = async (
  id: string,
  command: string,
  input: unknown,
  signal: AbortSignal,
): Promise<WorkSnapshot> => {
  return parseResponse(
    WorkSnapshotSchema,
    await requestJson(`${pathFor(id)}/${command}`, 'POST', input, signal, 120_000),
  );
};
/** Answers or cancels one durable question owned by this session's active run. */
export const answerQuestion = async (
  id: string,
  questionId: string,
  answers: QuestionResponse[] | null,
  signal: AbortSignal,
): Promise<WorkSnapshot> => {
  let action = 'cancel';
  let body: { answers?: QuestionResponse[] } = {};
  if (answers !== null) {
    action = 'answer';
    body = { answers };
  }
  return parseResponse(
    WorkSnapshotSchema,
    await requestJson(
      `/sessions/${encodeURIComponent(id)}/questions/${encodeURIComponent(questionId)}/${action}`,
      'POST',
      body,
      signal,
    ),
  );
};
/** Previews the workspace's current root rules before the next run freezes them. */
export const fetchWorkspaceRules = async (
  workspaceId: string,
  signal: AbortSignal,
): Promise<RuleSource[]> => {
  return parseResponse(
    Type.Array(RuleSourceSchema),
    await getJson(`/workspaces/${encodeURIComponent(workspaceId)}/rules`, signal),
  );
};
