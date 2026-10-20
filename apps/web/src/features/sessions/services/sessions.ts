import type { SessionCommandMethod } from '@/features/sessions/types/session';
import {
  SessionSnapshotSchema,
  SessionSummarySchema,
  type EditInput,
  type InputRequest,
  type QueuePatchInput,
  type SessionCreateInput,
  type SessionPatchInput,
  type SessionSnapshot,
  type SessionSummary,
  type ToolDecisionInput,
} from '@my-pi-harness/protocol';
import { Type } from 'typebox';

import { getBlob, getJson, requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

const TOOL_DECISION_ACK_SCHEMA = Type.Object(
  { ok: Type.Literal(true) },
  { additionalProperties: false },
);

const pathFor = (id: string): string => {
  return `/sessions/${encodeURIComponent(id)}`;
};

const snapshotCommand = async (
  path: string,
  method: SessionCommandMethod,
  input: unknown,
  signal: AbortSignal,
): Promise<SessionSnapshot> => {
  return parseResponse(SessionSnapshotSchema, await requestJson(path, method, input, signal));
};

/** Lists persisted sessions; live detail is owned by its sequence-aware query. */
export const fetchSessions = async (signal: AbortSignal): Promise<SessionSummary[]> => {
  return parseResponse(Type.Array(SessionSummarySchema), await getJson('/sessions', signal));
};

/** Reads the committed branch projection and its transaction sequence. */
export const fetchSession = async (id: string, signal: AbortSignal): Promise<SessionSnapshot> => {
  const snapshot = parseResponse(SessionSnapshotSchema, await getJson(pathFor(id), signal));
  if (snapshot.session.id !== id) {
    throw new Error('会话响应与请求不一致。');
  }
  return snapshot;
};

/** Reads the session's durable JSONL bytes, including all recorded branches. */
export const fetchSessionLog = async (id: string, signal: AbortSignal): Promise<Blob> => {
  return getBlob(`${pathFor(id)}/log`, 'application/x-ndjson', signal);
};

/** Creates a session only after explicit provider/model selection. */
export const createSession = async (
  input: SessionCreateInput,
  signal: AbortSignal,
): Promise<SessionSnapshot> => {
  return snapshotCommand('/sessions', 'POST', input, signal);
};

/** Updates metadata and future-run model selection. */
export const patchSession = async (
  id: string,
  input: SessionPatchInput,
  signal: AbortSignal,
): Promise<SessionSnapshot> => {
  return snapshotCommand(pathFor(id), 'PUT', input, signal);
};

/** Submits an idempotent send, queued follow-up or steer command. */
export const submitInput = async (
  id: string,
  input: InputRequest,
  signal: AbortSignal,
): Promise<SessionSnapshot> => {
  return snapshotCommand(`${pathFor(id)}/inputs`, 'POST', input, signal);
};

/** Requests stop; the timeline remains running until a committed terminal outcome. */
export const stopSession = async (id: string, signal: AbortSignal): Promise<SessionSnapshot> => {
  return snapshotCommand(`${pathFor(id)}/stop`, 'POST', {}, signal);
};

/** Revises one queued input using the revision shown in the current snapshot. */
export const patchQueuedInput = async (
  id: string,
  queueId: string,
  input: QueuePatchInput,
  signal: AbortSignal,
): Promise<SessionSnapshot> => {
  return snapshotCommand(
    `${pathFor(id)}/queue/${encodeURIComponent(queueId)}`,
    'PUT',
    input,
    signal,
  );
};

/** Removes an accepted input; it never only hides a local copy. */
export const deleteQueuedInput = async (
  id: string,
  queueId: string,
  signal: AbortSignal,
): Promise<SessionSnapshot> => {
  return snapshotCommand(
    `${pathFor(id)}/queue/${encodeURIComponent(queueId)}`,
    'DELETE',
    {},
    signal,
  );
};

/** Resumes a persisted queue by explicit user action after restart or stop. */
export const resumeQueue = async (id: string, signal: AbortSignal): Promise<SessionSnapshot> => {
  return snapshotCommand(`${pathFor(id)}/queue/resume`, 'POST', {}, signal);
};

/** Forks an input revision and starts its new run without overwriting old history. */
export const editMessage = async (
  id: string,
  input: EditInput,
  signal: AbortSignal,
): Promise<SessionSnapshot> => {
  return snapshotCommand(`${pathFor(id)}/edit`, 'POST', input, signal);
};

/** Records a decision for the exact pending tool call; it never grants standing permission. */
export const decideTool = async (
  id: string,
  toolCallId: string,
  input: ToolDecisionInput,
  signal: AbortSignal,
): Promise<SessionSnapshot> => {
  parseResponse(
    TOOL_DECISION_ACK_SCHEMA,
    await requestJson(
      `${pathFor(id)}/tools/${encodeURIComponent(toolCallId)}/decision`,
      'POST',
      input,
      signal,
    ),
  );
  return fetchSession(id, signal);
};
