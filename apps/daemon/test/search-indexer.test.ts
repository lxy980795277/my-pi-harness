import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as turn } from 'node:timers/promises';
import { MemoryService } from '@my-pi-harness/memory';
import type { MemoryEntry, SearchModelStatus } from '@my-pi-harness/protocol';
import { openProfileStore, type ProfileStore } from '@my-pi-harness/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchIndexer } from '../src/search/indexer';
import type { EmbeddingRequestOptions } from '../src/search/local-model-resource';
import { queryTerms } from '../src/search/text';

interface Fixture {
  directory: string;
  store: ProfileStore;
  memory: MemoryService;
  owner: string;
}

interface Gate {
  promise: Promise<void>;
  release(): void;
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

function gate(): Gate {
  let release = (): void => {
    throw new Error('Uninitialized gate');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function fixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'search-indexer-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = await openProfileStore(directory);
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  store.auth.createLocalClient({
    id: 'client',
    tokenHash: hash('client-token'),
    csrfToken: 'csrf',
    createdAt: 1,
    expiresAt: 100,
  });
  const login = store.auth.completeLogin(
    {
      providerId: 'github',
      issuer: 'https://github.com',
      subject: 'indexer-owner',
      name: 'Indexer test',
      avatarUrl: null,
    },
    'client',
    { id: 'login', tokenHash: hash('login-token'), createdAt: 2, expiresAt: 99 },
  );
  const value = { directory, store, memory: new MemoryService(store.memory), owner: login.user.id };
  cleanups.push(() => {
    value.store.close();
    return Promise.resolve();
  });
  return value;
}

function remember(f: Fixture, id: string, body: string): MemoryEntry {
  const entry = f.memory.create(f.owner, {
    requestId: id,
    scope: { kind: 'user' },
    category: 'fact',
    body,
    enabled: true,
  }).entry;
  if (!entry) throw new Error('Missing confirmed fact');
  return entry;
}

function embedding() {
  const calls: string[] = [];
  const counted: string[] = [];
  const status: SearchModelStatus = {
    state: 'ready',
    modelId: 'fixture',
    revision: 'fixed',
    signature: 'fixture-unit-v1',
    dimensions: 2,
    maxInputTokens: 512,
    progress: null,
    error: null,
  };
  let respond:
    | ((
        texts: readonly string[],
        options: EmbeddingRequestOptions,
      ) => Promise<readonly (readonly number[])[]>)
    | undefined;
  return {
    calls,
    counted,
    status,
    respond(value: NonNullable<typeof respond>) {
      respond = value;
    },
    port: {
      status: () => ({ ...status }),
      tokenCounts: (texts: readonly string[], options: EmbeddingRequestOptions) => {
        options.signal.throwIfAborted();
        counted.push(...texts);
        return Promise.resolve(texts.map((text) => text.length + 11));
      },
      embed: async (texts: readonly string[], options: EmbeddingRequestOptions) => {
        calls.push(...texts);
        if (respond) return await respond(texts, options);
        return texts.map(() => [1, 0]);
      },
    },
  };
}

function index(
  f: Fixture,
  model: ReturnType<typeof embedding>,
  errors: unknown[] = [],
): SearchIndexer {
  const indexer = new SearchIndexer({
    store: f.store,
    embedding: model.port,
    onError: (error) => errors.push(error),
  });
  cleanups.push(() => indexer.close());
  indexer.start();
  return indexer;
}

async function ready(f: Fixture, model: ReturnType<typeof embedding>): Promise<void> {
  await vi.waitFor(() => expect(f.store.search.status(model.status.signature).state).toBe('ready'));
  await turn();
}

describe('durable background search indexing', () => {
  it('rechecks unchanged index health without recomputing UI statistics or embeddings', async () => {
    const f = await fixture();
    const model = embedding();
    const errors: unknown[] = [];
    remember(f, 'steady', 'Stable indexed fact');
    const running = index(f, model, errors);
    await ready(f, model);
    const calls = model.calls.length;
    const statistics = vi.spyOn(f.store.search, 'status').mockImplementation(() => {
      throw new Error('An unchanged background poll must not compute UI counts');
    });
    const readiness = vi.spyOn(f.store.search, 'queryReadiness');
    try {
      running.wake();
      await vi.waitFor(() => expect(readiness).toHaveBeenCalledWith(model.status.signature));
      await turn();
      expect(statistics).not.toHaveBeenCalled();
      expect(model.calls).toHaveLength(calls);
      expect(errors).toEqual([]);
    } finally {
      statistics.mockRestore();
      readiness.mockRestore();
    }
  });

  it('switches lexical to semantic generations and reuses every valid vector on rebuild and restart', async () => {
    const f = await fixture();
    const model = embedding();
    model.status.state = 'unprepared';
    remember(f, 'first', '简洁中文回答 GitHub authorizations');
    const running = index(f, model);
    await ready(f, model);
    const lexical = f.store.search.status(model.status.signature);
    expect(lexical.lexicalReady).toBe(true);
    expect(lexical.vectorCount).toBe(0);
    expect(model.calls).toEqual([]);
    expect(
      f.store.search.lexical({ ownerUserId: f.owner, scope: {} }, { tokens: queryTerms('中文') }),
    ).toHaveLength(1);
    model.status.state = 'ready';
    running.wake();
    await vi.waitFor(() =>
      expect(f.store.search.status(model.status.signature).vectorCount).toBe(1),
    );
    await ready(f, model);
    const semantic = f.store.search.status(model.status.signature);
    expect(semantic.generation).toBeGreaterThan(lexical.generation);
    expect(model.calls).toHaveLength(1);
    running.rebuild();
    await vi.waitFor(() =>
      expect(f.store.search.status().generation).toBeGreaterThan(semantic.generation),
    );
    await ready(f, model);
    expect(model.calls).toHaveLength(1);
    await running.close();
    f.store.close();
    f.store = await openProfileStore(f.directory);
    f.memory = new MemoryService(f.store.memory);
    const restored = index(f, model);
    await ready(f, model);
    expect(model.calls).toHaveLength(1);
    expect(model.counted).toHaveLength(1);
    await restored.close();
  });

  it('keeps semantic vectors through preparation and temporary model unavailability while indexing new lexical facts', async () => {
    const f = await fixture();
    const model = embedding();
    remember(f, 'cached', 'Existing cached reference');
    const running = index(f, model);
    await ready(f, model);
    const originalGeneration = f.store.search.status().generation;
    expect(model.calls).toHaveLength(1);
    model.status.state = 'preparing';
    running.wake();
    await turn();
    expect(f.store.search.status().generation).toBe(originalGeneration);
    model.status.state = 'ready';
    running.wake();
    await ready(f, model);
    expect(model.calls).toHaveLength(1);
    model.status.state = 'unavailable';
    remember(f, 'offline-new', 'New lexical reference while the model is unavailable');
    running.wake();
    await vi.waitFor(() =>
      expect(f.store.search.status().generation).toBeGreaterThan(originalGeneration),
    );
    await ready(f, model);
    expect(
      f.store.search.lexical(
        { ownerUserId: f.owner, scope: {} },
        { tokens: queryTerms('lexical') },
      ),
    ).toHaveLength(1);
    expect(model.calls).toHaveLength(1);
    model.status.state = 'ready';
    running.wake();
    await vi.waitFor(() =>
      expect(f.store.search.status(model.status.signature).vectorCount).toBe(2),
    );
    await ready(f, model);
    expect(model.calls).toHaveLength(2);
    expect(model.calls.filter((text) => text === 'Existing cached reference')).toHaveLength(1);
  });

  it('indexes only the edited source, and late results cannot resurrect forgotten text', async () => {
    const f = await fixture();
    const model = embedding();
    const original = remember(f, 'original', 'Original source');
    remember(f, 'unchanged', 'Unchanged source');
    const running = index(f, model);
    await ready(f, model);
    expect(model.calls).toHaveLength(2);
    f.memory.update(f.owner, original.id, {
      requestId: 'edited',
      expectedRevision: 1,
      category: 'fact',
      body: 'Corrected source',
      enabled: true,
    });
    running.wake();
    await vi.waitFor(() => expect(model.calls).toContain('Corrected source'));
    await ready(f, model);
    expect(model.calls.filter((text) => text === 'Unchanged source')).toHaveLength(1);
    const blocked = gate();
    const entered = gate();
    model.respond(async (texts) => {
      entered.release();
      await blocked.promise;
      return texts.map(() => [1, 0]);
    });
    const pending = remember(f, 'forgotten', 'Forget during native inference');
    running.wake();
    await entered.promise;
    f.memory.forget(f.owner, pending.id, { requestId: 'forget', expectedRevision: 1 });
    blocked.release();
    await ready(f, model);
    expect(
      f.store.search.lexical({ ownerUserId: f.owner, scope: {} }, { tokens: queryTerms('Forget') }),
    ).toEqual([]);
    expect(f.store.search.status(model.status.signature).vectorCount).toBe(2);
  });

  it('does not write a cancelled late batch and resumes only missing vectors after restart', async () => {
    const f = await fixture();
    const model = embedding();
    remember(
      f,
      'long',
      Array.from(
        { length: 140 },
        (_, index) => `Record ${index}: unique persistent source paragraph.\n`,
      ).join(''),
    );
    const blocked = gate();
    const entered = gate();
    let batches = 0;
    model.respond(async (texts) => {
      batches += 1;
      if (batches === 2) {
        entered.release();
        await blocked.promise;
      }
      return texts.map(() => [1, 0]);
    });
    const running = index(f, model);
    await entered.promise;
    const firstChunks = model.calls.slice(0, 4);
    const closing = running.close();
    blocked.release();
    await closing;
    expect(f.store.search.status(model.status.signature).vectorCount).toBe(4);
    const before = model.calls.length;
    await turn();
    f.store.close();
    f.store = await openProfileStore(f.directory);
    const restored = index(f, model);
    await ready(f, model);
    const newlyEmbedded = model.calls.slice(before);
    expect(newlyEmbedded).not.toContain(firstChunks[0]);
    const status = f.store.search.status(model.status.signature);
    expect(status.vectorCount).toBe(status.chunkCount);
    await restored.close();
  });

  it('replaces an active pass once for repeated rebuild requests and refuses its late publication', async () => {
    const f = await fixture();
    const model = embedding();
    remember(f, 'rebuild', 'Rebuild while native work is pending');
    const entered = gate();
    const blocked = gate();
    let batches = 0;
    model.respond(async (texts) => {
      batches += 1;
      if (batches === 1) {
        entered.release();
        await blocked.promise;
      }
      return texts.map(() => [1, 0]);
    });
    const running = index(f, model);
    await entered.promise;
    const previousGeneration = f.store.search.status().generation;
    running.rebuild();
    running.rebuild();
    blocked.release();
    await vi.waitFor(() =>
      expect(f.store.search.status().generation).toBeGreaterThan(previousGeneration),
    );
    await ready(f, model);
    expect(f.store.search.status(model.status.signature).vectorCount).toBe(1);
    expect(batches).toBe(2);
  });

  it('propagates a non-cancellation failure during shutdown instead of swallowing it', async () => {
    const f = await fixture();
    const model = embedding();
    remember(f, 'failure', 'Persistent source');
    const entered = gate();
    const blocked = gate();
    const failure = new Error('Unexpected inference failure');
    model.respond(async () => {
      entered.release();
      await blocked.promise;
      throw failure;
    });
    const errors: unknown[] = [];
    const running = index(f, model, errors);
    await entered.promise;
    const closing = running.close();
    const rejected = expect(closing).rejects.toBe(failure);
    blocked.release();
    await rejected;
    expect(errors).toContain(failure);
  });
});
