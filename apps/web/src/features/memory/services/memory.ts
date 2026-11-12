import {
  MemoryCurrentStatusSchema,
  MemoryPageSchema,
  MemoryMutationResultSchema,
  MemorySettingsSchema,
  MemoryUsageSchema,
  type MemoryCreateInput,
  type MemoryCurrentStatus,
  type MemoryListInput,
  type MemoryPage,
  type MemoryForgetInput,
  type MemoryMutationResult,
  type MemoryScope,
  type MemorySettings,
  type MemorySettingsInput,
  type MemoryUpdateInput,
  type MemoryUsage,
} from '@my-pi-harness/protocol';
import { Type } from 'typebox';
import { getJson, requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';
import { memoryScopeKey } from '@/features/memory/utils/memory-view';

const CURRENT_STATUSES_SCHEMA = Type.Array(MemoryCurrentStatusSchema, { maxItems: 128 });
const NULLABLE_USAGE_SCHEMA = Type.Union([MemoryUsageSchema, Type.Null()]);

const pathFor = (id: string): string => {
  return `/memories/${encodeURIComponent(id)}`;
};

/** The daemon derives ownership; a client filter names only user or the current workspace. */
export const fetchMemoryPage = async (
  scope: MemoryScope,
  input: Omit<MemoryListInput, 'scope'>,
  signal: AbortSignal,
): Promise<MemoryPage> => {
  const query = new URLSearchParams({ scope: scope.kind });
  if (scope.kind === 'workspace') query.set('workspaceId', scope.workspaceId);
  if (input.mode !== undefined) query.set('mode', input.mode);
  if (input.cursor !== undefined) query.set('cursor', input.cursor);
  if (input.limit !== undefined) query.set('limit', String(input.limit));
  if (input.enabled !== undefined) query.set('enabled', String(input.enabled));
  if (input.category !== undefined) query.set('category', input.category);
  const page = parseResponse(MemoryPageSchema, await getJson(`/memories?${query}`, signal));
  const key = memoryScopeKey(scope);
  if (
    page.items.some((entry) => {
      return (
        memoryScopeKey(entry.scope) !== key ||
        (input.mode !== undefined && entry.mode !== input.mode) ||
        (input.enabled !== undefined && entry.enabled !== input.enabled) ||
        (input.category !== undefined && entry.category !== input.category)
      );
    })
  ) {
    throw new Error('记忆响应与请求范围或采用方式不一致。');
  }
  if (page.nextCursor !== null && (page.items.length === 0 || page.nextCursor === input.cursor)) {
    throw new Error('记忆分页游标没有前进，请刷新列表。');
  }
  return page;
};

/** An absent list page is not evidence of forgetting; current state is read by exact adopted IDs. */
export const fetchMemoryStatuses = async (
  ids: readonly string[],
  signal: AbortSignal,
): Promise<MemoryCurrentStatus[]> => {
  const requested = new Set(ids);
  if (requested.size !== ids.length || ids.length > 128) throw new Error('记忆状态查询范围无效。');
  const statuses = parseResponse(
    CURRENT_STATUSES_SCHEMA,
    await requestJson('/memories/statuses', 'POST', { ids }, signal),
  );
  const returned = new Set(
    statuses.map((entry) => {
      return entry.id;
    }),
  );
  if (
    returned.size !== ids.length ||
    statuses.length !== ids.length ||
    statuses.some((entry) => {
      return !requested.has(entry.id);
    })
  ) {
    throw new Error('记忆状态与请求的条目不一致。');
  }
  return statuses;
};

/** Idempotent writes retain their original request ID until the host acknowledges their result. */
export const createMemory = async (
  input: MemoryCreateInput,
  signal: AbortSignal,
): Promise<MemoryMutationResult> => {
  const result = parseResponse(
    MemoryMutationResultSchema,
    await requestJson('/memories', 'POST', input, signal),
  );
  if (
    result.receipt.requestId !== input.requestId ||
    result.receipt.operation !== 'create' ||
    (result.entry !== null &&
      (result.entry.id !== result.receipt.memoryId ||
        memoryScopeKey(result.entry.scope) !== memoryScopeKey(input.scope)))
  )
    throw new Error('保存结果与原请求不一致。');
  return result;
};

/** Updating a memory requires the revision shown when editing began. */
export const updateMemory = async (
  id: string,
  input: MemoryUpdateInput,
  signal: AbortSignal,
): Promise<MemoryMutationResult> => {
  const result = parseResponse(
    MemoryMutationResultSchema,
    await requestJson(pathFor(id), 'PATCH', input, signal),
  );
  if (
    result.receipt.requestId !== input.requestId ||
    result.receipt.operation !== 'update' ||
    result.receipt.memoryId !== id ||
    (result.entry !== null && result.entry.id !== id)
  )
    throw new Error('修改结果与原记忆不一致。');
  return result;
};

/** Forgetting removes future adoption while preserving the history of past model requests. */
export const forgetMemory = async (
  id: string,
  input: MemoryForgetInput,
  signal: AbortSignal,
): Promise<MemoryMutationResult> => {
  const result = parseResponse(
    MemoryMutationResultSchema,
    await requestJson(pathFor(id), 'DELETE', input, signal),
  );
  if (
    result.receipt.requestId !== input.requestId ||
    result.receipt.operation !== 'forget' ||
    result.receipt.memoryId !== id ||
    result.entry !== null
  ) {
    throw new Error('遗忘结果与原记忆不一致。');
  }
  return result;
};

/** Settings contain no credentials and remain server-owned. */
export const fetchMemorySettings = async (signal: AbortSignal): Promise<MemorySettings> => {
  return parseResponse(MemorySettingsSchema, await getJson('/memory-settings', signal));
};

/** Settings updates compare the original revision and never retry as a new write automatically. */
export const saveMemorySettings = async (
  input: MemorySettingsInput,
  signal: AbortSignal,
): Promise<MemorySettings> => {
  return parseResponse(
    MemorySettingsSchema,
    await requestJson('/memory-settings', 'PUT', input, signal),
  );
};

/** Reads the exact dispatched request snapshot, not the current memory database. */
export const fetchMemoryUsage = async (
  sessionId: string,
  runId: string,
  signal: AbortSignal,
): Promise<MemoryUsage | null> => {
  const usage = parseResponse(
    NULLABLE_USAGE_SCHEMA,
    await getJson(
      `/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/memory-usage`,
      signal,
    ),
  );
  if (usage !== null && (usage.sessionId !== sessionId || usage.runId !== runId)) {
    throw new Error('采用记录与请求的运行不一致。');
  }
  return usage;
};
