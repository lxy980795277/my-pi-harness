import {
  FileChangeBatchPageSchema,
  FileChangeBatchReceiptSchema,
  FileChangeDetailSchema,
  FileChangesPageSchema,
  type FileChangeBatchInput,
  type FileChangeBatchPage,
  type FileChangeBatchQuery,
  type FileChangeBatchReceipt,
  type FileChangeDetail,
  type FileChangeDetailQuery,
  type FileChangesPage,
  type FileChangesQuery,
} from '@my-pi-harness/protocol';
import { getJson, requestJson, RequestError } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

const NOT_ACCEPTED_CODES = new Set([
  'FILE_CHANGE_EMPTY',
  'FILE_CHANGE_LIMIT',
  'FILE_CHANGE_NOT_FOUND',
  'FILE_CHANGE_SELECTION_INVALID',
]);

/** Only explicit host pre-acceptance errors permit discarding an unconfirmed submission. */
export const fileChangeWasNotAccepted = (failure: unknown): boolean => {
  return (
    failure instanceof RequestError && failure.code !== null && NOT_ACCEPTED_CODES.has(failure.code)
  );
};

const path = (sessionId: string): string => {
  return '/sessions/' + encodeURIComponent(sessionId) + '/file-changes';
};

const queryString = (
  input: FileChangesQuery | FileChangeDetailQuery | FileChangeBatchQuery,
): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.toString();
};

/** Reads a bounded page; continuation cursors are supplied by the host. */
export const fetchFileChanges = async (
  sessionId: string,
  query: FileChangesQuery,
  signal: AbortSignal,
): Promise<FileChangesPage> => {
  const page = parseResponse(
    FileChangesPageSchema,
    await getJson(path(sessionId) + '?' + queryString(query), signal),
  );
  if (
    page.items.some((item) => {
      return item.sessionId !== sessionId;
    })
  )
    throw new Error('文件变更与读取的会话不一致。');
  return page;
};

/** Snapshot content is inert text and is fetched only after selecting a change. */
export const fetchFileChange = async (
  sessionId: string,
  changeId: string,
  query: FileChangeDetailQuery,
  signal: AbortSignal,
): Promise<FileChangeDetail> => {
  const detail = parseResponse(
    FileChangeDetailSchema,
    await getJson(
      path(sessionId) + '/' + encodeURIComponent(changeId) + '?' + queryString(query),
      signal,
    ),
  );
  if (detail.change.sessionId !== sessionId || detail.change.changeId !== changeId)
    throw new Error('文件变更详情与读取目标不一致。');
  return detail;
};

/** Submits one explicit operation identity. A transport failure never triggers a retry here. */
export const submitFileChangeBatch = async (
  sessionId: string,
  input: FileChangeBatchInput,
  signal: AbortSignal,
): Promise<FileChangeBatchReceipt> => {
  const receipt = parseResponse(
    FileChangeBatchReceiptSchema,
    await requestJson(path(sessionId) + '/operations', 'POST', input, signal),
  );
  if (receipt.operationId !== input.operationId || receipt.action !== input.action)
    throw new Error('文件操作回执与提交目标不一致。');
  return receipt;
};

/** Reads durable batch outcomes; HTTP 404 does not prove that submission had no effects. */
export const fetchFileChangeBatch = async (
  sessionId: string,
  operationId: string,
  signal: AbortSignal,
): Promise<FileChangeBatchReceipt> => {
  const receipt = parseResponse(
    FileChangeBatchReceiptSchema,
    await getJson(path(sessionId) + '/operations/' + encodeURIComponent(operationId), signal),
  );
  if (receipt.operationId !== operationId) throw new Error('文件操作回执与读取目标不一致。');
  return receipt;
};

/** Lists persisted user operations so a page reload can recover previously accepted work. */
export const fetchFileChangeBatches = async (
  sessionId: string,
  query: FileChangeBatchQuery,
  signal: AbortSignal,
): Promise<FileChangeBatchPage> => {
  return parseResponse(
    FileChangeBatchPageSchema,
    await getJson(path(sessionId) + '/operations?' + queryString(query), signal),
  );
};

/** Requests cancellation of remaining items; only the returned receipt establishes its outcome. */
export const cancelFileChangeBatch = async (
  sessionId: string,
  operationId: string,
  signal: AbortSignal,
): Promise<FileChangeBatchReceipt> => {
  const receipt = parseResponse(
    FileChangeBatchReceiptSchema,
    await requestJson(
      path(sessionId) + '/operations/' + encodeURIComponent(operationId) + '/cancel',
      'POST',
      {},
      signal,
    ),
  );
  if (receipt.operationId !== operationId) throw new Error('取消回执与读取目标不一致。');
  return receipt;
};
