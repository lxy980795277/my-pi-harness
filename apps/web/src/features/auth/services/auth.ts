import {
  AuthFlowSchema,
  AuthStatusSchema,
  AuthUrlResponseSchema,
  PairingCodeResponseSchema,
  type AuthFlow,
  type AuthStatus,
} from '@my-pi-harness/protocol';
import { Type } from 'typebox';

import { getJson, requestJson, setCsrfToken } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

/** Reads current cookie authorization and installs its volatile CSRF token. */
export const fetchAuthStatus = async (signal: AbortSignal): Promise<AuthStatus> => {
  const status = parseResponse(AuthStatusSchema, await getJson('/auth/status', signal));
  setCsrfToken(status.csrfToken);
  return status;
};

/** Exchanges a one-time code without retaining it beyond the write request. */
export const pairBrowser = async (code: string, signal: AbortSignal): Promise<AuthStatus> => {
  const status = parseResponse(
    AuthStatusSchema,
    await requestJson('/auth/pair', 'POST', { code }, signal),
  );
  setCsrfToken(status.csrfToken);
  return status;
};

/** Revokes the current browser's local authorization. */
export const logoutBrowser = async (signal: AbortSignal): Promise<void> => {
  await requestJson('/auth/logout', 'POST', {}, signal);
  setCsrfToken(null);
};

/** Reads the server-owned model or application OAuth flow. */
export const fetchAuthFlow = async (id: string, signal: AbortSignal): Promise<AuthFlow> => {
  return parseResponse(
    AuthFlowSchema,
    await getJson(`/auth-flows/${encodeURIComponent(id)}`, signal),
  );
};

/** Restores authorized interaction flows after refresh without persisting client-side facts. */
export const fetchAuthFlows = async (signal: AbortSignal): Promise<AuthFlow[]> => {
  return parseResponse(Type.Array(AuthFlowSchema), await getJson('/auth-flows', signal));
};

/** Replies only to the exact pending OAuth challenge. */
export const respondToAuthFlow = async (
  id: string,
  promptId: string,
  value: string,
  signal: AbortSignal,
): Promise<AuthFlow> => {
  return parseResponse(
    AuthFlowSchema,
    await requestJson(
      `/auth-flows/${encodeURIComponent(id)}/respond`,
      'POST',
      { promptId, value },
      signal,
    ),
  );
};

/** Cancels a model/application OAuth exchange without treating it as logout. */
export const cancelAuthFlow = async (id: string, signal: AbortSignal): Promise<void> => {
  await requestJson(`/auth-flows/${encodeURIComponent(id)}`, 'DELETE', {}, signal);
};

/** Creates a short-lived code for authorizing an additional browser entry point. */
export const createPairingCode = async (signal: AbortSignal): Promise<string> => {
  return parseResponse(PairingCodeResponseSchema, await getJson('/auth/pairing-code', signal)).code;
};

/** Begins the configured GitHub application's browser authorization-code flow. */
export const startGithubWebLogin = async (signal: AbortSignal): Promise<string> => {
  return parseResponse(AuthUrlResponseSchema, await getJson('/auth/github/start', signal)).url;
};

/** Begins application identity Device Flow for the desktop entry point. */
export const startGithubDeviceLogin = async (signal: AbortSignal): Promise<AuthFlow> => {
  return parseResponse(
    AuthFlowSchema,
    await requestJson('/auth/github/device', 'POST', {}, signal),
  );
};
