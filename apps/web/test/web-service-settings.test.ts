import type { WebServiceStatus } from '@my-pi-harness/protocol';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { createElement, type FC } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSearchSettings } from '../src/features/web-search/components/web-search-settings';
import { useWebSearchSettings } from '../src/features/web-search/hooks/use-web-search-settings';
import {
  deleteWebCredential,
  fetchWebServiceStatus,
  saveWebCredential,
} from '../src/features/web-search/services/web-search';
import { setCsrfToken } from '../src/services/base-request';

const STATUS: WebServiceStatus = { provider: 'deepseek', configured: true };

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

const respond = (data: unknown) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => {
    return Promise.resolve(
      new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

describe('independent web service settings', () => {
  it('uses authenticated write-only credential endpoints and parses only public availability', async () => {
    const fetch = respond(STATUS);
    setCsrfToken('fixture-csrf');
    const signal = new AbortController().signal;
    await expect(fetchWebServiceStatus(signal)).resolves.toEqual(STATUS);
    await expect(saveWebCredential('fake-official-key', signal)).resolves.toEqual(STATUS);
    await expect(deleteWebCredential(signal)).resolves.toEqual(STATUS);
    expect(fetch.mock.calls.map(([path]) => path)).toEqual([
      '/api/web/status',
      '/api/web/credential',
      '/api/web/credential',
    ]);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'fake-official-key' }),
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': 'fixture-csrf' },
    });
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({ method: 'DELETE', body: '{}' });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', cache: 'no-store' });
  });

  it('rejects extra credential bytes returned by the server and does not retry a failed secret write', async () => {
    respond({ ...STATUS, apiKey: 'must-not-be-cached' });
    await expect(fetchWebServiceStatus(new AbortController().signal)).rejects.toThrow();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: 'WEB_NOT_CONFIGURED', message: 'Key 保存失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(saveWebCredential('fake-key', new AbortController().signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([true, false])(
    'renders configured=%s without a saved secret or model configuration',
    (configured) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(['web-service-status'], { ...STATUS, configured });
      try {
        const html = renderToStaticMarkup(
          createElement(QueryClientProvider, { client }, createElement(WebSearchSettings)),
        );
        expect(html).toContain('联网搜索');
        expect(html).toContain('独立于对话模型配置');
        expect(html).toContain('type="password"');
        expect(html).toContain('value=""');
        expect(html).toContain('autoComplete="new-password"');
        expect(html).not.toContain('baseUrl');
        expect(html.includes('移除 Key')).toBe(configured);
        if (configured) expect(html).toContain('已配置');
        else expect(html).toContain('未配置');
        expect(client.getMutationCache().getAll()).toEqual([]);
      } finally {
        client.clear();
      }
    },
  );

  it('uses the returned removal status without an extra GET or mutation variables', async () => {
    const fetch = respond({ ...STATUS, configured: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['web-service-status'], STATUS);
    const observer = new QueryObserver(client, {
      queryKey: ['web-service-status'],
      queryFn: ({ signal }) => fetchWebServiceStatus(signal),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    let state: ReturnType<typeof useWebSearchSettings> | undefined;
    const Probe: FC = () => {
      state = useWebSearchSettings();
      return null;
    };
    renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe)));
    if (state === undefined) throw new Error('Settings hook did not render');
    try {
      state.remove();
      state.remove();
      await vi.waitFor(() => {
        expect(client.getQueryData(['web-service-status'])).toEqual({
          ...STATUS,
          configured: false,
        });
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(client.getMutationCache().getAll()).toEqual([]);
      expect(
        JSON.stringify(
          client
            .getQueryCache()
            .getAll()
            .map((query) => query.state.data),
        ),
      ).not.toContain('apiKey');
    } finally {
      unsubscribe();
      client.clear();
    }
  });

  it('reconciles a failed credential write by rereading status without retrying the write', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((url, init) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve(
          Response.json(
            { code: 'WEB_CREDENTIAL_UNAVAILABLE', message: '写入结果未知' },
            { status: 503 },
          ),
        );
      }
      if (url !== '/api/web/status') throw new Error('Unexpected fixture request');
      return Promise.resolve(Response.json({ ...STATUS, configured: false }));
    });
    vi.stubGlobal('fetch', fetch);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['web-service-status'], STATUS);
    const observer = new QueryObserver(client, {
      queryKey: ['web-service-status'],
      queryFn: ({ signal }) => fetchWebServiceStatus(signal),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    let state: ReturnType<typeof useWebSearchSettings> | undefined;
    const Probe: FC = () => {
      state = useWebSearchSettings();
      return null;
    };
    renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe)));
    if (state === undefined) throw new Error('Settings hook did not render');
    try {
      state.remove();
      await vi.waitFor(() => {
        expect(client.getQueryData(['web-service-status'])).toEqual({
          ...STATUS,
          configured: false,
        });
      });
      expect(fetch.mock.calls.map(([path]) => path)).toEqual([
        '/api/web/credential',
        '/api/web/status',
      ]);
      expect(fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
      expect(client.getMutationCache().getAll()).toEqual([]);
    } finally {
      unsubscribe();
      client.clear();
    }
  });
});
