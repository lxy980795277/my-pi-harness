import MiniSearch from 'minisearch';
import type { RunToolDefinition } from '../tools/toolset.js';

/** The host owns model files and inference; retrieval never receives service credentials. */
export interface ToolSearchEmbedder {
  embed(
    purpose: 'document' | 'query',
    inputs: readonly string[],
    signal: AbortSignal,
  ): Promise<readonly (readonly number[])[]>;
}

export interface ToolSearchDocument {
  definition: RunToolDefinition;
  label: string;
  source: string;
  originalName: string;
}

interface IndexedDocument {
  id: string;
  text: string;
  input: ToolSearchDocument;
  exact: boolean;
}

export const DEFAULT_TOOL_SEARCH_LIMIT = 8;
export const MAX_TOOL_SEARCH_RESULTS = 10;
export const MAX_VISIBLE_TOOLS = 64;

function normalize(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Segment CJK text into searchable words without requiring a language-specific model. */
function terms(value: string): string[] {
  const segments = new Intl.Segmenter('zh', { granularity: 'word' }).segment(normalize(value));
  const words = [...segments].flatMap((segment) => {
    if (!segment.isWordLike) return [];
    const term = segment.segment;
    if (term.length > 4 && term.endsWith('ies')) return [term.slice(0, -3) + 'y'];
    if (term.length > 4 && /(ches|shes|sses|xes|zes)$/.test(term)) return [term.slice(0, -2)];
    if (term.length > 3 && /s$/.test(term) && !/(ss|us|is|as)$/.test(term))
      return [term.slice(0, -1)];
    return [term];
  });
  // Preserve brand spellings such as GitHub alongside their CamelCase parts.
  const known = new Set(words);
  for (const word of value.match(/[A-Za-z][A-Za-z0-9]+/g) ?? []) {
    const lower = word.toLowerCase();
    if (!known.has(lower)) {
      words.push(lower);
      known.add(lower);
    }
  }
  return words;
}

function parameterText(parameters: RunToolDefinition['parameters']): string {
  const queue: unknown[] = [parameters];
  const seen = new Set<object>();
  const result: string[] = [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const value = queue[cursor];
    if (value === null || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      const items: readonly unknown[] = value;
      queue.push(...items);
      continue;
    }
    for (const key of Object.keys(value)) {
      const item: unknown = Reflect.get(value, key);
      if ((key === 'description' || key === 'title') && typeof item === 'string') result.push(item);
      if (key === 'properties' && item !== null && typeof item === 'object')
        result.push(...Object.keys(item));
      if (key !== 'default' && item !== null && typeof item === 'object') queue.push(item);
    }
  }
  return result.join(' ');
}

function indexDocuments(inputs: readonly ToolSearchDocument[], query: string): IndexedDocument[] {
  const phrase = normalize(query);
  return inputs.map((input) => ({
    id: input.definition.name,
    text: `${input.label}\n${input.originalName}\n${input.definition.description}\n${parameterText(input.definition.parameters)}`,
    input,
    exact: normalize(input.definition.name) === phrase || normalize(input.originalName) === phrase,
  }));
}

function lexical(documents: readonly IndexedDocument[], query: string): IndexedDocument[] {
  const engine = new MiniSearch<IndexedDocument>({
    fields: ['text'],
    tokenize: terms,
    processTerm: (term) => term,
    searchOptions: { combineWith: 'OR', bm25: { k: 1.2, b: 0.75, d: 0 } },
  });
  engine.addAll(documents);
  const scores = new Map(engine.search(query).map((result) => [String(result.id), result.score]));
  return documents
    .filter((document) => document.exact || scores.has(document.id))
    .sort(
      (left, right) =>
        Number(right.exact) - Number(left.exact) ||
        (scores.get(right.id) ?? 0) - (scores.get(left.id) ?? 0) ||
        left.id.localeCompare(right.id),
    );
}

function unitVector(vector: readonly number[], dimensions?: number): readonly number[] {
  if (
    vector.length === 0 ||
    (dimensions !== undefined && vector.length !== dimensions) ||
    vector.some((value) => !Number.isFinite(value))
  )
    throw new Error('Embedding response is invalid');
  const magnitude = Math.hypot(...vector);
  if (magnitude === 0) throw new Error('Embedding response has zero magnitude');
  return vector.map((value) => value / magnitude);
}

/** Stop waiting on optional inference even when a native backend finishes after cancellation. */
async function waitForEmbedding(
  operation: Promise<readonly (readonly number[])[]>,
  signal: AbortSignal,
): Promise<readonly (readonly number[])[]> {
  let release = (): void => undefined;
  try {
    return await new Promise<readonly (readonly number[])[]>((resolve, reject) => {
      const abort = (): void => {
        const reason: unknown = signal.reason;
        reject(
          reason instanceof Error
            ? reason
            : new DOMException('Tool search cancelled', 'AbortError'),
        );
      };
      release = () => signal.removeEventListener('abort', abort);
      signal.addEventListener('abort', abort, { once: true });
      operation.then(resolve, reject);
      if (signal.aborted) abort();
    });
  } finally {
    release();
  }
}

function fuse(ranked: readonly (readonly IndexedDocument[])[]): ToolSearchDocument[] {
  const entries = new Map<string, { document: IndexedDocument; score: number }>();
  for (const ranking of ranked)
    for (const [index, document] of ranking.entries()) {
      const previous = entries.get(document.id);
      entries.set(document.id, {
        document,
        score: (previous?.score ?? 0) + 1 / (61 + index),
      });
    }
  return [...entries.values()]
    .sort(
      (left, right) =>
        Number(right.document.exact) - Number(left.document.exact) ||
        right.score - left.score ||
        left.document.id.localeCompare(right.document.id),
    )
    .slice(0, MAX_TOOL_SEARCH_RESULTS)
    .map(({ document }) => document.input);
}

/** Ranked retrieval over an immutable Run catalog; semantic failures retain lexical results. */
export class ToolCatalogSearch {
  private readonly vectors = new Map<string, readonly number[]>();

  public constructor(private readonly embedder?: ToolSearchEmbedder) {}

  public async search(
    inputs: readonly ToolSearchDocument[],
    query: string,
    signal: AbortSignal,
  ): Promise<ToolSearchDocument[]> {
    signal.throwIfAborted();
    if (query.trim().length === 0 || inputs.length === 0) return [];
    const documents = indexDocuments(inputs, query);
    const words = lexical(documents, query);
    const fallback = words.slice(0, MAX_TOOL_SEARCH_RESULTS).map(({ input }) => input);
    if (!this.embedder || words[0]?.exact) return fallback;
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(18_000)]);
    try {
      const queryVectors = await waitForEmbedding(
        this.embedder.embed('query', [query], bounded),
        bounded,
      );
      const rawQuery = queryVectors[0];
      if (queryVectors.length !== 1 || !rawQuery) return fallback;
      const queryVector = unitVector(rawQuery);
      const uncached = documents.filter((document) => !this.vectors.has(document.text));
      for (let offset = 0; offset < uncached.length; offset += 32) {
        bounded.throwIfAborted();
        const batch = uncached.slice(offset, offset + 32);
        const vectors = await waitForEmbedding(
          this.embedder.embed(
            'document',
            batch.map(({ text }) => text.slice(0, 2_000)),
            bounded,
          ),
          bounded,
        );
        if (vectors.length !== batch.length) return fallback;
        for (const [index, document] of batch.entries()) {
          const vector = vectors[index];
          if (!vector) return fallback;
          this.vectors.set(document.text, unitVector(vector, queryVector.length));
        }
      }
      signal.throwIfAborted();
      const ranked = documents
        .map((document) => ({
          document,
          score: queryVector.reduce(
            (sum, value, index) => sum + value * (this.vectors.get(document.text)?.[index] ?? 0),
            0,
          ),
        }))
        .sort(
          (left, right) =>
            right.score - left.score || left.document.id.localeCompare(right.document.id),
        );
      const best = ranked[0]?.score ?? 0;
      const semantic = ranked
        .filter(({ score }) => score >= best - 0.05)
        .slice(0, 60)
        .map(({ document }) => document);
      return fuse([words, semantic]);
    } catch {
      signal.throwIfAborted();
      // Local model loading, inference and its deadline are optional retrieval work.
      return fallback;
    } finally {
      while (this.vectors.size > 4_000) {
        const first = this.vectors.keys().next().value;
        if (first === undefined) break;
        this.vectors.delete(first);
      }
    }
  }
}
