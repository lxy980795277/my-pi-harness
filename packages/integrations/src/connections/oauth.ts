import * as oauth from 'oauth4webapi';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { ConnectionProvider } from './providers.js';
import { createRemoteFetch } from '../remote-network.js';

/** This secret JSON is only written through the system CredentialStore. */
export const ConnectionCredentialSchema = Type.Object(
  {
    version: Type.Literal(1),
    clientSecret: Type.Optional(Type.String({ minLength: 1, maxLength: 65536 })),
    accessToken: Type.Optional(Type.String({ minLength: 1, maxLength: 65536 })),
    refreshToken: Type.Optional(Type.String({ minLength: 1, maxLength: 65536 })),
    expiresAt: Type.Optional(Type.Integer({ minimum: 0 })),
    scopes: Type.Optional(Type.Array(Type.String({ maxLength: 256 }), { maxItems: 100 })),
  },
  { additionalProperties: false },
);
export type ConnectionCredential = Static<typeof ConnectionCredentialSchema>;
export interface OAuthClientConfiguration {
  clientId: string;
  redirectUrl: string;
  scopes: readonly string[];
  clientSecret?: string;
  fixtureOrigin?: string;
}
export interface ConnectionOAuthFlow {
  state: string;
  url: string;
  complete(params: URLSearchParams, signal: AbortSignal): Promise<ConnectionCredential>;
}

export function parseConnectionCredential(encoded: string | undefined): ConnectionCredential {
  if (encoded === undefined) return { version: 1 };
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new Error('Connection credentials are invalid');
  }
  if (!Value.Check(ConnectionCredentialSchema, value))
    throw new Error('Connection credentials are invalid');
  return value;
}

/** Fixture rewriting is injected by tests; product callers cannot choose an upstream origin. */
export function connectionFetch(provider: ConnectionProvider, fixtureOrigin?: string) {
  return async (url: string | URL, init: RequestInit): Promise<Response> => {
    const target = new URL(url);
    let actual = target;
    if (fixtureOrigin !== undefined) {
      actual = new URL(`/${provider.serviceId}${target.pathname}${target.search}`, fixtureOrigin);
    }
    const fetch = createRemoteFetch({
      allowedOrigins: new Set([actual.origin]),
      maximumResponseBytes: 2_000_000,
      ...(fixtureOrigin === undefined ? {} : { fixtureOrigin }),
    });
    return await fetch(actual, init);
  };
}

function metadata(provider: ConnectionProvider): oauth.AuthorizationServer {
  return {
    issuer: provider.issuer,
    authorization_endpoint: provider.authorizationEndpoint,
    token_endpoint: provider.tokenEndpoint,
    code_challenge_methods_supported: ['S256'],
  };
}
function client(config: OAuthClientConfiguration): oauth.Client {
  return { client_id: config.clientId };
}
function authentication(
  provider: ConnectionProvider,
  config: OAuthClientConfiguration,
): oauth.ClientAuth {
  if (config.clientSecret === undefined) return oauth.None();
  if (provider.clientAuthentication === 'basic')
    return oauth.ClientSecretBasic(config.clientSecret);
  return oauth.ClientSecretPost(config.clientSecret);
}
function options(
  provider: ConnectionProvider,
  config: OAuthClientConfiguration,
  signal: AbortSignal,
): oauth.TokenEndpointRequestOptions {
  return {
    signal,
    [oauth.customFetch]: async (url, init) => {
      const request: RequestInit = { ...init };
      if (provider.tokenJson && typeof init.body === 'string') {
        request.body = JSON.stringify(Object.fromEntries(new URLSearchParams(init.body)));
        const headers = new Headers(init.headers);
        headers.set('content-type', 'application/json');
        request.headers = headers;
      } else if (provider.tokenJson && init.body instanceof URLSearchParams) {
        request.body = JSON.stringify(Object.fromEntries(init.body));
        const headers = new Headers(init.headers);
        headers.set('content-type', 'application/json');
        request.headers = headers;
      }
      return await connectionFetch(provider, config.fixtureOrigin)(url, request);
    },
  };
}
function credential(
  tokens: oauth.TokenEndpointResponse,
  previous: ConnectionCredential,
): ConnectionCredential {
  const result: ConnectionCredential = {
    ...previous,
    accessToken: tokens.access_token,
  };
  if (tokens.refresh_token !== undefined) result.refreshToken = tokens.refresh_token;
  if (tokens.expires_in !== undefined) result.expiresAt = Date.now() + tokens.expires_in * 1000;
  else delete result.expiresAt;
  if (tokens.scope !== undefined) result.scopes = tokens.scope.split(/[ ,]+/).filter(Boolean);
  if (!Value.Check(ConnectionCredentialSchema, result))
    throw new Error('OAuth returned unsupported token fields');
  return result;
}

/** Start an independent state/PKCE flow against fixed provider metadata. */
export async function beginConnectionOAuth(
  provider: ConnectionProvider,
  config: OAuthClientConfiguration,
): Promise<ConnectionOAuthFlow> {
  const state = oauth.generateRandomState();
  const verifier = oauth.generateRandomCodeVerifier();
  const challenge = await oauth.calculatePKCECodeChallenge(verifier);
  const authorization = new URL(provider.authorizationEndpoint);
  authorization.searchParams.set('client_id', config.clientId);
  authorization.searchParams.set('redirect_uri', config.redirectUrl);
  authorization.searchParams.set('response_type', 'code');
  authorization.searchParams.set('state', state);
  authorization.searchParams.set('code_challenge', challenge);
  authorization.searchParams.set('code_challenge_method', 'S256');
  if (config.scopes.length > 0) authorization.searchParams.set('scope', config.scopes.join(' '));
  if (provider.serviceId === 'google') {
    authorization.searchParams.set('access_type', 'offline');
    authorization.searchParams.set('prompt', 'consent');
  }
  if (provider.serviceId === 'notion') authorization.searchParams.set('owner', 'user');
  let consumed = false;
  return {
    state,
    url: authorization.toString(),
    async complete(params, signal) {
      if (consumed) throw new Error('OAuth flow was already consumed');
      consumed = true;
      const validated = oauth.validateAuthResponse(
        metadata(provider),
        client(config),
        params,
        state,
      );
      const response = await oauth.authorizationCodeGrantRequest(
        metadata(provider),
        client(config),
        authentication(provider, config),
        validated,
        config.redirectUrl,
        verifier,
        options(provider, config, signal),
      );
      const tokens = await oauth.processAuthorizationCodeResponse(
        metadata(provider),
        client(config),
        response,
      );
      return credential(tokens, {
        version: 1,
        ...(config.clientSecret === undefined ? {} : { clientSecret: config.clientSecret }),
      });
    },
  };
}

/** The caller serializes each credential reference across rotation and account validation. */
export async function refreshConnectionOAuth(
  provider: ConnectionProvider,
  config: OAuthClientConfiguration,
  previous: ConnectionCredential,
  signal: AbortSignal,
): Promise<ConnectionCredential> {
  if (previous.refreshToken === undefined)
    throw new Error('Connection authorization expired; reconnect the account');
  const response = await oauth.refreshTokenGrantRequest(
    metadata(provider),
    client(config),
    authentication(provider, config),
    previous.refreshToken,
    options(provider, config, signal),
  );
  const tokens = await oauth.processRefreshTokenResponse(
    metadata(provider),
    client(config),
    response,
  );
  return credential(tokens, previous);
}
