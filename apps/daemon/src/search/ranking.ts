import type { SearchSourceRef } from '@my-pi-harness/protocol';

export interface RankedSearchChunk {
  chunkId: number;
  source: SearchSourceRef;
  start: number;
  end: number;
  text: string;
  score: number;
}

/** Exact cosine supports persisted Float32 arrays; incompatible vectors never become candidates. */
export function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return -1;
  let product = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return -1;
    product += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return -1;
  return product / Math.sqrt(leftNorm * rightNorm);
}

/** Fuse independently retrieved engines, then retain one best exact excerpt per source. */
export function fuseChunks(
  lexical: readonly RankedSearchChunk[],
  semantic: readonly RankedSearchChunk[],
  limit: number,
): RankedSearchChunk[] {
  const chunks = new Map<number, RankedSearchChunk>();
  for (const list of [lexical, semantic]) {
    for (const [index, candidate] of list.entries()) {
      const previous = chunks.get(candidate.chunkId);
      const score = (previous?.score ?? 0) + 1 / (60 + index + 1);
      chunks.set(candidate.chunkId, {
        ...candidate,
        ...previous,
        score,
      });
    }
  }
  const sources = new Set<string>();
  const selected: RankedSearchChunk[] = [];
  const ranked = [...chunks.values()].sort(
    (left, right) =>
      right.score - left.score ||
      left.source.id.localeCompare(right.source.id) ||
      left.start - right.start,
  );
  for (const candidate of ranked) {
    if (sources.has(candidate.source.id)) continue;
    sources.add(candidate.source.id);
    selected.push(candidate);
    if (selected.length === limit) break;
  }
  return selected;
}
