import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSearchResults, fetchSearchSource } from '../src/features/search/services/search';
import { SEARCH_RESULTS, SOURCE_SELECTION, SOURCE_WINDOW } from './fixtures/search';

const respond = (data: unknown) => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }),
    );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bounded search and source HTTP', () => {
  it('uses read-only POST endpoints and rejects crossed source windows and broken offsets', async () => {
    const fetch = respond(SEARCH_RESULTS);
    await expect(
      fetchSearchResults(
        { query: '原文', scope: { workspaceId: 'workspace' } },
        new AbortController().signal,
      ),
    ).resolves.toEqual(SEARCH_RESULTS);
    expect(fetch).toHaveBeenCalledWith('/api/search', expect.objectContaining({ method: 'POST' }));
    respond({ ...SOURCE_WINDOW, selection: { ...SOURCE_SELECTION, end: 1 } });
    await expect(
      fetchSearchSource({ selection: SOURCE_SELECTION }, new AbortController().signal),
    ).rejects.toThrow('所选原文不一致');
    respond({
      ...SOURCE_WINDOW,
      items: SOURCE_WINDOW.items.map((item) => {
        return { ...item, end: item.end + 1 };
      }),
    });
    await expect(
      fetchSearchSource({ selection: SOURCE_SELECTION }, new AbortController().signal),
    ).rejects.toThrow('原文范围无效');
  });

  it('sends a text offset while retaining the original validated selection and accepts host-safe Unicode endpoints', async () => {
    const body = 'A'.repeat(7999) + '😀' + 'B'.repeat(9000);
    const selection = {
      ...SOURCE_SELECTION,
      source: {
        ...SOURCE_SELECTION.source,
        contentHash: createHash('sha256').update(body).digest('hex'),
      },
    };
    const window = {
      ...SOURCE_WINDOW,
      selection,
      items: [
        {
          source: selection.source,
          target: selection.target,
          start: 7999,
          end: 15999,
          text: body.slice(7999, 15999),
          totalLength: body.length,
          origin: 'assistant',
          status: 'complete',
          createdAt: 1,
        },
      ],
    };
    const fetch = respond(window);
    await expect(
      fetchSearchSource(
        { selection, textOffset: 8000, before: 0, after: 0 },
        new AbortController().signal,
      ),
    ).resolves.toEqual(window);
    expect(fetch).toHaveBeenCalledWith(
      '/api/search/source',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ selection, textOffset: 8000, before: 0, after: 0 }),
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
