import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  cancelSearchModel,
  cancelSearchReranker,
  fetchSearchIndex,
  fetchSearchModel,
  fetchSearchReranker,
  prepareSearchModel,
  prepareSearchReranker,
  rebuildSearchIndex,
} from '@/features/search/services/resources';
import type {
  SearchIndexView,
  SearchModelView,
  SearchResourceAction,
  SearchResourcesState,
} from '@/features/search/types/resources';
import {
  searchIndexPollInterval,
  searchIndexView,
  searchModelPollInterval,
  searchModelView,
} from '@/features/search/utils/resource-view';
import { useAsyncEvent } from '@/hooks/use-async-event';

export const SEARCH_MODEL_QUERY = queryOptions({
  queryKey: ['search-model'],
  queryFn: ({ signal }) => {
    return fetchSearchModel(signal);
  },
  refetchInterval: (query) => {
    return searchModelPollInterval(query.state.data);
  },
});

export const SEARCH_INDEX_QUERY = queryOptions({
  queryKey: ['search-index'],
  queryFn: ({ signal }) => {
    return fetchSearchIndex(signal);
  },
  refetchInterval: (query) => {
    return searchIndexPollInterval(query.state.data);
  },
});

export const SEARCH_RERANKER_QUERY = queryOptions({
  queryKey: ['search-reranker'],
  queryFn: ({ signal }) => {
    return fetchSearchReranker(signal);
  },
  refetchInterval: (query) => {
    return searchModelPollInterval(query.state.data);
  },
});

/** This settings observer owns HTTP and polling, while preparation and rebuilding remain daemon-owned. */
export const useSearchResources = (): SearchResourcesState => {
  const client = useQueryClient();
  const model = useQuery(SEARCH_MODEL_QUERY);
  const reranker = useQuery(SEARCH_RERANKER_QUERY);
  const index = useQuery(SEARCH_INDEX_QUERY);
  const command = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, action: SearchResourceAction): Promise<void> => {
        try {
          switch (action) {
            case 'prepare': {
              const status = await prepareSearchModel(signal);
              signal.throwIfAborted();
              client.setQueryData(SEARCH_MODEL_QUERY.queryKey, status);
              break;
            }
            case 'cancel': {
              const status = await cancelSearchModel(signal);
              signal.throwIfAborted();
              client.setQueryData(SEARCH_MODEL_QUERY.queryKey, status);
              break;
            }
            case 'prepare-reranker': {
              const status = await prepareSearchReranker(signal);
              signal.throwIfAborted();
              client.setQueryData(SEARCH_RERANKER_QUERY.queryKey, status);
              break;
            }
            case 'cancel-reranker': {
              const status = await cancelSearchReranker(signal);
              signal.throwIfAborted();
              client.setQueryData(SEARCH_RERANKER_QUERY.queryKey, status);
              break;
            }
            case 'rebuild': {
              const status = await rebuildSearchIndex(signal);
              signal.throwIfAborted();
              client.setQueryData(SEARCH_INDEX_QUERY.queryKey, status);
              break;
            }
            case 'refresh':
              break;
            default: {
              const unexpected: never = action;
              throw new Error(`未知资源操作：${String(unexpected)}`);
            }
          }
        } finally {
          await Promise.all([
            client.invalidateQueries({ queryKey: SEARCH_MODEL_QUERY.queryKey }),
            client.invalidateQueries({ queryKey: SEARCH_RERANKER_QUERY.queryKey }),
            client.invalidateQueries({ queryKey: SEARCH_INDEX_QUERY.queryKey }),
          ]);
        }
      },
      [client],
    ),
  );
  const { run } = command;
  const prepare = useCallback((): void => {
    run('prepare');
  }, [run]);
  const cancel = useCallback((): void => {
    run('cancel');
  }, [run]);
  const prepareReranker = useCallback((): void => {
    run('prepare-reranker');
  }, [run]);
  const cancelReranker = useCallback((): void => {
    run('cancel-reranker');
  }, [run]);
  const rebuild = useCallback((): void => {
    run('rebuild');
  }, [run]);
  const refresh = useCallback((): void => {
    run('refresh');
  }, [run]);
  let modelView: SearchModelView | null = null;
  if (model.data !== undefined) modelView = searchModelView(model.data);
  let rerankerView: SearchModelView | null = null;
  if (reranker.data !== undefined) rerankerView = searchModelView(reranker.data, 'reranker');
  let indexView: SearchIndexView | null = null;
  if (index.data !== undefined) indexView = searchIndexView(index.data);
  return {
    model,
    reranker,
    index,
    modelView,
    rerankerView,
    indexView,
    command,
    prepare,
    cancel,
    prepareReranker,
    cancelReranker,
    rebuild,
    refresh,
  };
};
