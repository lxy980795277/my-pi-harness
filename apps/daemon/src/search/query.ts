import { setImmediate as nextTurn } from 'node:timers/promises';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import type { SearchHit, SearchQueryInput, SearchQueryResult } from '@my-pi-harness/protocol';
import type { SearchAccess } from '@my-pi-harness/protocol/internal';
import type { ProfileStore } from '@my-pi-harness/storage';
import { LocalModelError, type LocalEmbeddingView } from './local-model-resource';
import { cosine, fuseChunks, type RankedSearchChunk } from './ranking';
import { queryTerms } from './text';

export interface SearchQueryOptions {
  repository: ProfileStore['search'];
  embedding: Pick<LocalEmbeddingView, 'status' | 'embed'>;
}

export interface SearchExecutionOptions {
  priority?: 'foreground' | 'tool';
}

export interface SearchQueryOutcome {
  result: SearchQueryResult;
  lexical: RankedSearchChunk[];
  semantic: RankedSearchChunk[];
  ranked: RankedSearchChunk[];
}

const MAX_VECTOR_SCAN = 20_000;
const MIN_SEARCH_SIMILARITY = 0.7;

/** Query engines consume the same host scope; returned excerpts are checked against current facts. */
export class PersistentSearchQuery {
  public constructor(private readonly options: SearchQueryOptions) {}

  public async run(
    access: SearchAccess,
    input: Pick<SearchQueryInput, 'query' | 'limit'>,
    signal: AbortSignal,
    options: SearchExecutionOptions = {},
  ): Promise<SearchQueryOutcome> {
    signal.throwIfAborted();
    const { repository, embedding } = this.options;
    let queryVector: readonly number[] | undefined;
    if (embedding.status().state === 'ready') {
      try {
        queryVector = (
          await embedding.embed([input.query], {
            kind: 'query',
            priority: options.priority ?? 'foreground',
            signal,
          })
        )[0];
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof LocalModelError)) throw error;
      }
    }
    signal.throwIfAborted();
    const model = embedding.status();
    const readiness = repository.queryReadiness(
      queryVector === undefined ? undefined : model.signature,
    );
    const watermark = repository.watermark(access);
    const generation = readiness.generation;
    const tokens = queryTerms(input.query);
    const rows = repository.lexical(access, {
      generation,
      tokens: tokens.slice(0, 64),
      limit: 100,
    });
    const lexical: RankedSearchChunk[] = rows.map((row) => ({ ...row, score: -row.rank }));
    const semantic: RankedSearchChunk[] = [];
    let truncated = !readiness.complete || rows.length === 100 || tokens.length > 64;
    if (queryVector !== undefined) {
      let after: number | undefined;
      let scanned = 0;
      do {
        signal.throwIfAborted();
        const page = repository.vectors(access, {
          generation,
          modelSignature: model.signature,
          limit: Math.min(512, MAX_VECTOR_SCAN - scanned),
          ...(after === undefined ? {} : { after }),
        });
        for (const row of page.items) {
          const { vector, ...candidate } = row;
          const score = cosine(queryVector, vector);
          if (score >= MIN_SEARCH_SIMILARITY) semantic.push({ ...candidate, score });
        }
        scanned += page.items.length;
        after = page.next ?? undefined;
        if (scanned >= MAX_VECTOR_SCAN) {
          truncated ||= page.next !== null;
          break;
        }
        await nextTurn(undefined, { signal });
      } while (after !== undefined);
      semantic.sort((left, right) => right.score - left.score || left.chunkId - right.chunkId);
      truncated ||= semantic.length > 100;
      semantic.splice(100);
      truncated ||= readiness.vectorsComplete !== true;
    }
    const ranked = fuseChunks(lexical, semantic, 50);
    const hits: SearchHit[] = [];
    for (const chunk of ranked) {
      signal.throwIfAborted();
      const source = repository.source(access, chunk.source);
      if (source === null || source.text.slice(chunk.start, chunk.end) !== chunk.text) continue;
      const member = source.memberships[0];
      if (source.source.kind === 'message' && member === undefined) continue;
      hits.push({
        source: source.source,
        title: source.title,
        workspaceId: source.workspaceId,
        ...(source.sessionId === null ? {} : { sessionId: source.sessionId }),
        ...(source.messageId === null ? {} : { messageId: source.messageId }),
        ...(source.memoryId === null ? {} : { memoryId: source.memoryId }),
        ...(member === undefined
          ? {}
          : {
              branchId: member.branchId,
              ...(member.taskId === null ? {} : { taskId: member.taskId }),
            }),
        origin: source.origin,
        status: source.status,
        start: chunk.start,
        end: chunk.end,
        text: chunk.text,
        score: chunk.score,
        createdAt: source.createdAt,
      });
      if (hits.length === (input.limit ?? 20)) break;
    }
    signal.throwIfAborted();
    if (repository.activeGeneration() !== generation || repository.watermark(access) !== watermark)
      throw new RuntimeError('SEARCH_INDEX_CHANGED', '搜索资料已更新，请重新查询。');
    return {
      result: {
        hits,
        mode: queryVector === undefined ? 'lexical' : 'hybrid',
        truncated,
        generation,
        watermark,
      },
      lexical,
      semantic,
      ranked,
    };
  }
}
