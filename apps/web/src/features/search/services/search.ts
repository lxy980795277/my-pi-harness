import {
  SearchQueryResultSchema,
  SearchSourceWindowSchema,
  type SearchQueryInput,
  type SearchQueryResult,
  type SearchSourceReadInput,
  type SearchSourceWindow,
} from '@my-pi-harness/protocol';
import { requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';
import { sourceSelectionKey, selectionFromHit } from '@/features/search/utils/search';

/** Human search is bounded and never triggers model preparation. */
export const fetchSearchResults = async (
  input: SearchQueryInput,
  signal: AbortSignal,
): Promise<SearchQueryResult> => {
  const result = parseResponse(
    SearchQueryResultSchema,
    await requestJson('/search', 'POST', input, signal, 15_000),
  );
  for (const hit of result.hits) {
    selectionFromHit(hit);
    if (hit.text.length !== hit.end - hit.start) throw new Error('搜索结果的原文范围无效。');
  }
  return result;
};

/** Only exact validated excerpts cross into a read-only view; this operation never selects an execution branch. */
export const fetchSearchSource = async (
  input: SearchSourceReadInput,
  signal: AbortSignal,
): Promise<SearchSourceWindow> => {
  const result = parseResponse(
    SearchSourceWindowSchema,
    await requestJson('/search/source', 'POST', input, signal),
  );
  if (sourceSelectionKey(result.selection) !== sourceSelectionKey(input.selection))
    throw new Error('来源响应与所选原文不一致。');
  if (
    result.items.some((item) => {
      return (
        item.source.kind !== item.target.kind ||
        item.end < item.start ||
        item.end > item.totalLength ||
        item.text.length !== item.end - item.start
      );
    })
  )
    throw new Error('来源响应的原文范围无效。');
  return result;
};
