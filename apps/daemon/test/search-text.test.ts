import { describe, expect, it } from 'vitest';
import { documentTerms, queryTerms, textChunks, tokenChunks } from '../src/search/text';

describe('persistent search text', () => {
  it('shares exact short CJK and case-normalized identifier terms without interpreting MATCH operators', () => {
    for (const query of ['记忆', '库', 'TOOL_SEARCH', 'OAuth2']) {
      const tokens = queryTerms(query);
      const document = documentTerms('记忆数据库 tool_search OAuth2');
      expect(tokens.some((token) => document.split(' ').includes(token))).toBe(true);
    }
    expect(queryTerms('" OR * NOT (').every((token) => /^w[0-9a-fz]+$/.test(token))).toBe(true);
    expect(queryTerms('数据库会话管理').length).toBeLessThan(Array.from('数据库会话管理').length);
    expect(queryTerms('  ')).toEqual([]);
    expect(
      queryTerms(Array.from({ length: 100 }, (_, index) => `word${index}`).join(' ')),
    ).toHaveLength(65);
  });

  it('preserves exact lossless Unicode ranges during bounded chunking and tokenizer-driven splitting', async () => {
    const text = '数据库🌱\n'.repeat(180);
    const plain = textChunks(text);
    expect(plain.map((chunk) => chunk.text).join('')).toBe(text);
    const chunks = await tokenChunks(
      text,
      (texts) => Promise.resolve(texts.map((value) => value.length * 3)),
      new AbortController().signal,
    );
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(text);
    for (const [ordinal, chunk] of chunks.entries()) {
      expect(chunk.ordinal).toBe(ordinal);
      expect(chunk.text).toBe(text.slice(chunk.start, chunk.end));
      expect(chunk.text.length * 3).toBeLessThanOrEqual(512);
      expect(chunk.text.charCodeAt(0)).not.toBe(0xdf31);
    }
  });

  it('does not hide cancellation or an invalid tokenizer result as an empty index', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      tokenChunks('资料', () => Promise.resolve([1]), controller.signal),
    ).rejects.toThrow();
    await expect(
      tokenChunks('资料', () => Promise.resolve([]), new AbortController().signal),
    ).rejects.toThrow('count batch');
  });
});
