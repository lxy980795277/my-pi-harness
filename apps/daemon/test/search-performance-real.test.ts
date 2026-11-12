import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as wait } from 'node:timers/promises';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import { MemoryService } from '@my-pi-harness/memory';
import type { SearchIndexStatus } from '@my-pi-harness/protocol';
import type { SearchAccess } from '@my-pi-harness/protocol/internal';
import { openProfileStore, type ProfileStore } from '@my-pi-harness/storage';
import { describe, expect, it } from 'vitest';
import { SearchIndexer } from '../src/search/indexer';
import {
  LocalSearchModelResource,
  type LocalEmbeddingView,
} from '../src/search/local-model-resource';
import { PersistentSearchQuery, type SearchQueryOutcome } from '../src/search/query';
import {
  SEARCH_PERFORMANCE_MEMORY_COUNT,
  SEARCH_PERFORMANCE_MESSAGE_COUNT,
  SEARCH_PERFORMANCE_WORKSPACES,
  searchPerformanceCorpus,
  searchPerformanceQueries,
  type SearchPerformanceSource,
} from './fixtures/search-performance';

interface Measurement {
  sourceId: string;
  durationMs: number;
  retries: number;
  scannedVectors: number;
  vectorPages: number;
  truncated: boolean;
}

interface ScanCounts {
  vectors: number;
  pages: number;
}

interface EmbeddingCounts {
  passages: number;
  tokenInputs: number;
  queries: number;
}

const CACHE_DIRECTORY = process.env.MY_PI_HARNESS_TEST_SEARCH_PERFORMANCE_CACHE;
const DEADLINE_MS = 15 * 60_000;
const SOURCE_COUNT = SEARCH_PERFORMANCE_MESSAGE_COUNT + SEARCH_PERFORMANCE_MEMORY_COUNT;
const EXPECTED_CHUNKS = SEARCH_PERFORMANCE_MESSAGE_COUNT * 10 + SEARCH_PERFORMANCE_MEMORY_COUNT;

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function reportPhase(phase: string, counts: Record<string, number>): void {
  process.stdout.write(`M6_SEARCH_PERFORMANCE_PHASE ${JSON.stringify({ phase, ...counts })}\n`);
}

function authenticate(store: ProfileStore): string {
  const at = Date.now();
  store.auth.createLocalClient({
    id: 'performance-client',
    tokenHash: hash('synthetic-performance-client'),
    csrfToken: 'synthetic-performance-csrf',
    createdAt: at,
    expiresAt: at + DEADLINE_MS,
  });
  return store.auth.completeLogin(
    {
      providerId: 'github',
      issuer: 'https://github.com',
      subject: 'synthetic-performance-owner',
      name: 'Local search performance fixture',
      avatarUrl: null,
    },
    'performance-client',
    {
      id: 'performance-login',
      tokenHash: hash('synthetic-performance-login'),
      createdAt: at + 1,
      expiresAt: at + DEADLINE_MS,
    },
  ).user.id;
}

async function seed(
  store: ProfileStore,
  owner: string,
  directory: string,
  sources: readonly SearchPerformanceSource[],
): Promise<void> {
  for (const workspaceId of SEARCH_PERFORMANCE_WORKSPACES) {
    const rootPath = join(directory, workspaceId);
    await mkdir(rootPath, { recursive: true });
    store.createWorkspace({
      id: workspaceId,
      name: workspaceId,
      icon: 'folder',
      rootPath,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const sessionId = `session-${workspaceId}`;
    const branchId = `branch-${workspaceId}`;
    store.createSession({
      id: sessionId,
      branchId,
      title: 'Persisted local performance corpus',
      providerId: 'synthetic-unused-provider',
      modelId: 'unused',
      thinkingLevel: 'off',
      workspaceId,
      approvalMode: 'ask',
      at: 1,
    });
    const messages = sources.filter(
      (source) => source.kind === 'message' && source.workspaceId === workspaceId,
    );
    for (let offset = 0; offset < messages.length; offset += 20)
      store.append(
        sessionId,
        messages.slice(offset, offset + 20).map((source, index) => ({
          type: 'message.started' as const,
          runId: null,
          at: offset + index + 2,
          data: {
            id: source.id.slice('message:'.length),
            sessionId,
            branchId,
            runId: null,
            role: 'user' as const,
            text: source.text,
            thinking: '',
            createdAt: offset + index + 2,
            status: 'complete' as const,
            stopReason: null,
          },
        })),
      );
  }
  for (const source of sources.filter((source) => source.kind === 'memory'))
    store.memory.create(owner, {
      requestId: `create-${source.id}`,
      fingerprint: hash(source.text),
      entry: {
        id: source.id.slice('memory:'.length),
        scope: { kind: 'user' },
        category: 'fact',
        mode: 'relevant',
        body: source.text,
        revision: 1,
        enabled: true,
        source: { kind: 'manual' },
        createdAt: 2,
        updatedAt: 2,
      },
    });
}

function observeEmbedding(view: LocalEmbeddingView, counts: EmbeddingCounts): LocalEmbeddingView {
  return {
    status: () => view.status(),
    prepare: () => Promise.reject(new Error('Performance acceptance must not prepare or download')),
    tokenCounts: (texts, options) => {
      counts.tokenInputs += texts.length;
      return view.tokenCounts(texts, options);
    },
    embed: (texts, options) => {
      if (options.kind === 'passage') counts.passages += texts.length;
      else counts.queries += texts.length;
      return view.embed(texts, options);
    },
  };
}

async function ready(
  store: ProfileStore,
  embedding: LocalEmbeddingView,
  errors: readonly unknown[],
  signal: AbortSignal,
  minimumGeneration = 1,
): Promise<SearchIndexStatus> {
  let reportedAt = performance.now();
  for (;;) {
    signal.throwIfAborted();
    if (errors.length) throw new AggregateError(errors, 'Real performance indexer failed');
    const status = store.search.status(embedding.status().signature);
    if (status.state === 'failed') throw new Error(status.error ?? 'Real index failed');
    if (performance.now() - reportedAt >= 30_000) {
      process.stdout.write(`M6_SEARCH_PERFORMANCE_INDEX_PROGRESS ${JSON.stringify(status)}\n`);
      reportedAt = performance.now();
    }
    if (
      status.state === 'ready' &&
      status.lexicalReady &&
      status.pendingSources === 0 &&
      status.sourceCount === SOURCE_COUNT &&
      status.vectorCount === status.chunkCount &&
      status.chunkCount >= EXPECTED_CHUNKS &&
      status.buildingGeneration === null &&
      status.generation >= minimumGeneration
    )
      return status;
    await wait(250, undefined, { signal });
  }
}

/** Count the full latency including at most three explicit retries of the known generation-change error. */
async function measure(
  query: PersistentSearchQuery,
  access: SearchAccess,
  source: SearchPerformanceSource,
  scan: ScanCounts,
  signal: AbortSignal,
): Promise<{ sample: Measurement; outcome: SearchQueryOutcome }> {
  const started = performance.now();
  const before = { ...scan };
  let retries = 0;
  for (;;) {
    try {
      const outcome = await query.run(access, { query: source.identifier, limit: 5 }, signal);
      expect(
        outcome.result.hits.map((hit) => hit.source.id),
        `Exact identifier ${source.identifier}`,
      ).toContain(source.id);
      return {
        outcome,
        sample: {
          sourceId: source.id,
          durationMs: performance.now() - started,
          retries,
          scannedVectors: scan.vectors - before.vectors,
          vectorPages: scan.pages - before.pages,
          truncated: outcome.result.truncated,
        },
      };
    } catch (error) {
      signal.throwIfAborted();
      if (
        !(error instanceof RuntimeError) ||
        error.code !== 'SEARCH_INDEX_CHANGED' ||
        retries === 3
      )
        throw error;
      retries += 1;
    }
  }
}

function summarize(samples: readonly Measurement[]) {
  const sorted = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  if (p95 === undefined) throw new Error('Performance measurement has no samples');
  return {
    queries: samples.length,
    p95Ms: Number(p95.toFixed(2)),
    maximumMs: Number((sorted.at(-1) ?? 0).toFixed(2)),
    totalMs: Math.round(samples.reduce((sum, sample) => sum + sample.durationMs, 0)),
    retries: samples.reduce((sum, sample) => sum + sample.retries, 0),
    scannedVectors: samples.reduce((sum, sample) => sum + sample.scannedVectors, 0),
    truncatedQueries: samples.filter((sample) => sample.truncated).length,
    exactSourceTop5: samples.length,
    samples,
  };
}

async function cleanup(
  indexer: SearchIndexer | undefined,
  resource: LocalSearchModelResource | undefined,
  store: ProfileStore | undefined,
  directory: string,
): Promise<void> {
  const errors: unknown[] = [];
  for (const close of [
    () => indexer?.close(),
    () => resource?.close(),
    () => store?.close(),
    () => rm(directory, { recursive: true, force: true }),
  ]) {
    try {
      await close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Real performance cleanup failed');
}

describe('explicit local search performance acceptance', () => {
  it.skipIf(CACHE_DIRECTORY === undefined)(
    'indexes the complete 1400-source corpus and reports real query latency without downloads',
    async () => {
      if (CACHE_DIRECTORY === undefined || !isAbsolute(CACHE_DIRECTORY))
        throw new Error(
          'MY_PI_HARNESS_TEST_SEARCH_PERFORMANCE_CACHE must be an absolute existing cache',
        );
      if (!(await stat(CACHE_DIRECTORY)).isDirectory())
        throw new Error('Model cache is not a directory');
      const directory = await mkdtemp(join(tmpdir(), 'my-pi-search-performance-'));
      const controller = new AbortController();
      const deadline = setTimeout(
        () =>
          controller.abort(
            new DOMException('Performance acceptance deadline exceeded', 'AbortError'),
          ),
        DEADLINE_MS,
      );
      let store: ProfileStore | undefined;
      let resource: LocalSearchModelResource | undefined;
      let indexer: SearchIndexer | undefined;
      let restoreVectorObservation = (): void => undefined;
      let restoreIndexObservation = (): void => undefined;
      const wallStarted = performance.now();
      const cpuStarted = process.cpuUsage();
      try {
        const corpus = searchPerformanceCorpus();
        const queries = searchPerformanceQueries(corpus);
        expect(corpus.filter((source) => source.kind === 'message')).toHaveLength(1000);
        expect(queries).toHaveLength(30);
        expect(corpus.every((source) => !source.text.includes('\n'))).toBe(true);
        expect(
          corpus
            .filter((source) => source.kind === 'message')
            .every((source) => source.text.length === 4800),
        ).toBe(true);
        store = await openProfileStore(directory);
        const owner = authenticate(store);
        const seedingStarted = performance.now();
        await seed(store, owner, directory, corpus);
        const seedMs = performance.now() - seedingStarted;
        const memories = new MemoryService(store.memory).snapshot({
          ownerUserId: owner,
          workspaceId: SEARCH_PERFORMANCE_WORKSPACES[0],
          includeUser: true,
        });
        expect(memories.candidates).toHaveLength(400);
        expect(
          memories.candidates.every((entry) => entry.enabled && entry.mode === 'relevant'),
        ).toBe(true);
        reportPhase('seed-ready', { durationMs: Math.round(seedMs), sources: corpus.length });
        resource = new LocalSearchModelResource({ cacheDirectory: CACHE_DIRECTORY });
        expect(resource.embedding.status().state, 'Incomplete cache must never download').toBe(
          'ready',
        );
        expect(resource.reranker.status().state, 'Verifier cache was prepared explicitly').toBe(
          'ready',
        );
        const counts: EmbeddingCounts = { passages: 0, tokenInputs: 0, queries: 0 };
        const embedding = observeEmbedding(resource.embedding, counts);
        const loadingStarted = performance.now();
        const tokenCounts = await embedding.tokenCounts(['Cold worker existing disk cache probe'], {
          kind: 'query',
          priority: 'foreground',
          signal: controller.signal,
        });
        expect(tokenCounts[0]).toBeGreaterThan(0);
        const tokenizerLoadedAt = performance.now();
        const coldVectors = await embedding.embed(['Cold worker existing disk cache probe'], {
          kind: 'query',
          priority: 'foreground',
          signal: controller.signal,
        });
        const loadedAt = performance.now();
        expect(coldVectors[0]).toHaveLength(384);
        expect(Math.hypot(...(coldVectors[0] ?? []))).toBeCloseTo(1, 4);
        reportPhase('cold-worker-ready', { durationMs: Math.round(loadedAt - loadingStarted) });
        const errors: unknown[] = [];
        indexer = new SearchIndexer({ store, embedding, onError: (error) => errors.push(error) });
        const indexingStarted = performance.now();
        indexer.start();
        const indexed = await ready(store, embedding, errors, controller.signal);
        const indexMs = performance.now() - indexingStarted;
        expect(indexed.chunkCount).toBeGreaterThanOrEqual(EXPECTED_CHUNKS);
        expect(indexed.chunkCount).toBeLessThan(20_000);
        expect(counts.passages).toBe(indexed.chunkCount);
        reportPhase('index-ready', {
          durationMs: Math.round(indexMs),
          chunks: indexed.chunkCount,
          vectors: indexed.vectorCount,
        });
        const scans: ScanCounts = { vectors: 0, pages: 0 };
        const actualVectors = store.search.vectors.bind(store.search);
        store.search.vectors = (access, input) => {
          const page = actualVectors(access, input);
          scans.pages += 1;
          scans.vectors += page.items.length;
          return page;
        };
        const observedRepository = store.search;
        restoreVectorObservation = () => {
          observedRepository.vectors = actualVectors;
        };
        const hybrid = new PersistentSearchQuery({ repository: store.search, embedding });
        const lexical = new PersistentSearchQuery({
          repository: store.search,
          embedding: {
            status: () => ({ ...embedding.status(), state: 'unprepared' }),
            embed: () => Promise.reject(new Error('Lexical measurement must not infer embeddings')),
          },
        });
        const access: SearchAccess = {
          ownerUserId: owner,
          scope: { allWorkspaces: true, includeUserMemories: true },
        };
        const firstQuery = queries[0];
        if (firstQuery === undefined) throw new Error('Missing warm-up query');
        await measure(lexical, access, firstQuery, scans, controller.signal);
        await measure(hybrid, access, firstQuery, scans, controller.signal);
        const lexicalSamples: Measurement[] = [];
        const hybridSamples: Measurement[] = [];
        for (const source of queries) {
          const measured = await measure(lexical, access, source, scans, controller.signal);
          expect(measured.outcome.result.mode).toBe('lexical');
          expect(measured.sample.scannedVectors).toBe(0);
          lexicalSamples.push(measured.sample);
        }
        reportPhase('lexical-ready', { p95Ms: summarize(lexicalSamples).p95Ms });
        for (const source of queries) {
          const measured = await measure(hybrid, access, source, scans, controller.signal);
          expect(measured.outcome.result.mode).toBe('hybrid');
          expect(measured.sample.scannedVectors).toBe(indexed.chunkCount);
          hybridSamples.push(measured.sample);
        }
        reportPhase('hybrid-ready', { p95Ms: summarize(hybridSamples).p95Ms });
        const byId = new Map(corpus.map((source) => [source.id, source]));
        let scopeChecks = 0;
        for (const workspaceId of SEARCH_PERFORMANCE_WORKSPACES) {
          const forbidden = corpus.find(
            (source) => source.kind === 'message' && source.workspaceId !== workspaceId,
          );
          if (forbidden === undefined) throw new Error('Missing cross-workspace negative');
          const allowed = corpus.find(
            (source) => source.kind === 'message' && source.workspaceId === workspaceId,
          );
          if (allowed === undefined) throw new Error('Missing in-scope positive');
          for (const selected of [allowed, forbidden]) {
            const scoped = await hybrid.run(
              { ownerUserId: owner, scope: { workspaceId, includeUserMemories: false } },
              { query: selected.identifier, limit: 20 },
              controller.signal,
            );
            if (selected === allowed)
              expect(scoped.result.hits.map((hit) => hit.source.id)).toContain(allowed.id);
            for (const chunk of [...scoped.lexical, ...scoped.semantic, ...scoped.ranked]) {
              expect(byId.get(chunk.source.id)?.workspaceId).toBe(workspaceId);
              expect(chunk.source.id).not.toBe(forbidden.id);
              scopeChecks += 1;
            }
          }
        }
        const passagesBeforeRebuild = counts.passages;
        const rebuildStarted = performance.now();
        indexer.rebuild();
        let rebuildingQueries = 0;
        const rebuildSamples: Measurement[] = [];
        for (const source of queries) {
          if (store.search.status().buildingGeneration !== null) rebuildingQueries += 1;
          rebuildSamples.push(
            (await measure(hybrid, access, source, scans, controller.signal)).sample,
          );
        }
        const rebuilt = await ready(
          store,
          embedding,
          errors,
          controller.signal,
          indexed.generation + 1,
        );
        const rebuildMs = performance.now() - rebuildStarted;
        expect(rebuildingQueries).toBeGreaterThan(0);
        expect(counts.passages).toBe(passagesBeforeRebuild);
        expect(rebuilt.chunkCount).toBe(indexed.chunkCount);
        reportPhase('rebuild-ready', {
          durationMs: Math.round(rebuildMs),
          newPassageEmbeddings: counts.passages - passagesBeforeRebuild,
        });
        restoreVectorObservation();
        await indexer.close();
        indexer = undefined;
        await resource.close();
        resource = undefined;
        store.close();
        store = undefined;
        const reopenStarted = performance.now();
        store = await openProfileStore(directory);
        resource = new LocalSearchModelResource({ cacheDirectory: CACHE_DIRECTORY });
        expect(resource.embedding.status().state).toBe('ready');
        const reopenedCounts: EmbeddingCounts = { passages: 0, tokenInputs: 0, queries: 0 };
        const reopenedEmbedding = observeEmbedding(resource.embedding, reopenedCounts);
        const reopenErrors: unknown[] = [];
        const inspectedSources = new Set<string>();
        const actualIndexed = store.search.indexed.bind(store.search);
        store.search.indexed = (...args) => {
          const indexed = actualIndexed(...args);
          inspectedSources.add(args[0].id);
          return indexed;
        };
        const reopenedRepository = store.search;
        restoreIndexObservation = () => {
          reopenedRepository.indexed = actualIndexed;
        };
        indexer = new SearchIndexer({
          store,
          embedding: reopenedEmbedding,
          onError: (error) => reopenErrors.push(error),
        });
        indexer.start();
        while (inspectedSources.size < SOURCE_COUNT) {
          controller.signal.throwIfAborted();
          if (reopenErrors.length)
            throw new AggregateError(reopenErrors, 'Reopened indexing failed');
          await wait(50, undefined, { signal: controller.signal });
        }
        const reopened = await ready(
          store,
          reopenedEmbedding,
          reopenErrors,
          controller.signal,
          rebuilt.generation,
        );
        restoreIndexObservation();
        expect(reopened.generation).toBe(rebuilt.generation);
        expect(reopened.vectorCount).toBe(rebuilt.vectorCount);
        expect(reopenedCounts.passages).toBe(0);
        expect(reopenedCounts.tokenInputs).toBe(0);
        const reopenMs = performance.now() - reopenStarted;
        reportPhase('reopen-ready', {
          durationMs: Math.round(reopenMs),
          inspectedSources: inspectedSources.size,
          passageEmbeddings: reopenedCounts.passages,
        });
        const reopenedQueryStarted = performance.now();
        const reopenedResult = await new PersistentSearchQuery({
          repository: store.search,
          embedding: reopenedEmbedding,
        }).run(access, { query: firstQuery.identifier, limit: 5 }, controller.signal);
        const reopenedQueryMs = performance.now() - reopenedQueryStarted;
        expect(reopenedResult.result.hits.map((hit) => hit.source.id)).toContain(firstQuery.id);
        expect(reopenedResult.result.mode).toBe('hybrid');
        const lexicalSummary = summarize(lexicalSamples);
        const hybridSummary = summarize(hybridSamples);
        const cpu = process.cpuUsage(cpuStarted);
        const report = {
          host: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            cpu: cpus()[0]?.model ?? 'unknown',
            cores: cpus().length,
          },
          model: embedding.status(),
          cache:
            'existing disk files; no prepare or download; OS filesystem caches are not flushed',
          corpus: {
            sources: indexed.sourceCount,
            messages: 1000,
            messageUtf16Length: 4800,
            relevantMemories: memories.candidates.length,
            chunks: indexed.chunkCount,
            vectors: indexed.vectorCount,
          },
          timingsMs: {
            seed: Math.round(seedMs),
            workerAndTokenizer: Math.round(tokenizerLoadedAt - loadingStarted),
            firstEmbedding: Math.round(loadedAt - tokenizerLoadedAt),
            coldWorkerExistingDiskCache: Math.round(loadedAt - loadingStarted),
            index: Math.round(indexMs),
            rebuildWithConcurrentQueries: Math.round(rebuildMs),
            reopenIndex: Math.round(reopenMs),
            reopenedFirstHybridQuery: Math.round(reopenedQueryMs),
            totalWall: Math.round(performance.now() - wallStarted),
            cpuUser: Math.round(cpu.user / 1000),
            cpuSystem: Math.round(cpu.system / 1000),
          },
          lexical: lexicalSummary,
          warmHybrid: hybridSummary,
          backgroundRebuild: {
            ...summarize(rebuildSamples),
            queriesWhileBuilding: rebuildingQueries,
            generation: rebuilt.generation,
            newPassageEmbeddings: counts.passages - passagesBeforeRebuild,
          },
          reopen: {
            generation: reopened.generation,
            vectors: reopened.vectorCount,
            inspectedSources: inspectedSources.size,
            ...reopenedCounts,
          },
          scope: { checkedCandidates: scopeChecks, violations: 0 },
        };
        process.stdout.write(`M6_SEARCH_PERFORMANCE ${JSON.stringify(report)}\n`);
        expect(lexicalSummary.p95Ms, 'Real 1400-source lexical P95 target').toBeLessThanOrEqual(
          300,
        );
        expect(hybridSummary.p95Ms, 'Real full-vector-scan hybrid P95 target').toBeLessThanOrEqual(
          1500,
        );
      } finally {
        clearTimeout(deadline);
        controller.abort();
        restoreVectorObservation();
        restoreIndexObservation();
        await cleanup(indexer, resource, store, directory);
      }
    },
    DEADLINE_MS + 60_000,
  );
});
