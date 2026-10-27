import * as oauth from 'oauth4webapi';
import type { SkillConnectionAccount } from '@my-pi-harness/protocol';
import { SkillError } from '../skills/errors.js';
import { createRemoteFetch } from '../remote-network.js';
import type { PluginConnectionDefinition, PluginOAuthClient } from './connections.js';
import {
  PluginOAuthError,
  pluginOAuthNetworkFailure,
  pluginOAuthProviderFailure,
  type PluginOAuthPhase,
} from './oauth-errors.js';

export interface PluginOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}
export interface PluginOAuthFlow {
  state: string;
  authorizationUrl: string;
  complete(
    params: URLSearchParams,
    signal: AbortSignal,
  ): Promise<PluginOAuthTokens & { account: SkillConnectionAccount | null }>;
}
export type PluginOAuthFetch = (pluginId: string, url: URL, init: RequestInit) => Promise<Response>;

/** Test rewriting is host-injected and never read from a plugin request or URL. */
export function pluginOAuthFetch(fixtureOrigin?: string): PluginOAuthFetch {
  return async (pluginId, url, init) => {
    let target = url;
    if (fixtureOrigin !== undefined)
      target = new URL(`/${pluginId}${url.pathname}${url.search}`, fixtureOrigin);
    const request = createRemoteFetch({
      allowedOrigins: new Set([target.origin]),
      maximumResponseBytes: 2_000_000,
      ...(fixtureOrigin === undefined ? {} : { fixtureOrigin }),
    });
    return await request(target, init);
  };
}
function record(
  value: unknown,
  phase: PluginOAuthPhase,
  upstreamStatus?: number,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new PluginOAuthError(phase, 'invalid-response', upstreamStatus);
  return value as Record<string, unknown>;
}
function field(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
function required(value: unknown, name: string, phase: PluginOAuthPhase): string {
  const content = field(value, name);
  if (
    (typeof content !== 'string' && typeof content !== 'number') ||
    String(content).length === 0 ||
    String(content).length > 65536
  )
    throw new PluginOAuthError(phase, 'invalid-response');
  return String(content);
}
function optional(value: unknown, name: string | undefined): string | null {
  if (name === undefined) return null;
  const content = field(value, name);
  if (typeof content !== 'string' || content.length === 0 || content.length > 4096) return null;
  return content;
}
async function json(
  response: Response,
  phase: PluginOAuthPhase,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await response.json();
  } catch (error: unknown) {
    if (error instanceof SyntaxError)
      throw new PluginOAuthError(phase, 'invalid-json', response.status);
    throw pluginOAuthNetworkFailure(phase, error, signal, response.status);
  }
}
async function requestResponse(
  definition: PluginConnectionDefinition,
  phase: PluginOAuthPhase,
  url: URL,
  init: RequestInit,
  signal: AbortSignal,
  request: PluginOAuthFetch,
): Promise<Response> {
  try {
    return await request(definition.id, url, { ...init, signal });
  } catch (error: unknown) {
    throw pluginOAuthNetworkFailure(phase, error, signal);
  }
}
async function tokenRequest(
  definition: PluginConnectionDefinition,
  client: PluginOAuthClient,
  body: URLSearchParams,
  signal: AbortSignal,
  request: PluginOAuthFetch,
): Promise<Record<string, unknown>> {
  const headers = new Headers({ Accept: 'application/json' });
  if (definition.oauth.tokenAuth === 'body') {
    body.set('client_id', client.clientId);
    body.set('client_secret', client.clientSecret);
  } else
    headers.set(
      'Authorization',
      `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}`,
    );
  let encoded: string;
  if (definition.oauth.tokenFormat === 'json') {
    headers.set('Content-Type', 'application/json');
    encoded = JSON.stringify(Object.fromEntries(body));
  } else {
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
    encoded = body.toString();
  }
  const owned = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const response = await requestResponse(
    definition,
    'token-exchange',
    new URL(definition.oauth.tokenEndpoint),
    {
      method: 'POST',
      headers,
      body: encoded,
    },
    owned,
    request,
  );
  const parsed = record(
    await json(response, 'token-exchange', owned),
    'token-exchange',
    response.status,
  );
  if (
    body.get('grant_type') === 'refresh_token' &&
    typeof parsed.error === 'string' &&
    ['invalid_grant', 'invalid_token', 'bad_refresh_token'].includes(parsed.error)
  )
    throw new SkillError('SKILL_CONNECTION_REQUIRED', '服务授权已失效，请重新授权。');
  if (parsed.error !== undefined)
    throw new PluginOAuthError(
      'token-exchange',
      pluginOAuthProviderFailure(parsed.error),
      response.status,
    );
  if (
    !response.ok ||
    typeof parsed.access_token !== 'string' ||
    parsed.access_token.length === 0 ||
    parsed.access_token.length > 65536
  )
    throw new PluginOAuthError(
      'token-exchange',
      response.ok ? 'invalid-response' : 'upstream-http',
      response.status,
    );
  return parsed;
}
function tokens(body: Record<string, unknown>, previousRefresh?: string): PluginOAuthTokens {
  const output: PluginOAuthTokens = {
    accessToken: required(body, 'access_token', 'token-exchange'),
  };
  const refresh = optional(body, 'refresh_token') ?? previousRefresh;
  if (refresh !== undefined) output.refreshToken = refresh;
  const expiresIn = Number(body.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0 && expiresIn < 315_576_000)
    output.expiresAt = Date.now() + Math.floor(expiresIn * 1000);
  return output;
}
async function account(
  definition: PluginConnectionDefinition,
  body: Record<string, unknown>,
  signal: AbortSignal,
  request: PluginOAuthFetch,
): Promise<SkillConnectionAccount | null> {
  const profile = definition.oauth.profile;
  if (profile === undefined) return null;
  let source: unknown = body;
  if (profile.source === 'id-token') {
    const idToken = required(body, 'id_token', 'account');
    const payload = idToken.split('.')[1];
    if (payload === undefined) throw new PluginOAuthError('account', 'invalid-response');
    try {
      source = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw new PluginOAuthError('account', 'invalid-json');
    }
  } else if (profile.source === 'userinfo') {
    if (profile.path === undefined) throw new PluginOAuthError('account', 'invalid-response');
    const owned = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    const response = await requestResponse(
      definition,
      'account',
      new URL(profile.path, definition.apiUrl),
      {
        method: profile.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${required(body, 'access_token', 'account')}`,
          'User-Agent': 'my-pi-harness-skill-gateway',
        },
      },
      owned,
      request,
    );
    if (!response.ok) throw new PluginOAuthError('account', 'upstream-http', response.status);
    source = await json(response, 'account', owned);
  }
  const avatar = optional(source, profile.avatarUrlField);
  let avatarUrl: string | null = null;
  if (avatar !== null) {
    try {
      const url = new URL(avatar);
      if (url.protocol === 'https:' || url.protocol === 'http:') avatarUrl = url.toString();
    } catch {
      /* Invalid provider avatars are absent from the public account. */
    }
  }
  const id = required(source, profile.idField, 'account');
  const username = required(source, profile.usernameField, 'account');
  if (id.length > 1000 || username.length > 1000)
    throw new PluginOAuthError('account', 'invalid-response');
  return { id, username, displayName: optional(source, profile.displayNameField), avatarUrl };
}

/** The flow consumes state once; the service owns its ten-minute lifetime and installation identity. */
export async function beginPluginOAuth(
  definition: PluginConnectionDefinition,
  client: PluginOAuthClient,
  request: PluginOAuthFetch = pluginOAuthFetch(),
): Promise<PluginOAuthFlow> {
  if (!client.clientId || !client.clientSecret || client.callbackUrl === undefined)
    throw new PluginOAuthError('authorization-response', 'client-unconfigured');
  const state = oauth.generateRandomState();
  const verifier = oauth.generateRandomCodeVerifier();
  const url = new URL(definition.oauth.authorizationEndpoint);
  for (const [key, value] of Object.entries(definition.oauth.authorizationParams ?? {}))
    url.searchParams.set(key, value);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', client.callbackUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (definition.oauth.scopes.length > 0)
    url.searchParams.set('scope', definition.oauth.scopes.join(' '));
  if (definition.oauth.pkce) {
    url.searchParams.set('code_challenge', await oauth.calculatePKCECodeChallenge(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  let consumed = false;
  return {
    state,
    authorizationUrl: url.toString(),
    async complete(params, signal) {
      if (consumed) throw new PluginOAuthError('authorization-response', 'invalid-state');
      consumed = true;
      try {
        oauth.validateAuthResponse(
          { issuer: definition.oauth.issuer },
          { client_id: client.clientId },
          params,
          state,
        );
      } catch (error: unknown) {
        if (params.get('state') !== state)
          throw new PluginOAuthError('authorization-response', 'invalid-state');
        const issuers = params.getAll('iss');
        if (issuers.length === 1 && issuers[0] && issuers[0] !== definition.oauth.issuer)
          throw new PluginOAuthError('authorization-response', 'issuer-mismatch');
        if (error instanceof oauth.AuthorizationResponseError)
          throw new PluginOAuthError(
            'authorization-response',
            pluginOAuthProviderFailure(params.get('error')),
          );
        throw new PluginOAuthError('authorization-response', 'invalid-response');
      }
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: required(Object.fromEntries(params), 'code', 'authorization-response'),
        redirect_uri: client.callbackUrl ?? '',
      });
      if (definition.oauth.pkce) body.set('code_verifier', verifier);
      const result = await tokenRequest(definition, client, body, signal, request);
      return { ...tokens(result), account: await account(definition, result, signal, request) };
    },
  };
}

export async function refreshPluginOAuth(
  definition: PluginConnectionDefinition,
  client: PluginOAuthClient,
  previous: PluginOAuthTokens,
  signal: AbortSignal,
  request: PluginOAuthFetch = pluginOAuthFetch(),
): Promise<PluginOAuthTokens> {
  if (previous.refreshToken === undefined)
    throw new SkillError('SKILL_CONNECTION_REQUIRED', '服务授权已过期，请重新授权。');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: previous.refreshToken,
  });
  return tokens(
    await tokenRequest(definition, client, body, signal, request),
    previous.refreshToken,
  );
}
