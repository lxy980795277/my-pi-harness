import {
  AuthStatusSchema,
  PairingCodeResponseSchema,
  LoginFlowSchema,
  type LoginFlow,
  type LoginMethod,
  type AuthStatus,
  type PairingInput,
  type LoginInput,
} from '@my-pi-harness/protocol';

import { getJson, requestJson, setCsrfToken } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

/** Reads current cookie authorization and installs its volatile CSRF token. */
export const fetchAuthStatus = async (signal: AbortSignal): Promise<AuthStatus> => {
  const status = parseResponse(AuthStatusSchema, await getJson('/auth/status', signal));
  signal.throwIfAborted();
  setCsrfToken(status.csrfToken);
  return status;
};

/** Exchanges a one-time code without retaining it beyond the write request. */
export const pairBrowser = async (code: string, signal: AbortSignal): Promise<AuthStatus> => {
  const status = parseResponse(
    AuthStatusSchema,
    await requestJson('/auth/pair', 'POST', { code } satisfies PairingInput, signal),
  );
  setCsrfToken(status.csrfToken);
  return status;
};

/** Revokes application sessions while preserving this browser's local trust. */
export const logoutBrowser = async (signal: AbortSignal): Promise<void> => {
  await requestJson('/auth/logout', 'POST', {}, signal);
};

/** Creates a short-lived code for authorizing an additional browser entry point. */
export const createPairingCode = async (signal: AbortSignal): Promise<string> => {
  return parseResponse(
    PairingCodeResponseSchema,
    await requestJson('/auth/pairing-code', 'POST', {}, signal),
  ).code;
};

/** Begins application login independently of model-provider authorization. */
export const startLogin = async (
  providerId: string,
  method: LoginMethod,
  signal: AbortSignal,
): Promise<LoginFlow> => {
  return parseResponse(
    LoginFlowSchema,
    await requestJson('/auth/login', 'POST', { providerId, method } satisfies LoginInput, signal),
  );
};

/** Reads only the current local client's application login flow. */
export const fetchLoginFlow = async (id: string, signal: AbortSignal): Promise<LoginFlow> => {
  return parseResponse(
    LoginFlowSchema,
    await getJson(`/auth/login-flows/${encodeURIComponent(id)}`, signal),
  );
};

/** Exchanges a verified flow once for an HttpOnly application session. */
export const completeLogin = async (id: string, signal: AbortSignal): Promise<AuthStatus> => {
  const status = parseResponse(
    AuthStatusSchema,
    await requestJson(`/auth/login-flows/${encodeURIComponent(id)}/complete`, 'POST', {}, signal),
  );
  setCsrfToken(status.csrfToken);
  return status;
};

/** Cancels pending identity verification without changing local trust. */
export const cancelLogin = async (id: string, signal: AbortSignal): Promise<void> => {
  await requestJson(`/auth/login-flows/${encodeURIComponent(id)}`, 'DELETE', {}, signal);
};
