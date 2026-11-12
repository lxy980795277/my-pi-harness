import type {
  SearchIndexStatus,
  SearchModelStatus,
  SearchRerankerStatus,
} from '@my-pi-harness/protocol';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelSearchModel,
  cancelSearchReranker,
  fetchSearchIndex,
  fetchSearchModel,
  fetchSearchReranker,
  prepareSearchModel,
  prepareSearchReranker,
  rebuildSearchIndex,
} from '../src/features/search/services/resources';
import {
  SEARCH_MODEL_QUERY,
  SEARCH_RERANKER_QUERY,
} from '../src/features/search/hooks/use-search-resources';
import { SearchResourcesPanel } from '../src/features/search/components/search-resources';
import {
  searchIndexPollInterval,
  searchIndexView,
  searchModelPollInterval,
  searchModelView,
} from '../src/features/search/utils/resource-view';

const MODEL: SearchModelStatus = {
  state: 'unprepared',
  modelId: 'fixture-model',
  revision: 'fixture-revision',
  signature: 'fixture-signature',
  dimensions: 384,
  maxInputTokens: 512,
  progress: null,
  error: null,
};
const RERANKER: SearchRerankerStatus = {
  state: 'unprepared',
  modelId: 'fixture-reranker',
  revision: 'fixture-reranker-revision',
  signature: 'fixture-reranker-signature',
  maxInputTokens: 512,
  progress: null,
  error: null,
};
const INDEX: SearchIndexStatus = {
  state: 'ready',
  generation: 2,
  buildingGeneration: null,
  lexicalReady: true,
  sourceCount: 10,
  chunkCount: 20,
  vectorCount: 0,
  pendingSources: 0,
  error: null,
};

const respond = (body: unknown) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => {
    return Promise.resolve(
      new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('search resource presentation', () => {
  it('keeps ready semantic retrieval alongside an independently unprepared relevance model', () => {
    const semantic = searchModelView({ ...MODEL, state: 'ready' });
    const reranker = searchModelView(RERANKER, 'reranker');
    expect(semantic.label).toBe('就绪');
    expect(reranker).toMatchObject({ label: '未准备', canPrepare: true, canCancel: false });
    expect(reranker.description).toContain('固定记忆与人工搜索仍可使用');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(SEARCH_MODEL_QUERY.queryKey, { ...MODEL, state: 'ready' });
    client.setQueryData(SEARCH_RERANKER_QUERY.queryKey, RERANKER);
    client.setQueryData(['search-index'], INDEX);
    try {
      const html = renderToStaticMarkup(
        createElement(QueryClientProvider, { client }, createElement(SearchResourcesPanel)),
      );
      expect(html).toContain('准备相关性复核模型');
      expect(html).toContain('语义模型');
      expect(html).toContain('就绪');
      expect(html).toContain('未准备');
      expect(html).not.toContain('aria-label="准备语义模型"');
    } finally {
      client.clear();
    }
  });

  it('keeps model readiness separate from index text availability and semantic coverage', () => {
    expect(searchModelView(MODEL)).toMatchObject({
      label: '未准备',
      canPrepare: true,
      canCancel: false,
    });
    expect(searchIndexView(INDEX)).toMatchObject({
      lexicalLabel: '关键词检索可用',
      coverageLabel: '语义索引 0 / 20 个片段',
    });
    expect(searchModelView({ ...MODEL, state: 'ready' })).toMatchObject({
      canPrepare: false,
      canCancel: false,
    });
    expect(searchIndexView({ ...INDEX, state: 'failed', error: 'fixture failure' })).toMatchObject({
      label: '更新失败',
      lexicalLabel: '关键词检索可用',
    });
  });

  it('shows actual download bytes without inventing an unknown total or percentage', () => {
    const status: SearchModelStatus = {
      ...MODEL,
      state: 'preparing',
      progress: { loadedBytes: 1_500_000, totalBytes: null },
    };
    expect(searchModelView(status)).toMatchObject({
      progressLabel: '已下载 1.5 MB',
      canPrepare: false,
      canCancel: true,
    });
    expect(
      searchModelView({ ...status, progress: { loadedBytes: 1_500_000, totalBytes: 3_000_000 } })
        .progressLabel,
    ).toBe('已下载 1.5 MB / 3 MB');
    expect(
      searchModelView(
        { ...RERANKER, state: 'preparing', progress: { loadedBytes: 1_500_000, totalBytes: null } },
        'reranker',
      ),
    ).toMatchObject({ progressLabel: '已下载 1.5 MB', canCancel: true });
  });

  it('polls active work quickly and idle foreground status slowly, retaining rebuilding independently', () => {
    expect(searchModelPollInterval(undefined)).toBe(false);
    expect(searchModelPollInterval(MODEL)).toBe(10_000);
    expect(searchModelPollInterval({ ...MODEL, state: 'preparing' })).toBe(1000);
    expect(searchModelPollInterval({ ...MODEL, state: 'unavailable' })).toBe(10_000);
    expect(searchModelPollInterval(RERANKER)).toBe(10_000);
    expect(searchModelPollInterval({ ...RERANKER, state: 'preparing' })).toBe(1000);
    expect(searchIndexPollInterval(INDEX)).toBe(10_000);
    expect(searchIndexPollInterval({ ...INDEX, state: 'catching-up' })).toBe(1500);
    expect(searchIndexView({ ...INDEX, buildingGeneration: 3 }).rebuilding).toBe(true);
    expect(searchIndexPollInterval({ ...INDEX, buildingGeneration: 3 })).toBe(1500);
  });
});

describe('explicit resource transport', () => {
  it('status reads are GET-only and never prepare resources', async () => {
    const fetch = respond(MODEL);
    const signal = new AbortController().signal;
    await expect(fetchSearchModel(signal)).resolves.toEqual(MODEL);
    expect(fetch).toHaveBeenCalledWith(
      '/api/search/model',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const rerankerFetch = respond(RERANKER);
    await expect(fetchSearchReranker(signal)).resolves.toEqual(RERANKER);
    expect(rerankerFetch).toHaveBeenCalledWith(
      '/api/search/reranker',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(rerankerFetch).toHaveBeenCalledTimes(1);
    const indexFetch = respond(INDEX);
    await expect(fetchSearchIndex(signal)).resolves.toEqual(INDEX);
    expect(indexFetch).toHaveBeenCalledWith(
      '/api/search/index',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('starts, cancels and rebuilds only through explicit empty-body commands', async () => {
    const signal = new AbortController().signal;
    const modelFetch = respond({ ...MODEL, state: 'preparing' });
    await prepareSearchModel(signal);
    expect(modelFetch).toHaveBeenCalledWith(
      '/api/search/model/prepare',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
    const cancelFetch = respond(MODEL);
    await cancelSearchModel(signal);
    expect(cancelFetch).toHaveBeenCalledWith(
      '/api/search/model/cancel',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
    const rerankerFetch = respond({ ...RERANKER, state: 'preparing' });
    await prepareSearchReranker(signal);
    expect(rerankerFetch).toHaveBeenCalledWith(
      '/api/search/reranker/prepare',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
    const rerankerCancelFetch = respond(RERANKER);
    await cancelSearchReranker(signal);
    expect(rerankerCancelFetch).toHaveBeenCalledWith(
      '/api/search/reranker/cancel',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
    const indexFetch = respond({ ...INDEX, state: 'catching-up', buildingGeneration: 3 });
    await rebuildSearchIndex(signal);
    expect(indexFetch).toHaveBeenCalledWith(
      '/api/search/index/rebuild',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });

  it('rejects malformed resource states before they can replace the current status', async () => {
    respond({ ...MODEL, state: 'ready', accessToken: 'private' });
    await expect(fetchSearchModel(new AbortController().signal)).rejects.toThrow();
    respond({ ...INDEX, vectorCount: -1 });
    await expect(fetchSearchIndex(new AbortController().signal)).rejects.toThrow();
    respond({ ...RERANKER, dimensions: 384 });
    await expect(fetchSearchReranker(new AbortController().signal)).rejects.toThrow();
  });

  it.each(['embedding', 'reranker'])(
    'closing the %s observer aborts its read without cancelling daemon-owned preparation',
    async (kind) => {
      let releaseAbort: (() => void) | undefined;
      const aborted = new Promise<void>((resolve) => {
        releaseAbort = resolve;
      });
      const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((_url, init) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal === undefined || signal === null)
            throw new Error('Missing cancellation signal');
          signal.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Read aborted', 'AbortError'));
              releaseAbort?.();
            },
            { once: true },
          );
        });
      });
      vi.stubGlobal('fetch', fetch);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      let path = '/api/search/model';
      if (kind === 'reranker') path = '/api/search/reranker';
      const createObserver = () => {
        if (kind === 'embedding') return new QueryObserver(client, SEARCH_MODEL_QUERY);
        return new QueryObserver(client, SEARCH_RERANKER_QUERY);
      };
      const observer = createObserver();
      const unsubscribe = observer.subscribe(() => {
        return;
      });
      try {
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        unsubscribe();
        await aborted;
        expect(fetch).toHaveBeenCalledWith(path, expect.objectContaining({ method: 'GET' }));
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(client.getQueryData(SEARCH_MODEL_QUERY.queryKey)).toBeUndefined();
        expect(client.getQueryData(SEARCH_RERANKER_QUERY.queryKey)).toBeUndefined();
      } finally {
        unsubscribe();
        client.clear();
      }
    },
  );
});
