import { expect, it } from 'vitest';
import {
  beginPluginOAuth,
  pluginConnectionDefinition,
  type PluginOAuthFetch,
} from '../src/index.js';

const client = {
  clientId: 'fixture-client',
  clientSecret: 'fixture-secret',
  callbackUrl: 'http://127.0.0.1:4311/callback',
};
const providers = [
  { id: 'github', issuer: 'https://github.com/login/oauth' },
  { id: 'google', issuer: 'https://accounts.google.com' },
] as const;

function upstream() {
  const calls: URL[] = [];
  const request: PluginOAuthFetch = (_id, url) => {
    calls.push(url);
    if (url.pathname === '/user')
      return Promise.resolve(Response.json({ id: 123, login: 'fixture-user' }));
    return Promise.resolve(
      Response.json({
        access_token: 'fixture-token',
        id_token: `header.${Buffer.from(JSON.stringify({ sub: 'google-user', email: 'fixture@example.com' })).toString('base64url')}.signature`,
      }),
    );
  };
  return { request, calls };
}

it.each(providers)(
  'accepts $id callback issuer $issuer before exchanging the code',
  async ({ id, issuer }) => {
    const provider = upstream();
    const flow = await beginPluginOAuth(pluginConnectionDefinition(id), client, provider.request);
    const result = await flow.complete(
      new URLSearchParams({ state: flow.state, code: 'fixture-code', iss: issuer }),
      new AbortController().signal,
    );
    expect(result.accessToken).toBe('fixture-token');
    expect(provider.calls.length).toBeGreaterThan(0);
  },
);

it.each(providers)('retains $id callbacks without an optional issuer', async ({ id }) => {
  const provider = upstream();
  const flow = await beginPluginOAuth(pluginConnectionDefinition(id), client, provider.request);
  await expect(
    flow.complete(
      new URLSearchParams({ state: flow.state, code: 'fixture-code' }),
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ accessToken: 'fixture-token' });
});

it.each([
  { id: 'github', issuer: 'https://github.com' },
  { id: 'github', issuer: 'https://untrusted.example/private-issuer-code-token' },
  { id: 'google', issuer: 'https://accounts.google.com/' },
])('rejects $id issuer mismatch before any upstream request', async ({ id, issuer }) => {
  const provider = upstream();
  const flow = await beginPluginOAuth(pluginConnectionDefinition(id), client, provider.request);
  const completion = flow.complete(
    new URLSearchParams({ state: flow.state, code: 'fixture-code', iss: issuer }),
    new AbortController().signal,
  );
  await expect(completion).rejects.toMatchObject({
    phase: 'authorization-response',
    reason: 'issuer-mismatch',
  });
  await expect(completion).rejects.not.toHaveProperty('cause');
  await expect(completion).rejects.toHaveProperty('message', expect.not.stringContaining(issuer));
  expect(provider.calls).toHaveLength(0);
});

it.each(providers)(
  'still rejects $id state mismatch with the correct issuer',
  async ({ id, issuer }) => {
    const provider = upstream();
    const flow = await beginPluginOAuth(pluginConnectionDefinition(id), client, provider.request);
    await expect(
      flow.complete(
        new URLSearchParams({ state: 'wrong-state', code: 'fixture-code', iss: issuer }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ phase: 'authorization-response', reason: 'invalid-state' });
    expect(provider.calls).toHaveLength(0);
  },
);
