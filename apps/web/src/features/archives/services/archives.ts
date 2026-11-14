import {
  SessionArchiveJobSchema,
  SessionArchiveJobsPageSchema,
  type SessionArchiveJob,
  type SessionArchiveJobsPage,
  type SessionArchiveJobsQuery,
} from '@my-pi-harness/protocol';
import { getBlob, getJson, requestJson, uploadBlob } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

const ROOT = '/session-archives';

const parseJob = (data: unknown, operationId: string): SessionArchiveJob => {
  const job = parseResponse(SessionArchiveJobSchema, data);
  if (job.operationId !== operationId) throw new Error('归档操作与请求目标不一致。');
  return job;
};

/** The job identity is chosen before any export side effects and reused only by explicit retries. */
export const startArchiveExport = async (
  sessionId: string,
  operationId: string,
  signal: AbortSignal,
): Promise<SessionArchiveJob> => {
  const job = parseJob(
    await requestJson(ROOT + '/exports', 'POST', { operationId, sessionId }, signal),
    operationId,
  );
  if (job.kind !== 'export' || job.sessionId !== sessionId)
    throw new Error('归档导出与请求会话不一致。');
  return job;
};

/** Uploads gzip bytes directly; decoding and complete resource validation belong to the host. */
export const uploadSessionArchive = async (
  operationId: string,
  file: File,
  signal: AbortSignal,
): Promise<SessionArchiveJob> => {
  const job = parseJob(
    await uploadBlob(
      ROOT + '/imports/' + encodeURIComponent(operationId) + '/upload',
      file,
      'application/gzip',
      signal,
      300_000,
    ),
    operationId,
  );
  if (job.kind !== 'import') throw new Error('归档上传返回了其他类型的操作。');
  return job;
};

/** Publishing requires the exact digest returned by the completed preflight. */
export const commitSessionArchive = async (
  operationId: string,
  archiveSha256: string,
  signal: AbortSignal,
): Promise<SessionArchiveJob> => {
  const job = parseJob(
    await requestJson(
      ROOT + '/imports/' + encodeURIComponent(operationId) + '/commit',
      'POST',
      { archiveSha256 },
      signal,
    ),
    operationId,
  );
  if (job.kind !== 'import' || job.archiveSha256 !== archiveSha256)
    throw new Error('导入发布与已确认的归档不一致。');
  return job;
};

/** Reads current progress or the persistent import receipt after a host restart. */
export const fetchArchiveJob = async (
  operationId: string,
  signal: AbortSignal,
): Promise<SessionArchiveJob> => {
  return parseJob(
    await getJson(ROOT + '/operations/' + encodeURIComponent(operationId), signal),
    operationId,
  );
};

/** Only not-yet-published work can be cancelled; the returned job determines the actual state. */
export const cancelArchiveJob = async (
  operationId: string,
  signal: AbortSignal,
): Promise<SessionArchiveJob> => {
  return parseJob(
    await requestJson(
      ROOT + '/operations/' + encodeURIComponent(operationId) + '/cancel',
      'POST',
      {},
      signal,
    ),
    operationId,
  );
};

/** Bounded host history recovers operation identities without persisting previews in the browser. */
export const fetchArchiveJobs = async (
  input: SessionArchiveJobsQuery,
  signal: AbortSignal,
): Promise<SessionArchiveJobsPage> => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input))
    if (value !== undefined) query.set(key, String(value));
  return parseResponse(
    SessionArchiveJobsPageSchema,
    await getJson(ROOT + '/operations?' + query.toString(), signal),
  );
};

/** Downloads a completed host archive through the authenticated gzip endpoint. */
export const downloadSessionArchive = (operationId: string, signal: AbortSignal): Promise<Blob> => {
  return getBlob(
    ROOT + '/exports/' + encodeURIComponent(operationId) + '/download',
    'application/gzip',
    signal,
  );
};
