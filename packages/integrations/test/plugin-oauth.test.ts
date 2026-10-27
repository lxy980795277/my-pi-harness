import { expect, it } from 'vitest';
import {
  beginPluginOAuth,
  pluginConnectionDefinition,
  refreshPluginOAuth,
  type PluginOAuthFetch,
} from '../src/index.js';

const signal = new AbortController().signal;
const client = {
  clientId: 'fixture-client',
  clientSecret: 'fixture-secret',
  callbackUrl: 'http://127.0.0.1:4311/callback',
};
function callback(url: string) {
  return new URLSearchParams({
    state: new URL(url).searchParams.get('state') ?? '',
    code: 'fixture-code',
  });
}
function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') throw new Error('Expected an encoded OAuth request body');
  return init.body;
}

it('Notion uses basic authentication, JSON code exchange, no PKCE and token-body workspace identity', async () => {
  const requests: RequestInit[] = [];
  const request: PluginOAuthFetch = (_id, _url, init) => {
    requests.push(init);
    return Promise.resolve(
      Response.json({
        access_token: 'notion-token',
        bot_id: 'bot-123',
        workspace_id: 'workspace-123',
        workspace_name: 'Fixture workspace',
        workspace_icon: null,
      }),
    );
  };
  const flow = await beginPluginOAuth(pluginConnectionDefinition('notion'), client, request);
  const url = new URL(flow.authorizationUrl);
  expect(url.searchParams.get('owner')).toBe('user');
  expect(url.searchParams.has('code_challenge')).toBe(false);
  const result = await flow.complete(callback(flow.authorizationUrl), signal);
  expect(result).toMatchObject({
    accessToken: 'notion-token',
    account: { id: 'bot-123', username: 'workspace-123', displayName: 'Fixture workspace' },
  });
  expect(requests).toHaveLength(1);
  const headers = new Headers(requests[0]?.headers);
  expect(headers.get('content-type')).toBe('application/json');
  expect(headers.get('authorization')).toBe(
    `Basic ${Buffer.from('fixture-client:fixture-secret').toString('base64')}`,
  );
  const submitted: unknown = JSON.parse(requestBody(requests[0]));
  expect(submitted).toEqual({
    grant_type: 'authorization_code',
    code: 'fixture-code',
    redirect_uri: client.callbackUrl,
  });
});

it('Vercel reads its POST userinfo profile and refresh keeps a refresh token omitted by the supplier', async () => {
  const calls: { url: URL; init: RequestInit }[] = [];
  const request: PluginOAuthFetch = (_id, url, init) => {
    calls.push({ url, init });
    if (url.pathname.endsWith('/userinfo'))
      return Promise.resolve(
        Response.json({
          sub: 'vercel-user',
          preferred_username: 'fixture-user',
          name: 'Fixture user',
        }),
      );
    return Promise.resolve(Response.json({ access_token: 'vercel-token', expires_in: 3600 }));
  };
  const definition = pluginConnectionDefinition('vercel');
  const flow = await beginPluginOAuth(definition, client, request);
  const result = await flow.complete(callback(flow.authorizationUrl), signal);
  expect(result.account).toMatchObject({ id: 'vercel-user', username: 'fixture-user' });
  expect(calls[1]?.init.method).toBe('POST');
  expect(new Headers(calls[1]?.init.headers).get('authorization')).toBe('Bearer vercel-token');
  const refreshed = await refreshPluginOAuth(
    definition,
    client,
    { accessToken: 'expired', refreshToken: 'existing-refresh' },
    signal,
    request,
  );
  expect(refreshed).toMatchObject({
    accessToken: 'vercel-token',
    refreshToken: 'existing-refresh',
  });
  expect(refreshed.expiresAt).toBeGreaterThan(Date.now());
});

it('Supabase supports PKCE and a plugin token without a profile endpoint', async () => {
  const calls: RequestInit[] = [];
  const request: PluginOAuthFetch = (_id, _url, init) => {
    calls.push(init);
    return Promise.resolve(Response.json({ access_token: 'supabase-token' }));
  };
  const flow = await beginPluginOAuth(pluginConnectionDefinition('supabase'), client, request);
  expect(new URL(flow.authorizationUrl).searchParams.get('code_challenge_method')).toBe('S256');
  expect(await flow.complete(callback(flow.authorizationUrl), signal)).toEqual({
    accessToken: 'supabase-token',
    account: null,
  });
  expect(calls).toHaveLength(1);
  expect(new URLSearchParams(requestBody(calls[0])).get('code_verifier')).toBeTruthy();
});
