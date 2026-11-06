import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import {
  beginOAuth,
  refreshOAuth,
  oauthFetch,
  type OAuthTokens,
} from '../oauth/authorization-code';
import type { OAuthDefinition } from '../oauth/types';

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

/** This secret JSON is only written through the system CredentialStore. */
const ConnectionCredentialSchema = Type.Object(
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

/** Account adapters use the same bounded transport as plugin authorization. */
export function connectionFetch(provider: Pick<OAuthDefinition, 'id'>, fixtureOrigin?: string) {
  const request = oauthFetch(fixtureOrigin);
  return async (url: string | URL, init: RequestInit): Promise<Response> =>
    await request(provider.id, new URL(url), init);
}

function definition(provider: OAuthDefinition, config: OAuthClientConfiguration): OAuthDefinition {
  const { profile: _profile, responsePolicy: _responsePolicy, ...oauth } = provider.oauth;
  return { ...provider, oauth: { ...oauth, pkce: true, scopes: config.scopes } };
}

function credential(tokens: OAuthTokens, previous: ConnectionCredential): ConnectionCredential {
  const result: ConnectionCredential = { ...previous, accessToken: tokens.accessToken };
  if (tokens.refreshToken !== undefined) result.refreshToken = tokens.refreshToken;
  if (tokens.expiresAt !== undefined) result.expiresAt = tokens.expiresAt;
  else delete result.expiresAt;
  if (tokens.scopes !== undefined) result.scopes = tokens.scopes;
  if (!Value.Check(ConnectionCredentialSchema, result))
    throw new Error('OAuth returned unsupported token fields');
  return result;
}

/** Account ownership remains independent while authorization-code and PKCE are shared. */
export async function beginConnectionOAuth(
  provider: OAuthDefinition,
  config: OAuthClientConfiguration,
): Promise<ConnectionOAuthFlow> {
  const flow = await beginOAuth(
    definition(provider, config),
    {
      clientId: config.clientId,
      callbackUrl: config.redirectUrl,
      ...(config.clientSecret === undefined ? {} : { clientSecret: config.clientSecret }),
    },
    oauthFetch(config.fixtureOrigin),
  );
  return {
    state: flow.state,
    url: flow.authorizationUrl,
    async complete(params, signal) {
      return credential(await flow.complete(params, signal), {
        version: 1,
        ...(config.clientSecret === undefined ? {} : { clientSecret: config.clientSecret }),
      });
    },
  };
}

/** The caller serializes credential rotation and invalidates an expired refresh grant. */
export async function refreshConnectionOAuth(
  provider: OAuthDefinition,
  config: OAuthClientConfiguration,
  previous: ConnectionCredential,
  signal: AbortSignal,
): Promise<ConnectionCredential> {
  if (previous.accessToken === undefined)
    throw new Error('Connection authorization expired; reconnect the account');
  const tokens = await refreshOAuth(
    definition(provider, config),
    {
      clientId: config.clientId,
      callbackUrl: config.redirectUrl,
      ...(config.clientSecret === undefined ? {} : { clientSecret: config.clientSecret }),
    },
    {
      accessToken: previous.accessToken,
      ...(previous.refreshToken === undefined ? {} : { refreshToken: previous.refreshToken }),
    },
    signal,
    oauthFetch(config.fixtureOrigin),
  );
  return credential(tokens, previous);
}
