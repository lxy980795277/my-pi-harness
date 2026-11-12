import { createHash } from 'node:crypto';
import type { MemoryEntry, MemoryMode, MemorySelection } from '@my-pi-harness/protocol';
import type {
  MemoryAccess,
  MemoryRecallCandidate,
  SearchAccess,
} from '@my-pi-harness/protocol/internal';
import type { MemoryService } from '@my-pi-harness/memory';
import type { SearchService } from '../search/service';
import { LocalModelError, type LocalRerankerView } from '../search/local-model-resource';

export interface MemoryRetrievalOptions {
  mode?: MemoryMode;
  priority?: 'foreground' | 'tool';
  verify?: boolean;
}

export interface MemoryRetrievalResult {
  candidates: MemoryRecallCandidate[];
  mode: 'lexical' | 'hybrid';
  truncated: boolean;
  verification: NonNullable<MemorySelection['verification']>;
}

interface CandidateEvidence {
  entry: MemoryEntry;
  passage: string;
}

/** Retrieval supplies exact source windows; only local cross-encoder scores permit automatic adoption. */
export class MemoryRetrieval {
  public constructor(
    private readonly domain: Pick<MemoryService, 'entries'>,
    private readonly searchService: Pick<SearchService, 'queryScoped'>,
    private readonly reranker: Pick<LocalRerankerView, 'status' | 'rerank'>,
  ) {}

  public async search(
    access: MemoryAccess,
    text: string,
    signal: AbortSignal,
    options: MemoryRetrievalOptions = {},
  ): Promise<MemoryRetrievalResult> {
    const searchAccess: SearchAccess = {
      ownerUserId: access.ownerUserId,
      scope: {
        workspaceId: access.workspaceId,
        kind: 'memory',
        includeUserMemories: access.includeUser,
        ...(options.mode === undefined ? {} : { memoryMode: options.mode }),
      },
      ...(access.userMemoryIds === undefined ? {} : { userMemoryIds: access.userMemoryIds }),
    };
    const query = text
      .trim()
      .slice(0, 500)
      .replace(/[\uD800-\uDBFF]$/, '');
    const result = await this.searchService.queryScoped(
      searchAccess,
      { query, limit: options.verify ? 20 : 50 },
      signal,
      {
        priority: options.priority ?? 'foreground',
      },
    );
    signal.throwIfAborted();
    const hits = result.hits.filter((hit) => hit.memoryId !== undefined);
    const entries = this.domain.entries(
      access,
      hits.flatMap((hit) => (hit.memoryId === undefined ? [] : [hit.memoryId])),
    );
    const evidence: CandidateEvidence[] = [];
    for (const hit of hits) {
      const entry = entries.find((value) => value.id === hit.memoryId);
      if (
        entry === undefined ||
        createHash('sha256').update(entry.body).digest('hex') !== hit.source.contentHash
      )
        continue;
      evidence.push({ entry, passage: hit.text });
    }
    const candidates: MemoryRecallCandidate[] = evidence.map(({ entry }) => ({ entry }));
    let truncated = result.truncated || text.trim().length > query.length;
    let verification: MemoryRetrievalResult['verification'] = 'not-needed';
    if (options.verify && candidates.length > 0) {
      verification = 'unavailable';
      if (text.trim().length <= 500 && this.reranker.status().state === 'ready') {
        try {
          const scores = await this.reranker.rerank(
            query,
            evidence.map(({ passage }) => passage),
            {
              priority: options.priority ?? 'foreground',
              signal,
            },
          );
          signal.throwIfAborted();
          verification = scores.some((score) => score !== null) ? 'local-model' : 'unavailable';
          for (const [index, score] of scores.entries()) {
            const candidate = candidates[index];
            if (score !== null && candidate !== undefined) candidate.relevanceScore = score;
            else truncated = true;
          }
        } catch (error) {
          signal.throwIfAborted();
          if (!(error instanceof LocalModelError)) throw error;
          truncated = true;
        }
      }
    }
    signal.throwIfAborted();
    return { candidates, mode: result.mode, truncated, verification };
  }
}
