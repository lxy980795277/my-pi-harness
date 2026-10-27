import { expect, it } from 'vitest';
import {
  beginPluginOAuth,
  refreshPluginOAuth,
  pluginConnectionDefinition,
  PluginOAuthError,
  McpError,
  type PluginOAuthFetch,
  type PluginOAuthFailureReason,
} from '../src/index.js';

const SECRET = 'sensitive-provider-token-code-state-client-secret';
const client = {
  clientId: 'fixture-client',
  clientSecret: SECRET,
  callbackUrl: 'http://127.0.0.1:4311/api/skill-connections/github/oauth/callback',
};
const signal = new AbortController().signal;
function safe(error: PluginOAuthError): void {
  expect(JSON.stringify({ ...error, message: error.message, stack: error.stack })).not.toContain(
    SECRET,
  );
  expect('cause' in error).toBe(false);
  expect(error.code).toBe('SKILL_OAUTH_FAILED');
}
async function failure(
  request: PluginOAuthFetch,
  caller = signal,
  provider = 'github',
): Promise<PluginOAuthError> {
  const flow = await beginPluginOAuth(pluginConnectionDefinition(provider), client, request);
  try {
    await flow.complete(new URLSearchParams({ state: flow.state, code: SECRET }), caller);
  } catch (error: unknown) {
    if (!(error instanceof PluginOAuthError))
      throw new Error('Expected a safe plugin OAuth failure');
    safe(error);
    return error;
  }
  throw new Error('Expected OAuth to fail');
}

it.each([
  ['incorrect_client_credentials', 'incorrect-client-credentials'],
  ['redirect_uri_mismatch', 'redirect-uri-mismatch'],
  ['bad_verification_code', 'bad-verification-code'],
  ['unverified_user_email', 'unverified-user-email'],
  ['access_denied', 'access-denied'],
] as const)(
  'classifies known provider error %s without retaining descriptions or response fields',
  async (providerError, reason) => {
    const error = await failure(() =>
      Promise.resolve(
        Response.json(
          {
            error: providerError,
            error_description: SECRET,
            code: SECRET,
            state: SECRET,
            client_secret: SECRET,
          },
          { status: 400 },
        ),
      ),
    );
    expect(error).toMatchObject({ phase: 'token-exchange', reason, upstreamStatus: 400 });
  },
);

it('reduces unknown provider error text to an owned message and finite reason', async () => {
  const error = await failure(() =>
    Promise.resolve(Response.json({ error: SECRET, error_description: SECRET }, { status: 400 })),
  );
  expect(error).toMatchObject({
    phase: 'token-exchange',
    reason: 'provider-error',
    upstreamStatus: 400,
  });
});

it('rejects a 200 error response even when it includes an access token and never requests account data', async () => {
  let requests = 0;
  const error = await failure(() => {
    requests += 1;
    return Promise.resolve(
      Response.json({
        error: 'incorrect_client_credentials',
        error_description: SECRET,
        access_token: SECRET,
      }),
    );
  });
  expect(error).toMatchObject({
    phase: 'token-exchange',
    reason: 'incorrect-client-credentials',
    upstreamStatus: 200,
  });
  expect(requests).toBe(1);
});

it.each([
  ['DNS_FAILED', 'dns-failed'],
  ['PRIVATE_NETWORK', 'private-network'],
  ['NETWORK_FAILED', 'network-failed'],
  ['CANCELLED', 'cancelled'],
] as const)('classifies %s without exposing the transport message', async (code, reason) => {
  const error = await failure(() => Promise.reject(new McpError(code, SECRET)));
  expect(error).toMatchObject({ phase: 'token-exchange', reason });
  expect(error.upstreamStatus).toBeUndefined();
});

it('discards unknown network error properties and nested credential-bearing causes', async () => {
  const error = await failure(() =>
    Promise.reject(new Error(SECRET, { cause: { access_token: SECRET, client_secret: SECRET } })),
  );
  expect(error).toMatchObject({ phase: 'token-exchange', reason: 'network-failed' });
});

it.each([
  ['TimeoutError', 'timeout'],
  ['AbortError', 'cancelled'],
] as const)('classifies a caller %s without retaining its reason text', async (name, reason) => {
  const aborted = AbortSignal.abort(new DOMException(SECRET, name));
  const error = await failure(() => Promise.reject(new Error(SECRET)), aborted);
  expect(error.reason).toBe(reason);
});

it.each([
  ['invalid-json', () => new Response(SECRET, { status: 200 })],
  ['invalid-response', () => Response.json([SECRET], { status: 200 })],
  ['invalid-response', () => Response.json({ unrecognized: SECRET }, { status: 200 })],
  ['upstream-http', () => Response.json({ unrecognized: SECRET }, { status: 503 })],
] satisfies [PluginOAuthFailureReason, () => Response][])(
  'distinguishes %s from network or token rejection failures',
  async (reason, response) => {
    const error = await failure(() => Promise.resolve(response()));
    expect(error).toMatchObject({ phase: 'token-exchange', reason });
  },
);

it.each(['invalid-state', 'access-denied', 'provider-error'] as const)(
  'keeps callback %s diagnostics free of code, state and descriptions',
  async (reason) => {
    const flow = await beginPluginOAuth(pluginConnectionDefinition('github'), client, () =>
      Promise.reject(new Error('The callback must fail before any network request')),
    );
    const params = new URLSearchParams({
      state: flow.state,
      code: SECRET,
      error_description: SECRET,
    });
    if (reason === 'invalid-state') params.set('state', SECRET);
    else if (reason === 'access-denied') params.set('error', 'access_denied');
    else params.set('error', SECRET);
    let caught: unknown;
    try {
      await flow.complete(params, signal);
    } catch (error: unknown) {
      caught = error;
    }
    if (!(caught instanceof PluginOAuthError)) throw new Error('Expected a safe callback failure');
    safe(caught);
    expect(caught).toMatchObject({ phase: 'authorization-response', reason });
  },
);

it.each(['upstream-http', 'invalid-json', 'invalid-response', 'network-failed'] as const)(
  'identifies account-stage %s after a successful code exchange',
  async (reason) => {
    const error = await failure((_id, url) => {
      if (url.pathname !== '/user') return Promise.resolve(Response.json({ access_token: SECRET }));
      if (reason === 'upstream-http') return Promise.resolve(new Response(SECRET, { status: 403 }));
      if (reason === 'invalid-json') return Promise.resolve(new Response(SECRET));
      if (reason === 'invalid-response')
        return Promise.resolve(Response.json({ missing_account: SECRET }));
      return Promise.reject(new Error(SECRET, { cause: SECRET }));
    });
    expect(error).toMatchObject({ phase: 'account', reason });
    if (reason === 'upstream-http') expect(error.upstreamStatus).toBe(403);
  },
);

it('preserves the disconnected outcome for an invalid refresh grant', async () => {
  let caught: unknown;
  try {
    await refreshPluginOAuth(
      pluginConnectionDefinition('github'),
      client,
      { accessToken: SECRET, refreshToken: SECRET },
      signal,
      () =>
        Promise.resolve(
          Response.json({ error: 'invalid_grant', error_description: SECRET }, { status: 400 }),
        ),
    );
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toMatchObject({ code: 'SKILL_CONNECTION_REQUIRED' });
  expect(caught).not.toBeInstanceOf(PluginOAuthError);
  if (!(caught instanceof Error)) throw new Error('Expected a disconnected error');
  expect(JSON.stringify({ ...caught, message: caught.message, stack: caught.stack })).not.toContain(
    SECRET,
  );
});

it.each(['github', 'google'])('retains the successful %s authorization flow', async (provider) => {
  const flow = await beginPluginOAuth(pluginConnectionDefinition(provider), client, (_id, url) => {
    if (url.pathname === '/user')
      return Promise.resolve(
        Response.json({ id: 123, login: 'fixture-user', name: 'Fixture user' }),
      );
    return Promise.resolve(
      Response.json({
        access_token: 'fixture-token',
        ...(provider === 'google'
          ? {
              id_token: `header.${Buffer.from(JSON.stringify({ sub: 'google-user', email: 'fixture@example.com' })).toString('base64url')}.signature`,
            }
          : {}),
      }),
    );
  });
  const result = await flow.complete(
    new URLSearchParams({ state: flow.state, code: 'fixture-code' }),
    signal,
  );
  expect(result.accessToken).toBe('fixture-token');
  expect(result.account?.id).toBe(provider === 'github' ? '123' : 'google-user');
});
