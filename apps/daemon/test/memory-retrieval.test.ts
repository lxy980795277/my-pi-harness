import { createHash } from 'node:crypto';
import type {
  MemoryEntry,
  SearchHit,
  SearchRerankerStatus,
  SearchQueryResult,
} from '@my-pi-harness/protocol';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRetrieval } from '../src/memory/retrieval';

const ENTRY: MemoryEntry = {
  id: 'memory-one',
  scope: { kind: 'user' },
  category: 'fact',
  mode: 'relevant',
  body: '工作台请求缓存最长保留三十分钟。',
  revision: 2,
  enabled: true,
  source: { kind: 'manual' },
  createdAt: 1,
  updatedAt: 2,
};
const HIT: SearchHit = {
  source: {
    id: 'memory:memory-one',
    kind: 'memory',
    contentHash: createHash('sha256').update(ENTRY.body).digest('hex'),
  },
  memoryId: ENTRY.id,
  title: 'User memory',
  workspaceId: null,
  origin: 'memory',
  status: 'enabled',
  start: 0,
  end: ENTRY.body.length,
  text: ENTRY.body,
  score: 1,
  createdAt: 1,
};
const ACCESS = {
  ownerUserId: 'owner',
  workspaceId: 'workspace',
  includeUser: false,
  userMemoryIds: [ENTRY.id],
};

function verifier(scores: readonly (number | null)[] = [0.95]) {
  const state: SearchRerankerStatus = {
    state: 'ready',
    modelId: 'fixture-verifier',
    revision: 'fixed',
    signature: 'fixture-verifier-v1',
    maxInputTokens: 512,
    progress: null,
    error: null,
  };
  return { status: () => state, rerank: vi.fn(() => Promise.resolve(scores)) };
}

function searchResult(hit: SearchHit): SearchQueryResult {
  return {
    hits: [hit],
    mode: 'hybrid',
    truncated: false,
    generation: 1,
    watermark: '0'.repeat(64),
  };
}

describe('memory retrieval host adapter', () => {
  it('filters current scope and mode before retrieval and supplies exact body evidence to domain selection', async () => {
    const queryScoped = vi.fn(() => Promise.resolve(searchResult(HIT)));
    const entries = vi.fn(() => [ENTRY]);
    const retrieval = new MemoryRetrieval({ entries }, { queryScoped }, verifier());
    const signal = new AbortController().signal;
    const result = await retrieval.search(ACCESS, '缓存', signal, {
      mode: 'relevant',
      priority: 'tool',
    });
    expect(queryScoped).toHaveBeenCalledWith(
      {
        ownerUserId: ACCESS.ownerUserId,
        scope: {
          workspaceId: 'workspace',
          kind: 'memory',
          includeUserMemories: false,
          memoryMode: 'relevant',
        },
        userMemoryIds: [ENTRY.id],
      },
      { query: '缓存', limit: 50 },
      signal,
      { priority: 'tool' },
    );
    expect(entries).toHaveBeenCalledWith(ACCESS, [ENTRY.id]);
    expect(result).toEqual({
      candidates: [{ entry: ENTRY }],
      mode: 'hybrid',
      truncated: false,
      verification: 'not-needed',
    });
  });

  it('keeps verifier probabilities separate from embedding scores and marks overlong pairs unverified', async () => {
    const model = verifier([0.13]);
    const retrieval = new MemoryRetrieval(
      { entries: () => [ENTRY] },
      { queryScoped: () => Promise.resolve(searchResult(HIT)) },
      model,
    );
    const signal = new AbortController().signal;
    const result = await retrieval.search(ACCESS, '缓存', signal, {
      mode: 'relevant',
      verify: true,
    });
    expect(result.candidates).toEqual([{ entry: ENTRY, relevanceScore: 0.13 }]);
    expect(result.verification).toBe('local-model');
    expect(model.rerank).toHaveBeenCalledWith('缓存', [HIT.text], {
      priority: 'foreground',
      signal,
    });
    model.rerank.mockResolvedValue([null]);
    expect(await retrieval.search(ACCESS, '缓存', signal, { verify: true })).toMatchObject({
      candidates: [{ entry: ENTRY }],
      truncated: true,
      verification: 'unavailable',
    });
  });

  it('discards verifier output after cancellation rather than publishing a late successful probability', async () => {
    const controller = new AbortController();
    const model = verifier();
    model.rerank.mockImplementation(() => {
      controller.abort();
      return Promise.resolve([0.99]);
    });
    const retrieval = new MemoryRetrieval(
      { entries: () => [ENTRY] },
      { queryScoped: () => Promise.resolve(searchResult(HIT)) },
      model,
    );
    await expect(
      retrieval.search(ACCESS, '缓存', controller.signal, { verify: true }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('refuses stale body hashes and exposes a bounded query instead of silently treating it as complete', async () => {
    const retrieval = new MemoryRetrieval(
      { entries: () => [ENTRY] },
      {
        queryScoped: () =>
          Promise.resolve(
            searchResult({ ...HIT, source: { ...HIT.source, contentHash: '0'.repeat(64) } }),
          ),
      },
      verifier(),
    );
    const result = await retrieval.search(ACCESS, '缓存'.repeat(300), new AbortController().signal);
    expect(result).toMatchObject({ candidates: [], truncated: true });
  });

  it('does not read or publish memory bodies after a cancelled index query settles late', async () => {
    const controller = new AbortController();
    const entries = vi.fn(() => [ENTRY]);
    const retrieval = new MemoryRetrieval(
      { entries },
      {
        queryScoped: () => {
          controller.abort();
          return Promise.resolve(searchResult(HIT));
        },
      },
      verifier(),
    );
    await expect(retrieval.search(ACCESS, '缓存', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(entries).not.toHaveBeenCalled();
  });
});
