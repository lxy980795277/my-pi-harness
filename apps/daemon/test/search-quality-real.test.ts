import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as wait } from 'node:timers/promises';
import { openProfileStore, type ProfileStore } from '@my-pi-harness/storage';
import { describe, expect, it } from 'vitest';
import { MemoryService } from '@my-pi-harness/memory';
import { MemoryRetrieval } from '../src/memory/retrieval';
import { SearchIndexer } from '../src/search/indexer';
import {
  LocalSearchModelResource,
  type LocalEmbeddingView,
} from '../src/search/local-model-resource';
import { PersistentSearchQuery } from '../src/search/query';
import type { RankedSearchChunk } from '../src/search/ranking';
import {
  SEARCH_QUALITY_CASES,
  SEARCH_QUALITY_SOURCES,
  SEARCH_QUALITY_WORKSPACES,
  type SearchQualityCase,
  type SearchQualitySource,
} from './fixtures/search-quality';

type QualityEngine = 'lexical' | 'semantic' | 'fused';

interface QualityMeasurement {
  test: SearchQualityCase;
  rankings: Record<QualityEngine, string[]>;
  semanticTopScore: number | null;
}

interface QualityMetric {
  recallAt5: number;
  mrr: number;
}

interface QualitySummary {
  positiveQueries: number;
  negativeQueries: number;
  lexical: QualityMetric;
  semantic: QualityMetric;
  fused: QualityMetric;
  negativesWithCandidates: Record<QualityEngine, number>;
}

const CACHE_DIRECTORY = process.env.MY_PI_HARNESS_TEST_EMBEDDING_CACHE;
const ENGINES: readonly QualityEngine[] = ['lexical', 'semantic', 'fused'];
const DEADLINE_MS = 110_000;

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function authenticate(store: ProfileStore): string {
  const at = Date.now();
  store.auth.createLocalClient({
    id: 'quality-client',
    tokenHash: hash('synthetic-quality-client'),
    csrfToken: 'synthetic-quality-csrf',
    createdAt: at,
    expiresAt: at + 120_000,
  });
  return store.auth.completeLogin(
    {
      providerId: 'github',
      issuer: 'https://github.com',
      subject: 'synthetic-quality-owner',
      name: 'Search quality fixture',
      avatarUrl: null,
    },
    'quality-client',
    {
      id: 'quality-login',
      tokenHash: hash('synthetic-quality-login'),
      createdAt: at + 1,
      expiresAt: at + 120_000,
    },
  ).user.id;
}

async function seed(store: ProfileStore, owner: string, directory: string): Promise<void> {
  for (const workspaceId of Object.values(SEARCH_QUALITY_WORKSPACES)) {
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
    store.createSession({
      id: `session-${workspaceId}`,
      branchId: `branch-${workspaceId}`,
      title: 'Original search quality fixture',
      providerId: 'synthetic-quality-provider',
      modelId: 'unused',
      thinkingLevel: 'off',
      workspaceId,
      approvalMode: 'ask',
      at: 1,
    });
  }
  for (const [index, source] of SEARCH_QUALITY_SOURCES.entries()) {
    const id = source.id.slice(source.kind.length + 1);
    const at = index + 2;
    if (source.kind === 'memory') {
      store.memory.create(owner, {
        requestId: `create-${id}`,
        fingerprint: hash(JSON.stringify(source)),
        entry: {
          id,
          scope: source.scope,
          category: 'fact',
          mode: 'relevant',
          body: source.text,
          revision: 1,
          enabled: true,
          source: { kind: 'manual' },
          createdAt: at,
          updatedAt: at,
        },
      });
    } else {
      if (source.scope.kind !== 'workspace')
        throw new Error('Message fixture requires a workspace');
      const sessionId = `session-${source.scope.workspaceId}`;
      store.append(sessionId, [
        {
          type: 'message.started',
          runId: null,
          at,
          data: {
            id,
            sessionId,
            branchId: `branch-${source.scope.workspaceId}`,
            runId: null,
            role: 'user',
            text: source.text,
            thinking: '',
            createdAt: at,
            status: 'complete',
            stopReason: null,
          },
        },
      ]);
    }
  }
}

async function waitForIndex(
  store: ProfileStore,
  resource: LocalEmbeddingView,
  failures: readonly unknown[],
  signal: AbortSignal,
): Promise<void> {
  for (;;) {
    signal.throwIfAborted();
    if (failures.length > 0) throw new AggregateError(failures, 'Real quality indexer failed');
    const status = store.search.status(resource.status().signature);
    if (status.state === 'failed') throw new Error(status.error ?? 'Real quality index failed');
    if (
      status.state === 'ready' &&
      status.lexicalReady &&
      status.pendingSources === 0 &&
      status.sourceCount === SEARCH_QUALITY_SOURCES.length &&
      status.chunkCount > 0 &&
      status.vectorCount === status.chunkCount &&
      status.buildingGeneration === null
    )
      return;
    await wait(25, undefined, { signal });
  }
}

function sourceRanking(chunks: readonly RankedSearchChunk[]): string[] {
  return [...new Set(chunks.map((chunk) => chunk.source.id))];
}

function permitted(source: SearchQualitySource, test: SearchQualityCase): boolean {
  if (test.scope.kind !== undefined && source.kind !== test.scope.kind) return false;
  if (source.scope.kind === 'user') {
    if (test.scope.includeUserMemories === false) return false;
    if (test.scope.workspaceId === null) return true;
    if (test.scope.workspaceId !== undefined) return test.scope.includeUserMemories === true;
    return test.scope.allWorkspaces === true;
  }
  if (test.scope.workspaceId !== undefined)
    return source.scope.workspaceId === test.scope.workspaceId;
  return test.scope.allWorkspaces === true;
}

function auditCandidates(
  test: SearchQualityCase,
  engine: QualityEngine,
  chunks: readonly RankedSearchChunk[],
  sources: ReadonlyMap<string, SearchQualitySource>,
  scopeViolations: string[],
): void {
  const forbidden = new Set<string>(test.forbiddenSourceIds ?? []);
  for (const chunk of chunks) {
    const source = sources.get(chunk.source.id);
    expect(source, `${test.id}/${engine}: unknown source`).toBeDefined();
    if (source === undefined) throw new Error('Indexed source not present in the fixed corpus');
    if (!permitted(source, test) || forbidden.has(chunk.source.id)) {
      scopeViolations.push(`${test.id}/${engine}/${chunk.source.id}`);
    }
    expect(chunk.source.kind).toBe(source.kind);
    expect(chunk.source.contentHash).toBe(hash(source.text));
    expect(chunk.text).toBe(source.text.slice(chunk.start, chunk.end));
  }
}

/** Recall counts all annotated sources in the first five distinct results; MRR uses the full candidate list. */
function metric(measurements: readonly QualityMeasurement[], engine: QualityEngine): QualityMetric {
  const positives = measurements.filter((entry) => entry.test.expectedSourceIds.length > 0);
  let recall = 0;
  let reciprocalRank = 0;
  for (const entry of positives) {
    const expected = new Set<string>(entry.test.expectedSourceIds);
    const ranked = entry.rankings[engine];
    recall += ranked.slice(0, 5).filter((id) => expected.has(id)).length / expected.size;
    const first = ranked.findIndex((id) => expected.has(id));
    if (first >= 0) reciprocalRank += 1 / (first + 1);
  }
  if (positives.length === 0) return { recallAt5: 0, mrr: 0 };
  return {
    recallAt5: Number((recall / positives.length).toFixed(4)),
    mrr: Number((reciprocalRank / positives.length).toFixed(4)),
  };
}

function summarize(measurements: readonly QualityMeasurement[]): QualitySummary {
  const negatives = measurements.filter((entry) => entry.test.expectedSourceIds.length === 0);
  const negativesWithCandidates = { lexical: 0, semantic: 0, fused: 0 };
  for (const entry of negatives) {
    for (const engine of ENGINES) {
      if (entry.rankings[engine].length > 0) negativesWithCandidates[engine] += 1;
    }
  }
  return {
    positiveQueries: measurements.length - negatives.length,
    negativeQueries: negatives.length,
    lexical: metric(measurements, 'lexical'),
    semantic: metric(measurements, 'semantic'),
    fused: metric(measurements, 'fused'),
    negativesWithCandidates,
  };
}

/** Every owned resource is attempted even when an earlier teardown fails. */
async function cleanup(
  indexer: SearchIndexer | undefined,
  resource: LocalSearchModelResource | undefined,
  store: ProfileStore | undefined,
  directory: string,
): Promise<void> {
  const failures: unknown[] = [];
  const actions: (() => void | Promise<void>)[] = [
    () => indexer?.close(),
    () => resource?.close(),
    () => store?.close(),
    () => rm(directory, { recursive: true, force: true }),
  ];
  for (const action of actions) {
    try {
      await action();
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'Real quality fixture cleanup failed');
}

describe('fixed local E5 retrieval quality', () => {
  it.skipIf(CACHE_DIRECTORY === undefined)(
    'reports a frozen real-CPU baseline without downloads or threshold tuning',
    async () => {
      if (CACHE_DIRECTORY === undefined || !isAbsolute(CACHE_DIRECTORY))
        throw new Error(
          'MY_PI_HARNESS_TEST_EMBEDDING_CACHE must be an absolute existing cache directory',
        );
      const directory = await mkdtemp(join(tmpdir(), 'my-pi-search-quality-'));
      const controller = new AbortController();
      const deadline = setTimeout(
        () =>
          controller.abort(new DOMException('Real search quality deadline exceeded', 'AbortError')),
        DEADLINE_MS,
      );
      let store: ProfileStore | undefined;
      let resource: LocalSearchModelResource | undefined;
      let indexer: SearchIndexer | undefined;
      try {
        const startedAt = performance.now();
        store = await openProfileStore(directory);
        const owner = authenticate(store);
        await seed(store, owner, directory);
        resource = new LocalSearchModelResource({ cacheDirectory: CACHE_DIRECTORY });
        expect(
          resource.embedding.status().state,
          'An incomplete cache must fail without downloading',
        ).toBe('ready');
        expect(
          resource.reranker.status().state,
          'A verifier cache must be prepared explicitly before this quality test',
        ).toBe('ready');
        const failures: unknown[] = [];
        indexer = new SearchIndexer({
          store,
          embedding: resource.embedding,
          onError: (failure) => {
            failures.push(failure);
          },
        });
        indexer.start();
        await waitForIndex(store, resource.embedding, failures, controller.signal);
        const indexedAt = performance.now();
        const status = store.search.status(resource.embedding.status().signature);
        const query = new PersistentSearchQuery({
          repository: store.search,
          embedding: resource.embedding,
        });
        const sources = new Map<string, SearchQualitySource>(
          SEARCH_QUALITY_SOURCES.map((source) => [source.id, source]),
        );
        const measurements: QualityMeasurement[] = [];
        const scopeViolations: string[] = [];
        for (const test of SEARCH_QUALITY_CASES) {
          controller.signal.throwIfAborted();
          const outcome = await query.run(
            { ownerUserId: owner, scope: test.scope },
            { query: test.query, limit: 5 },
            controller.signal,
          );
          expect(outcome.result.mode, test.id).toBe('hybrid');
          expect(outcome.result.truncated, test.id).toBe(false);
          const engines = {
            lexical: outcome.lexical,
            semantic: outcome.semantic,
            fused: outcome.ranked,
          };
          for (const engine of ENGINES)
            auditCandidates(test, engine, engines[engine], sources, scopeViolations);
          measurements.push({
            test,
            rankings: {
              lexical: sourceRanking(outcome.lexical),
              semantic: sourceRanking(outcome.semantic),
              fused: sourceRanking(outcome.ranked),
            },
            semanticTopScore: outcome.semantic[0]?.score ?? null,
          });
        }
        const splits = Object.fromEntries(
          ['calibration', 'holdout'].map((split) => {
            const entries = measurements.filter((entry) => entry.test.split === split);
            return [
              split,
              {
                ...summarize(entries),
                memory: summarize(
                  entries.filter((entry) =>
                    entry.test.expectedSourceIds.some((id) => sources.get(id)?.kind === 'memory'),
                  ),
                ),
                messages: summarize(
                  entries.filter((entry) =>
                    entry.test.expectedSourceIds.some((id) => sources.get(id)?.kind === 'message'),
                  ),
                ),
                zeroLexical: summarize(
                  entries.filter((entry) => entry.test.tags.includes('zero-lexical')),
                ),
              },
            ];
          }),
        );
        const report = {
          model: resource.embedding.status(),
          verifier: resource.reranker.status(),
          host: {
            platform: process.platform,
            arch: process.arch,
            node: process.version,
            cpu: cpus()[0]?.model ?? 'unknown',
            cores: cpus().length,
          },
          corpus: {
            sources: sources.size,
            chunks: status.chunkCount,
            vectors: status.vectorCount,
            queries: measurements.length,
          },
          timingsMs: {
            index: Math.round(indexedAt - startedAt),
            queries: Math.round(performance.now() - indexedAt),
          },
          splits,
          scope: {
            cases: measurements.filter((entry) => entry.test.tags.includes('scope-conflict'))
              .length,
            violations: scopeViolations,
          },
          negativeCandidates: measurements
            .filter((entry) => entry.test.expectedSourceIds.length === 0)
            .map((entry) => ({
              id: entry.test.id,
              split: entry.test.split,
              lexicalTop5: entry.rankings.lexical.slice(0, 5),
              semanticTop5: entry.rankings.semantic.slice(0, 5),
              fusedTop5: entry.rankings.fused.slice(0, 5),
              semanticTopScore: entry.semanticTopScore,
            })),
          fusedMisses: measurements
            .filter((entry) =>
              entry.test.expectedSourceIds.some(
                (id) => !entry.rankings.fused.slice(0, 5).includes(id),
              ),
            )
            .map((entry) => ({
              id: entry.test.id,
              split: entry.test.split,
              expected: entry.test.expectedSourceIds,
              lexicalTop5: entry.rankings.lexical.slice(0, 5),
              semanticTop5: entry.rankings.semantic.slice(0, 5),
              fusedTop5: entry.rankings.fused.slice(0, 5),
            })),
        };
        process.stdout.write(`M6_SEARCH_QUALITY_BASELINE ${JSON.stringify(report)}\n`);
        for (const split of ['calibration', 'holdout']) {
          const entries = measurements.filter((entry) => entry.test.split === split);
          expect(
            metric(entries, 'fused').recallAt5,
            `${split} fused Recall@5`,
          ).toBeGreaterThanOrEqual(0.85);
        }
        const memory = new MemoryService(store.memory);
        const retrieval = new MemoryRetrieval(
          memory,
          {
            queryScoped: async (...args) => (await query.run(...args)).result,
          },
          resource.reranker,
        );
        const adoptionMeasurements: {
          id: string;
          split: SearchQualityCase['split'];
          expected: readonly string[];
          adopted: string[];
          evidence: { id: string; score: number | null }[];
          incomplete: boolean;
        }[] = [];
        for (const test of SEARCH_QUALITY_CASES.filter(
          (test) =>
            test.expectedSourceIds.length === 0 ||
            test.expectedSourceIds.some((id) => id.startsWith('memory:')),
        )) {
          const access = {
            ownerUserId: owner,
            workspaceId: test.scope.workspaceId ?? null,
            includeUser: true,
          };
          const snapshot = memory.snapshot(access);
          const candidates = await retrieval.search(access, test.query, controller.signal, {
            mode: 'relevant',
            verify: true,
          });
          const adopted = memory.select(snapshot, candidates.candidates, {
            query: test.query,
            mode: candidates.mode,
            truncated: candidates.truncated,
            verification: candidates.verification,
          });
          const ids = adopted.entries.map((entry) => `memory:${entry.id}`);
          adoptionMeasurements.push({
            id: test.id,
            split: test.split,
            expected: test.expectedSourceIds,
            adopted: ids,
            evidence: candidates.candidates
              .map((candidate) => ({
                id: candidate.entry.id,
                score: candidate.relevanceScore ?? null,
              }))
              .sort((left, right) => (right.score ?? -1) - (left.score ?? -1))
              .slice(0, 3),
            incomplete: candidates.truncated,
          });
        }
        const adoptionReport = ['calibration', 'holdout'].map((split) => {
          const group = adoptionMeasurements.filter((entry) => entry.split === split);
          const positives = group.filter((entry) => entry.expected.length > 0);
          const negatives = group.filter((entry) => entry.expected.length === 0);
          const hitQueries = positives.filter((entry) => entry.adopted.length > 0).length;
          const falseQueries = negatives.filter((entry) => entry.adopted.length > 0).length;
          return {
            split,
            positiveQueries: positives.length,
            hitQueries,
            negativeQueries: negatives.length,
            falseQueries,
            details: group,
          };
        });
        process.stdout.write(`M6_MEMORY_ADOPTION_QUALITY ${JSON.stringify(adoptionReport)}\n`);
        for (const group of adoptionReport) {
          expect(
            group.hitQueries / group.positiveQueries,
            `${group.split} relevant automatic adoption coverage`,
          ).toBeGreaterThanOrEqual(0.5);
          expect(
            group.falseQueries / group.negativeQueries,
            `${group.split} unrelated automatic adoption rate`,
          ).toBeLessThanOrEqual(0.05);
          for (const entry of group.details)
            for (const id of entry.adopted)
              expect(entry.expected, `${entry.id} automatically adopted ${id}`).toContain(id);
        }

        expect(measurements).toHaveLength(70);
        expect(
          scopeViolations,
          'All engines must filter scope before returning any candidates',
        ).toEqual([]);
        expect(failures).toEqual([]);
      } finally {
        clearTimeout(deadline);
        controller.abort();
        await cleanup(indexer, resource, store, directory);
      }
    },
    120_000,
  );
});
