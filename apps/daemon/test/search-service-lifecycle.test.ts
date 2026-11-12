import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { MemoryService } from '@my-pi-harness/memory';
import type { SearchModelStatus, SearchRerankerStatus } from '@my-pi-harness/protocol';
import { openProfileStore, type ProfileStore } from '@my-pi-harness/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchService, type SearchServiceOptions } from '../src/search/service';
import { MemoryRetrieval } from '../src/memory/retrieval';
import { documentTerms } from '../src/search/text';

type EmbeddingRequestOptions = Parameters<SearchServiceOptions['embedding']['embed']>[1];

interface Gate {
  promise: Promise<void>;
  release(): void;
  fail(error: Error): void;
}

interface Fixture {
  directory: string;
  store: ProfileStore;
  service: SearchService;
  model: ReturnType<typeof embedding>;
  verifier: ReturnType<typeof reranker>;
  diagnostics: unknown[];
  releases: (() => void)[];
  serviceClosed: boolean;
}

const fixtures: Fixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    for (const release of fixture.releases) release();
    try {
      if (!fixture.serviceClosed) await fixture.service.close();
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }
});

function gate(fixture: Fixture): Gate {
  let release = (): void => {
    throw new Error('Uninitialized gate');
  };
  let fail = (_error: Error): void => {
    throw new Error('Uninitialized gate');
  };
  const promise = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  fixture.releases.push(release);
  return { promise, release, fail };
}

function embedding() {
  const state: SearchModelStatus = {
    state: 'unprepared',
    modelId: 'fixture',
    revision: 'fixed',
    signature: 'fixture-v1',
    dimensions: 2,
    maxInputTokens: 512,
    progress: null,
    error: null,
  };
  let embed:
    | ((options: EmbeddingRequestOptions) => Promise<readonly (readonly number[])[]>)
    | undefined;
  let prepare: ((signal: AbortSignal) => Promise<void>) | undefined;
  const port: SearchServiceOptions['embedding'] = {
    status: () => ({ ...state }),
    embed: async (texts, options) => {
      if (embed) return await embed(options);
      options.signal.throwIfAborted();
      return texts.map(() => [1, 0]);
    },
    tokenCounts: (texts, options) => {
      options.signal.throwIfAborted();
      return Promise.resolve(texts.map((text) => text.length + 11));
    },
    prepare: async (signal) => {
      state.state = 'preparing';
      if (prepare) return await prepare(signal);
      signal.throwIfAborted();
      state.state = 'ready';
    },
  };
  return {
    state,
    port,
    onEmbed(value: NonNullable<typeof embed>) {
      embed = value;
    },
    onPrepare(value: NonNullable<typeof prepare>) {
      prepare = value;
    },
  };
}

function reranker() {
  const state: SearchRerankerStatus = {
    state: 'unprepared',
    modelId: 'fixture-verifier',
    revision: 'fixed',
    signature: 'verifier-v1',
    maxInputTokens: 512,
    progress: null,
    error: null,
  };
  let prepare: ((signal: AbortSignal) => Promise<void>) | undefined;
  const port: SearchServiceOptions['reranker'] = {
    status: () => ({ ...state }),
    prepare: async (signal) => {
      state.state = 'preparing';
      if (prepare) return await prepare(signal);
      signal.throwIfAborted();
      state.state = 'ready';
    },
  };
  return {
    state,
    port,
    onPrepare(value: NonNullable<typeof prepare>) {
      prepare = value;
    },
  };
}

async function fixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'search-service-lifecycle-'));
  const store = await openProfileStore(directory);
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  store.auth.createLocalClient({
    id: 'client',
    tokenHash: hash('client'),
    csrfToken: 'csrf',
    createdAt: 1,
    expiresAt: 100,
  });
  const login = store.auth.completeLogin(
    {
      providerId: 'github',
      issuer: 'https://github.com',
      subject: 'lifecycle-owner',
      name: 'Fixture',
      avatarUrl: null,
    },
    'client',
    { id: 'login', tokenHash: hash('login'), createdAt: 2, expiresAt: 99 },
  );
  const memory = new MemoryService(store.memory);
  memory.create(login.user.id, {
    requestId: 'save',
    scope: { kind: 'user' },
    category: 'fact',
    body: 'Database uses SQLite',
    enabled: true,
  });
  const source = store.search.sources().items[0];
  if (!source) throw new Error('Missing persistent source');
  store.search.replaceChunks({
    generation: 1,
    source: source.source,
    signature: 'fixture-chunks',
    chunks: [
      {
        ordinal: 0,
        start: 0,
        end: source.text.length,
        text: source.text,
        tokens: documentTerms(source.text),
      },
    ],
  });
  store.search.activate(1, store.search.watermark());
  const model = embedding();
  const verifier = reranker();
  const diagnostics: unknown[] = [];
  const service = new SearchService({
    store,
    embedding: model.port,
    reranker: verifier.port,
    onError: (error) => diagnostics.push(error),
  });
  const value = {
    directory,
    store,
    service,
    model,
    verifier,
    diagnostics,
    releases: [],
    serviceClosed: false,
  };
  fixtures.push(value);
  return value;
}

describe('search service request ownership', () => {
  it.each(['generation', 'source'] as const)(
    'rejects a result when its %s changes after the real vector page yields',
    async (change) => {
      const f = await fixture();
      f.model.state.state = 'ready';
      const scanned = gate(f);
      const actualVectors = f.store.search.vectors.bind(f.store.search);
      f.store.search.vectors = (...args) => {
        const page = actualVectors(...args);
        scanned.release();
        return page;
      };
      const request = f.service.search({ query: 'Database' }, new AbortController().signal);
      const observed = Promise.allSettled([request]);
      try {
        await scanned.promise;
        const source = f.store.search.sources().items[0];
        if (!source) throw new Error('Missing persistent source');
        if (change === 'generation') {
          const generation = f.store.search.beginRebuild('fixture-chunks');
          expect(
            f.store.search.replaceChunks({
              generation,
              source: source.source,
              signature: 'fixture-chunks',
              chunks: [
                {
                  ordinal: 0,
                  start: 0,
                  end: source.text.length,
                  text: source.text,
                  tokens: documentTerms(source.text),
                },
              ],
            }),
          ).toBe(true);
          expect(f.store.search.activate(generation, f.store.search.watermark())).toBe(true);
        } else {
          const owner = f.store.auth.profileOwner();
          if (!owner || source.memoryId === null) throw new Error('Missing memory owner');
          new MemoryService(f.store.memory).update(owner.id, source.memoryId, {
            requestId: 'change-during-query',
            expectedRevision: 1,
            body: 'Database uses PostgreSQL',
            category: 'fact',
            enabled: true,
          });
        }
        const [result] = await observed;
        expect(result).toMatchObject({
          status: 'rejected',
          reason: { code: 'SEARCH_INDEX_CHANGED' },
        });
      } finally {
        f.store.search.vectors = actualVectors;
      }
    },
  );

  it('owns verifier preparation independently and cancels it before returning from close', async () => {
    const f = await fixture();
    const settlement = gate(f);
    let prepareSignal: AbortSignal | undefined;
    f.model.state.state = 'ready';
    f.verifier.onPrepare(async (signal) => {
      prepareSignal = signal;
      await settlement.promise;
      signal.throwIfAborted();
    });
    expect(f.service.prepareReranker().state).toBe('preparing');
    expect(f.service.modelStatus().state).toBe('ready');
    let closed = false;
    const closing = f.service.close();
    closing.then(
      () => {
        closed = true;
      },
      () => {
        closed = true;
      },
    );
    await nextTurn();
    expect(prepareSignal?.aborted).toBe(true);
    expect(closed).toBe(false);
    settlement.release();
    await closing;
    expect(closed).toBe(true);
    expect(f.diagnostics).toEqual([]);
  });

  it('aborts an in-flight embedding query and waits for its actual query settlement before closing', async () => {
    const f = await fixture();
    const inference = gate(f);
    f.model.state.state = 'ready';
    let requestSignal: AbortSignal | undefined;
    f.model.onEmbed(async (options) => {
      requestSignal = options.signal;
      await inference.promise;
      return [[1, 0]];
    });
    const request = f.service.search({ query: 'Database' }, new AbortController().signal);
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    const closing = f.service.close();
    expect(f.service.close()).toBe(closing);
    let settled = false;
    const observed = closing.then(() => {
      settled = true;
    });
    await nextTurn();
    expect(requestSignal?.aborted).toBe(true);
    expect(settled).toBe(false);
    inference.release();
    await rejected;
    await observed;
    f.serviceClosed = true;
    expect(f.store.search.status().sourceCount).toBe(1);
    expect(f.diagnostics).toEqual([]);
    const identity = vi.spyOn(f.store.auth, 'profileOwner').mockImplementation(() => {
      throw new Error('Closed search must not access profile resources');
    });
    await expect(
      f.service.search({ query: 'Database' }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'SEARCH_CLOSED' });
    expect(identity).not.toHaveBeenCalled();
    identity.mockRestore();
  });

  it('owns memory recall through the same query lifetime and refuses reads after closure', async () => {
    const f = await fixture();
    const inference = gate(f);
    f.model.state.state = 'ready';
    let requestSignal: AbortSignal | undefined;
    f.model.onEmbed(async (options) => {
      requestSignal = options.signal;
      await inference.promise;
      return [[1, 0]];
    });
    const owner = f.store.auth.profileOwner();
    if (!owner) throw new Error('Missing fixture owner');
    const domain = new MemoryService(f.store.memory);
    const readEntries = vi.spyOn(domain, 'entries');
    const retrieval = new MemoryRetrieval(domain, f.service, {
      status: f.verifier.port.status,
      rerank: () => Promise.resolve([]),
    });
    const access = { ownerUserId: owner.id, workspaceId: null, includeUser: true };
    const request = retrieval.search(access, 'Database', new AbortController().signal);
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    const closing = f.service.close();
    let settled = false;
    const observed = closing.then(() => {
      settled = true;
    });
    await nextTurn();
    expect(requestSignal?.aborted).toBe(true);
    expect(settled).toBe(false);
    inference.release();
    await rejected;
    await observed;
    f.serviceClosed = true;
    expect(readEntries).not.toHaveBeenCalled();
    await expect(
      retrieval.search(access, 'Database', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'SEARCH_CLOSED' });
    expect(readEntries).not.toHaveBeenCalled();
  });

  it('rejects an already computed lexical result if close begins before the service publishes it', async () => {
    const f = await fixture();
    const request = f.service.search({ query: 'Database' }, new AbortController().signal);
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await f.service.close();
    f.serviceClosed = true;
    await rejected;
    expect(f.diagnostics).toEqual([]);
  });

  it('keeps caller cancellation local and allows the service to handle another request', async () => {
    const f = await fixture();
    const inference = gate(f);
    f.model.state.state = 'ready';
    f.model.onEmbed(async () => {
      await inference.promise;
      return [[1, 0]];
    });
    const caller = new AbortController();
    const request = f.service.search({ query: 'Database' }, caller.signal);
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    caller.abort();
    inference.release();
    await rejected;
    f.model.state.state = 'unprepared';
    expect(
      (await f.service.search({ query: 'Database' }, new AbortController().signal)).hits,
    ).toHaveLength(1);
  });

  it('preserves a non-cancellation query failure when shutdown observes its rejected operation', async () => {
    const f = await fixture();
    const failure = new Error('Fixture retrieval failed');
    const fault = vi.spyOn(f.store.search, 'lexical').mockImplementation(() => {
      throw failure;
    });
    const request = f.service.search({ query: 'Database' }, new AbortController().signal);
    const rejected = expect(request).rejects.toBe(failure);
    const closing = f.service.close();
    await expect(closing).rejects.toMatchObject({ name: 'AggregateError', errors: [failure] });
    f.serviceClosed = true;
    await rejected;
    fault.mockRestore();
  });

  it('reports and propagates a real preparation failure even when cancellation was requested', async () => {
    const f = await fixture();
    const preparation = gate(f);
    const failure = new Error('Fixture model load failed');
    f.model.onPrepare(async () => await preparation.promise);
    f.service.prepare();
    const cancel = f.service.cancelPreparation();
    const rejected = expect(cancel).rejects.toBe(failure);
    preparation.fail(failure);
    await rejected;
    expect(f.diagnostics).toEqual([failure]);
  });

  it('suppresses only a genuine aborted preparation and leaves no background preparation owner', async () => {
    const f = await fixture();
    f.model.onPrepare(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              f.model.state.state = 'unprepared';
              reject(new DOMException('Fixture cancellation', 'AbortError'));
            },
            { once: true },
          );
        }),
    );
    f.service.prepare();
    expect((await f.service.cancelPreparation()).state).toBe('unprepared');
    await f.service.close();
    f.serviceClosed = true;
    expect(f.diagnostics).toEqual([]);
  });
});
