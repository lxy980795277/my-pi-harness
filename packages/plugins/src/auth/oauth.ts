import {
  beginOAuth,
  refreshOAuth,
  oauthFetch,
  OAuthError,
  OAuthRefreshRequiredError,
  type OAuthFetch,
  type OAuthTokens,
} from '@my-pi-harness/integrations';
import type { OAuthDefinition } from '@my-pi-harness/integrations';
import type { SkillConnectionAccount } from '@my-pi-harness/protocol';
import type { PluginConnectionDefinition, PluginOAuthClient } from './manifest';
import { PluginError } from '../plugins/errors';
import { PluginOAuthError } from './errors';

export type PluginOAuthTokens = Pick<OAuthTokens, 'accessToken' | 'refreshToken' | 'expiresAt'>;

export interface PluginOAuthFlow {
  state: string;
  authorizationUrl: string;
  complete(
    params: URLSearchParams,
    signal: AbortSignal,
  ): Promise<PluginOAuthTokens & { account: SkillConnectionAccount | null }>;
}

function failure(error: unknown): never {
  if (error instanceof OAuthError)
    throw new PluginOAuthError(error.phase, error.reason, error.upstreamStatus);
  if (error instanceof OAuthRefreshRequiredError)
    throw new PluginError('SKILL_CONNECTION_REQUIRED', error.message);
  throw error;
}

function tokenFields(tokens: OAuthTokens): PluginOAuthTokens {
  const result: PluginOAuthTokens = { accessToken: tokens.accessToken };
  if (tokens.refreshToken !== undefined) result.refreshToken = tokens.refreshToken;
  if (tokens.expiresAt !== undefined) result.expiresAt = tokens.expiresAt;
  return result;
}

function providerDefinition(definition: PluginConnectionDefinition): OAuthDefinition {
  return {
    ...definition,
    oauth: {
      ...definition.oauth,
      responsePolicy: {
        allowMissingTokenType: true,
        displayOnlyIdToken: true,
      },
    },
  };
}

/** Plugin callers keep account ownership while sharing the provider OAuth mechanism. */
export async function beginPluginOAuth(
  definition: PluginConnectionDefinition,
  client: PluginOAuthClient,
  request: OAuthFetch = oauthFetch(),
): Promise<PluginOAuthFlow> {
  if (!client.clientId || !client.clientSecret || client.callbackUrl === undefined)
    throw new PluginOAuthError('authorization-response', 'client-unconfigured');
  let flow;
  try {
    flow = await beginOAuth(
      providerDefinition(definition),
      { ...client, callbackUrl: client.callbackUrl },
      request,
    );
  } catch (error: unknown) {
    return failure(error);
  }
  return {
    state: flow.state,
    authorizationUrl: flow.authorizationUrl,
    async complete(params, signal) {
      try {
        const result = await flow.complete(params, signal);
        return { ...tokenFields(result), account: result.account };
      } catch (error: unknown) {
        return failure(error);
      }
    },
  };
}

/** The account owner controls refresh serialization and credential replacement. */
export async function refreshPluginOAuth(
  definition: PluginConnectionDefinition,
  client: PluginOAuthClient,
  previous: PluginOAuthTokens,
  signal: AbortSignal,
  request: OAuthFetch = oauthFetch(),
): Promise<PluginOAuthTokens> {
  if (client.callbackUrl === undefined)
    throw new PluginOAuthError('authorization-response', 'client-unconfigured');
  try {
    return tokenFields(
      await refreshOAuth(
        providerDefinition(definition),
        { ...client, callbackUrl: client.callbackUrl },
        previous,
        signal,
        request,
      ),
    );
  } catch (error: unknown) {
    return failure(error);
  }
}
