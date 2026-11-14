import {
  ModelRequestDetailSchema,
  TraceEntryDetailSchema,
  TracePageSchema,
  type ModelRequestDetail,
  type ModelRequestDetailQuery,
  type TraceEntryDetail,
  type TracePage,
  type TraceQuery,
} from '@my-pi-harness/protocol';
import { getJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

const tracePath = (sessionId: string): string => {
  return '/sessions/' + encodeURIComponent(sessionId) + '/trace';
};

const queryString = (input: TraceQuery | ModelRequestDetailQuery): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.toString();
};

/** Reads one frozen, bounded page of committed execution facts. */
export const fetchTrace = async (
  sessionId: string,
  query: TraceQuery,
  signal: AbortSignal,
): Promise<TracePage> => {
  return parseResponse(
    TracePageSchema,
    await getJson(tracePath(sessionId) + '?' + queryString(query), signal),
  );
};

/** Request input is read only after selection and remains separate from its summary. */
export const fetchModelRequest = async (
  sessionId: string,
  requestId: string,
  query: ModelRequestDetailQuery,
  signal: AbortSignal,
): Promise<ModelRequestDetail> => {
  const detail = parseResponse(
    ModelRequestDetailSchema,
    await getJson(
      tracePath(sessionId) +
        '/requests/' +
        encodeURIComponent(requestId) +
        '?' +
        queryString(query),
      signal,
    ),
  );
  if (detail.summary.sessionId !== sessionId || detail.summary.modelRequestId !== requestId)
    throw new Error('模型请求详情与读取目标不一致。');
  return detail;
};

/** Tool and interaction details use the same bounded content cursor as model requests. */
export const fetchTraceEntry = async (
  sessionId: string,
  entryId: string,
  query: ModelRequestDetailQuery,
  signal: AbortSignal,
): Promise<TraceEntryDetail> => {
  const detail = parseResponse(
    TraceEntryDetailSchema,
    await getJson(
      tracePath(sessionId) + '/entries/' + encodeURIComponent(entryId) + '?' + queryString(query),
      signal,
    ),
  );
  if (detail.entry.id !== entryId) throw new Error('轨迹详情与读取目标不一致。');
  return detail;
};
