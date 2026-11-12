import { describe, expect, it, vi } from 'vitest';
import type { WebSearchResult } from '@my-pi-harness/protocol/internal';
import type { WebToolHandlers } from '../src/index';
import { nativeTool } from '../src/index';
import { webPageText, webSearchText, webRawText } from '../src/lib/web-content';
import { describeRegistered, executeRegistered } from './support/registered';

const source = {
  title: 'Public source',
  url: 'https://example.com/article',
  snippet: 'Matched text',
  summary: 'Summary',
  content: 'Body',
  siteName: 'Example',
  siteIcon: null,
  date: '2026-11-12T00:00:00Z',
  rerankScore: 2,
  authority: 3,
};
const context = {
  workspaceRoot: '/unused',
  profileDirectory: '/unused',
  readOnly: true,
  signal: new AbortController().signal,
};

function handlers(): WebToolHandlers {
  return {
    search: vi.fn<WebToolHandlers['search']>(() => Promise.resolve({ results: [source] })),
    fetchPage: vi.fn<WebToolHandlers['fetchPage']>(({ url }) =>
      Promise.resolve({ url, title: 'Article', content: '# Body' }),
    ),
  };
}

describe('public search and explicit page extraction', () => {
  it('keeps read-only search and page extraction separate from raw POST policy', async () => {
    const web = handlers();
    const search = await executeRegistered(
      'web_search',
      { query: 'Test public search' },
      {
        ...context,
        web,
      },
    );
    const page = await executeRegistered(
      'web_fetch',
      { mode: 'page', url: source.url },
      {
        ...context,
        web,
      },
    );
    expect(web.search).toHaveBeenCalledWith(
      { query: 'Test public search' },
      {
        toolCallId: 'fixture',
        signal: context.signal,
      },
    );
    expect(web.fetchPage).toHaveBeenCalledWith(
      { url: source.url },
      {
        toolCallId: 'fixture',
        signal: context.signal,
      },
    );
    expect(JSON.stringify(search.content)).toContain(source.url);
    expect(JSON.stringify(page.content)).toContain('# Body');
    expect(describeRegistered('web_search', { query: 'search' })).toMatchObject({
      mutating: false,
      approvalRequired: true,
    });
    expect(describeRegistered('web_fetch', { mode: 'page', url: source.url })).toMatchObject({
      mutating: false,
    });
    expect(
      describeRegistered('web_fetch', { mode: 'raw', url: source.url, method: 'POST' }),
    ).toMatchObject({ mutating: true, approvalRequired: true });
    expect(nativeTool('web_search')?.loading).toBe('default');
  });

  it.each([
    { name: 'web_search', args: { query: 'search' } },
    { name: 'web_fetch', args: { mode: 'page', url: source.url } },
  ])(
    'reports missing host configuration for $name without a network fallback',
    async ({ name, args }) => {
      await expect(executeRegistered(name, args, context)).rejects.toMatchObject({
        code: 'WEB_NOT_CONFIGURED',
      });
    },
  );

  it.each([
    { url: source.url },
    { mode: 'automatic', url: source.url },
    { mode: 'page', url: source.url, method: 'GET' },
    { mode: 'page', url: source.url, body: 'private' },
    { mode: 'page', url: source.url, contentType: 'text/plain' },
    { mode: 'raw', url: source.url, headers: { Authorization: 'secret' } },
  ])('refuses ambiguous or incompatible arguments %# before a provider request', async (args) => {
    const web = handlers();
    await expect(executeRegistered('web_fetch', args, { ...context, web })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENTS',
    });
    expect(web.fetchPage).not.toHaveBeenCalled();
    expect(web.search).not.toHaveBeenCalled();
  });

  it('leaves page target validation with the host provider and preserves its rejection', async () => {
    const web = handlers();
    const url = 'http://127.0.0.1:4311/api/skill-gateway/github/user';
    const failure = new Error('Private page targets are unavailable');
    vi.mocked(web.fetchPage).mockRejectedValueOnce(failure);
    await expect(
      executeRegistered('web_fetch', { mode: 'page', url }, { ...context, web }),
    ).rejects.toBe(failure);
    expect(web.fetchPage).toHaveBeenCalledWith(
      { url },
      {
        toolCallId: 'fixture',
        signal: context.signal,
      },
    );
  });

  it('validates Unicode search length, whitespace, counts and unknown parameters', async () => {
    const web = handlers();
    await executeRegistered('web_search', { query: '😀'.repeat(128) }, { ...context, web });
    for (const args of [
      { query: '😀'.repeat(129) },
      { query: '   ' },
      { query: 'search', count: 51 },
      { query: 'search', count: 1.5 },
      { query: 'search', key: 'never accepted' },
    ]) {
      await expect(
        executeRegistered('web_search', args, { ...context, web }),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    }
    expect(web.search).toHaveBeenCalledTimes(1);
  });

  it('keeps empty results meaningful and bounds external content without losing included source URLs', () => {
    expect(webSearchText({ results: [] })).toContain('Results: 0');
    const results: WebSearchResult = {
      results: Array.from({ length: 50 }, (_, index) => ({
        ...source,
        url: `https://example.com/${index}`,
        content: 'large body '.repeat(25_000),
      })),
    };
    const searchText = webSearchText(results);
    expect(searchText.length).toBeLessThanOrEqual(100_000);
    expect(searchText).toContain('URL: https://example.com/0');
    expect(searchText).toContain('URL: https://example.com/49');
    expect(searchText).toContain('[Response truncated]');
    const pageText = webPageText({ url: source.url, title: 'Page', content: 'x'.repeat(500_000) });
    expect(pageText.length).toBeLessThanOrEqual(100_000);
    expect(pageText).toContain(source.url);
    expect(pageText).toContain('[Response truncated]');
  });

  it('includes raw provenance and truncation markers inside the complete output limit', () => {
    for (const redirectUrl of [undefined, source.url]) {
      const output = webRawText({
        url: new URL(source.url),
        status: 200,
        text: 'x'.repeat(100_000),
        ...(redirectUrl === undefined ? {} : { redirectUrl }),
      });
      expect(output.length).toBeLessThanOrEqual(100_000);
      expect(output).toContain(source.url);
      expect(output).toContain('[Response truncated]');
    }
  });

  it('propagates cancellation and provider failure without silently using raw fetch', async () => {
    const web = handlers();
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeRegistered(
        'web_search',
        { query: 'search' },
        {
          ...context,
          signal: controller.signal,
          web,
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(web.search).not.toHaveBeenCalled();
    const failing: WebToolHandlers = {
      ...web,
      fetchPage: () => Promise.reject(new Error('Provider unavailable')),
    };
    await expect(
      executeRegistered(
        'web_fetch',
        { mode: 'page', url: source.url },
        {
          ...context,
          web: failing,
        },
      ),
    ).rejects.toThrow('Provider unavailable');
  });
});
