import * as oauth from 'oauth4webapi';
import { createRemoteFetch } from '../network/remote-fetch';
import type { OAuthDefinition, OAuthClient, OAuthAccount } from './types';
import {
  OAuthError,
  OAuthRefreshRequiredError,
  oauthNetworkFailure,
  oauthProviderFailure,
  type OAuthPhase,
} from './errors';

export interface OAuthTokens {
  accessToken: string;
  scopes?: string[];
  refreshToken?: string;
  expiresAt?: number;
}
export interface OAuthFlow {
  state: string;
  authorizationUrl: string;
  complete(
    params: URLSearchParams,
    signal: AbortSignal,
  ): Promise<OAuthTokens & { account: OAuthAccount | null }>;
}
export type OAuthFetch = (subject: string, url: URL, init: RequestInit) => Promise<Response>;

/** Test origin rewriting is injected by the host and cannot be selected by an upstream URL. */
export function oauthFetch(fixtureOrigin?: string): OAuthFetch {
  return async (subject, url, init) => {
    let target = url;
    if (fixtureOrigin !== undefined)
      target = new URL(`/${subject}${url.pathname}${url.search}`, fixtureOrigin);
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
  phase: OAuthPhase,
  upstreamStatus?: number,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new OAuthError(phase, 'invalid-response', upstreamStatus);
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
function required(value: unknown, name: string, phase: OAuthPhase): string {
  const content = field(value, name);
  if (
    (typeof content !== 'string' && typeof content !== 'number') ||
    String(content).length === 0 ||
    String(content).length > 65536
  )
    throw new OAuthError(phase, 'invalid-response');
  return String(content);
}
function optional(value: unknown, name: string | undefined): string | null {
  if (name === undefined) return null;
  const content = field(value, name);
  if (typeof content !== 'string' || content.length === 0 || content.length > 4096) return null;
  return content;
}
async function json(response: Response, phase: OAuthPhase, signal: AbortSignal): Promise<unknown> {
  try {
    return await response.json();
  } catch (error: unknown) {
    if (error instanceof SyntaxError) throw new OAuthError(phase, 'invalid-json', response.status);
    throw oauthNetworkFailure(phase, error, signal, response.status);
  }
}
async function requestResponse(
  definition: OAuthDefinition,
  phase: OAuthPhase,
  url: URL,
  init: RequestInit,
  signal: AbortSignal,
  request: OAuthFetch,
): Promise<Response> {
  try {
    return await request(definition.id, url, { ...init, signal });
  } catch (error: unknown) {
    throw oauthNetworkFailure(phase, error, signal);
  }
}
async function tokenRequest(
  definition: OAuthDefinition,
  client: OAuthClient,
  body: URLSearchParams,
  signal: AbortSignal,
  request: OAuthFetch,
): Promise<Record<string, unknown>> {
  const headers = new Headers({ Accept: 'application/json' });
  const authentication =
    client.clientSecret === undefined
      ? oauth.None()
      : definition.oauth.tokenAuth === 'basic'
        ? oauth.ClientSecretBasic(client.clientSecret)
        : oauth.ClientSecretPost(client.clientSecret);
  await authentication(
    { issuer: definition.oauth.issuer },
    { client_id: client.clientId },
    body,
    headers,
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
    throw new OAuthRefreshRequiredError();
  if (parsed.error !== undefined)
    throw new OAuthError('token-exchange', oauthProviderFailure(parsed.error), response.status);
  if (
    response.status !== 200 ||
    typeof parsed.access_token !== 'string' ||
    parsed.access_token.length === 0 ||
    parsed.access_token.length > 65536
  )
    throw new OAuthError(
      'token-exchange',
      response.ok ? 'invalid-response' : 'upstream-http',
      response.status,
    );
  const validationBody = { ...parsed };
  if (
    definition.oauth.responsePolicy?.allowMissingTokenType &&
    validationBody['token_type'] === undefined
  )
    validationBody['token_type'] = 'bearer';
  if (
    definition.oauth.responsePolicy?.displayOnlyIdToken &&
    validationBody['id_token'] !== undefined
  ) {
    if (typeof validationBody['id_token'] !== 'string' || validationBody['id_token'].length === 0)
      throw new OAuthError('token-exchange', 'invalid-response', response.status);
    delete validationBody['id_token'];
  }
  try {
    const source = new Response(JSON.stringify(validationBody), {
      status: response.status,
      headers: response.headers,
    });
    const server = { issuer: definition.oauth.issuer };
    const registration = { client_id: client.clientId };
    const validated =
      body.get('grant_type') === 'refresh_token'
        ? await oauth.processRefreshTokenResponse(server, registration, source)
        : await oauth.processAuthorizationCodeResponse(server, registration, source);
    if (validated.token_type !== 'bearer')
      throw new OAuthError('token-exchange', 'invalid-response', response.status);
    return { ...parsed, ...validated };
  } catch {
    throw new OAuthError('token-exchange', 'invalid-response', response.status);
  }
}
function tokens(body: Record<string, unknown>, previousRefresh?: string): OAuthTokens {
  const output: OAuthTokens = {
    accessToken: required(body, 'access_token', 'token-exchange'),
  };
  const refresh = body.refresh_token;
  if (refresh !== undefined) {
    if (typeof refresh !== 'string' || refresh.length === 0 || refresh.length > 65536)
      throw new OAuthError('token-exchange', 'invalid-response');
    output.refreshToken = refresh;
  } else if (previousRefresh !== undefined) output.refreshToken = previousRefresh;
  if (body.expires_in !== undefined) {
    const expiresIn = body.expires_in;
    if (
      typeof expiresIn !== 'number' ||
      !Number.isFinite(expiresIn) ||
      expiresIn < 0 ||
      expiresIn > 315_576_000
    )
      throw new OAuthError('token-exchange', 'invalid-response');
    output.expiresAt = Date.now() + Math.floor(expiresIn * 1000);
  }
  if (body.scope !== undefined) {
    if (typeof body.scope !== 'string') throw new OAuthError('token-exchange', 'invalid-response');
    const scopes = body.scope.split(/[ ,]+/).filter(Boolean);
    if (scopes.length > 100 || scopes.some((value) => value.length > 256))
      throw new OAuthError('token-exchange', 'invalid-response');
    output.scopes = scopes;
  }
  return output;
}
async function account(
  definition: OAuthDefinition,
  body: Record<string, unknown>,
  signal: AbortSignal,
  request: OAuthFetch,
): Promise<OAuthAccount | null> {
  const profile = definition.oauth.profile;
  if (profile === undefined) return null;
  let source: unknown = body;
  if (profile.source === 'id-token') {
    const idToken = required(body, 'id_token', 'account');
    const payload = idToken.split('.')[1];
    if (payload === undefined) throw new OAuthError('account', 'invalid-response');
    try {
      source = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw new OAuthError('account', 'invalid-json');
    }
  } else if (profile.source === 'userinfo') {
    if (profile.path === undefined) throw new OAuthError('account', 'invalid-response');
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
    if (!response.ok) throw new OAuthError('account', 'upstream-http', response.status);
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
    throw new OAuthError('account', 'invalid-response');
  return { id, username, displayName: optional(source, profile.displayNameField), avatarUrl };
}

/** A single-use authorization-code flow; its caller owns lifetime and account identity. */
export async function beginOAuth(
  definition: OAuthDefinition,
  client: OAuthClient,
  request: OAuthFetch = oauthFetch(),
): Promise<OAuthFlow> {
  if (!client.clientId || client.callbackUrl === undefined)
    throw new OAuthError('authorization-response', 'client-unconfigured');
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
      if (consumed) throw new OAuthError('authorization-response', 'invalid-state');
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
          throw new OAuthError('authorization-response', 'invalid-state');
        const issuers = params.getAll('iss');
        if (issuers.length === 1 && issuers[0] && issuers[0] !== definition.oauth.issuer)
          throw new OAuthError('authorization-response', 'issuer-mismatch');
        if (error instanceof oauth.AuthorizationResponseError)
          throw new OAuthError('authorization-response', oauthProviderFailure(params.get('error')));
        throw new OAuthError('authorization-response', 'invalid-response');
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

export async function refreshOAuth(
  definition: OAuthDefinition,
  client: OAuthClient,
  previous: OAuthTokens,
  signal: AbortSignal,
  request: OAuthFetch = oauthFetch(),
): Promise<OAuthTokens> {
  if (previous.refreshToken === undefined) throw new OAuthRefreshRequiredError();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: previous.refreshToken,
  });
  return tokens(
    await tokenRequest(definition, client, body, signal, request),
    previous.refreshToken,
  );
}
