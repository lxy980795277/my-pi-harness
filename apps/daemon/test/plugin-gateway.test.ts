import {
  pluginConnectionDefinition,
  type PluginConnectionDefinition,
} from '@my-pi-harness/integrations';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPluginGateway } from '../src/plugin-connections/gateway.js';

function definition(id: string): PluginConnectionDefinition {
  const found = pluginConnectionDefinition(id);
  if (found === undefined) throw new Error('Missing built-in connection definition');
  return found;
}

function requestUrl(value: Parameters<typeof globalThis.fetch>[0] | undefined): string {
  if (!(value instanceof URL)) throw new Error('Expected an upstream URL');
  return value.href;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('plugin read-only gateway', () => {
  it('forwards an allowed read to its fixed origin with the plugin token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response('{"login":"fixture"}', {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const result = await requestPluginGateway(
      definition('github'),
      'private-token',
      'repos/owner/repo/pulls/3',
      '?page=2',
    );
    expect(result.body.toString()).toBe('{"login":"fixture"}');
    expect(result.statusCode).toBe(200);
    expect(result.contentType).toBe('application/json');
    const [url, options] = fetch.mock.calls[0] ?? [];
    expect(requestUrl(url)).toBe('https://api.github.com/repos/owner/repo/pulls/3?page=2');
    expect(options).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: 'Bearer private-token', Accept: 'application/vnd.github+json' },
    });
    expect(JSON.stringify(result)).not.toContain('private-token');
  });

  it('rejects forbidden paths, normalized escapes and blocked query values before fetching', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    for (const path of [
      'login/oauth/access_token',
      'repos/a/b/../../../login/oauth/access_token',
    ]) {
      await expect(
        requestPluginGateway(definition('github'), 'private-token', path, ''),
      ).rejects.toMatchObject({ code: 'SKILL_GATEWAY_PATH_INVALID' });
    }
    await expect(
      requestPluginGateway(
        definition('vercel'),
        'private-token',
        'v9/projects/a/env',
        '?decrypt=false&decrypt=true',
      ),
    ).rejects.toMatchObject({ code: 'SKILL_GATEWAY_PATH_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps only declared read queries to JSON POST and preserves upstream failure status', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response('{"results":[]}', { status: 403 })),
    );
    vi.stubGlobal('fetch', fetch);
    const result = await requestPluginGateway(
      definition('notion'),
      'private-token',
      'v1/search',
      '?query=weekly&ignored=value',
    );
    expect(result.statusCode).toBe(403);
    const [url, options] = fetch.mock.calls[0] ?? [];
    expect(requestUrl(url)).toBe('https://api.notion.com/v1/search');
    expect(options).toMatchObject({ method: 'POST', body: '{"query":"weekly"}' });
  });

  it('bounds streamed responses and does not expose credential-bearing fetch errors', async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024);
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        ),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(
      requestPluginGateway(definition('github'), 'private-token', 'user', ''),
    ).rejects.toThrow('5 MiB');
    fetch.mockRejectedValue(new Error('Request failed: Authorization Bearer private-token'));
    await expect(
      requestPluginGateway(definition('github'), 'private-token', 'user', ''),
    ).rejects.toThrow('无法读取');
    const controller = new AbortController();
    controller.abort(new Error('caller cancelled'));
    await expect(
      requestPluginGateway(definition('github'), 'private-token', 'user', '', controller.signal),
    ).rejects.toThrow('caller cancelled');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
