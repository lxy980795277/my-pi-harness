import {
  SessionExecutionAccessSchema,
  SessionSummarySchema,
  type SessionArchiveImportBinding,
  type SessionExecutionAccess,
  type SessionSummary,
} from '@my-pi-harness/protocol';
import { getJson, requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

/** Imported history is readable independently from current execution dependencies. */
export const fetchArchiveAccess = async (
  sessionId: string,
  signal: AbortSignal,
): Promise<SessionExecutionAccess> => {
  return parseResponse(
    SessionExecutionAccessSchema,
    await getJson('/sessions/' + encodeURIComponent(sessionId) + '/archive-access', signal),
  );
};

/** Explicit current binding always restarts approval in ask mode; no historical grants migrate. */
export const bindImportedSession = async (
  sessionId: string,
  input: SessionArchiveImportBinding,
  signal: AbortSignal,
): Promise<SessionSummary> => {
  const session = parseResponse(
    SessionSummarySchema,
    await requestJson(
      '/sessions/' + encodeURIComponent(sessionId) + '/archive-binding',
      'PUT',
      input,
      signal,
    ),
  );
  if (
    session.id !== sessionId ||
    session.providerId !== input.providerId ||
    session.modelId !== input.modelId ||
    session.thinkingLevel !== input.thinkingLevel ||
    session.workspaceId !== input.workspaceId ||
    session.approvalMode !== 'ask'
  )
    throw new Error('导入会话的执行绑定与请求不一致。');
  return session;
};
