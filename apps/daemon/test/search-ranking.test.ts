import { describe, expect, it } from 'vitest';
import { cosine, fuseChunks } from '../src/search/ranking';

function chunk(chunkId: number, sourceId: string) {
  return {
    chunkId,
    source: { id: sourceId, kind: 'message' as const, contentHash: 'a'.repeat(64) },
    start: 0,
    end: 2,
    text: '资料',
    score: 1,
  };
}

describe('persistent search ranking', () => {
  it('measures compatible vectors and refuses zero, malformed or different model dimensions', () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 0])).toBe(-1);
    expect(cosine([1], [1, 0])).toBe(-1);
    expect(cosine([NaN], [1])).toBe(-1);
  });
  it('retrieves semantic-only sources and stably deduplicates excerpts without dropping distinct identical sources', () => {
    const keyword = [chunk(1, 'a'), chunk(2, 'a'), chunk(3, 'b')];
    const semantic = [chunk(4, 'c'), chunk(3, 'b')];
    const result = fuseChunks(keyword, semantic, 10);
    expect(result.map((value) => value.source.id)).toEqual(['b', 'a', 'c']);
    expect(fuseChunks(keyword, semantic, 2)).toHaveLength(2);
    expect(fuseChunks([], [], 10)).toEqual([]);
  });
});
