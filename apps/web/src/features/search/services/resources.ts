import {
  SearchIndexStatusSchema,
  SearchModelStatusSchema,
  SearchRerankerStatusSchema,
  type SearchIndexStatus,
  type SearchModelStatus,
  type SearchRerankerStatus,
} from '@my-pi-harness/protocol';
import { getJson, requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

/** Reading status never prepares or downloads a model. */
export const fetchSearchModel = async (signal: AbortSignal): Promise<SearchModelStatus> => {
  return parseResponse(SearchModelStatusSchema, await getJson('/search/model', signal));
};

/** Starts the daemon-owned preparation; HTTP cancellation does not stop that background operation. */
export const prepareSearchModel = async (signal: AbortSignal): Promise<SearchModelStatus> => {
  return parseResponse(
    SearchModelStatusSchema,
    await requestJson('/search/model/prepare', 'POST', {}, signal),
  );
};

/** Explicit cancellation waits for the daemon to settle the currently owned preparation. */
export const cancelSearchModel = async (signal: AbortSignal): Promise<SearchModelStatus> => {
  return parseResponse(
    SearchModelStatusSchema,
    await requestJson('/search/model/cancel', 'POST', {}, signal, 30_000),
  );
};

/** Relevance verification has independent readiness; status reads never download resources. */
export const fetchSearchReranker = async (signal: AbortSignal): Promise<SearchRerankerStatus> => {
  return parseResponse(SearchRerankerStatusSchema, await getJson('/search/reranker', signal));
};

/** Explicitly prepares the local pairwise model without changing semantic-model readiness. */
export const prepareSearchReranker = async (signal: AbortSignal): Promise<SearchRerankerStatus> => {
  return parseResponse(
    SearchRerankerStatusSchema,
    await requestJson('/search/reranker/prepare', 'POST', {}, signal),
  );
};

/** Only this explicit command cancels the daemon-owned relevance-model preparation. */
export const cancelSearchReranker = async (signal: AbortSignal): Promise<SearchRerankerStatus> => {
  return parseResponse(
    SearchRerankerStatusSchema,
    await requestJson('/search/reranker/cancel', 'POST', {}, signal, 30_000),
  );
};

/** Index readiness and coverage have their own server-owned status. */
export const fetchSearchIndex = async (signal: AbortSignal): Promise<SearchIndexStatus> => {
  return parseResponse(SearchIndexStatusSchema, await getJson('/search/index', signal));
};

/** Rebuild acknowledges scheduling immediately; progress is recovered through status polling. */
export const rebuildSearchIndex = async (signal: AbortSignal): Promise<SearchIndexStatus> => {
  return parseResponse(
    SearchIndexStatusSchema,
    await requestJson('/search/index/rebuild', 'POST', {}, signal),
  );
};
