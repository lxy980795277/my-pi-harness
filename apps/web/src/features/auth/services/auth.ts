import {
  AuthStatusSchema,
  LoginFlowSchema,
  type LoginFlow,
  type LoginMethod,
  type AuthStatus,
  type LoginInput,
} from '@my-pi-harness/protocol';

import { getJson, requestJson, setCsrfToken } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

/** Reads authorization and initializes a missing browser client before exposing login. */
export const fetchAuthStatus = async (signal: AbortSignal): Promise<AuthStatus> => {
  let status = parseResponse(AuthStatusSchema, await getJson('/auth/status', signal));
  signal.throwIfAborted();
  if (!status.clientInitialized) {
    status = parseResponse(AuthStatusSchema, await requestJson('/auth/client', 'POST', {}, signal));
    signal.throwIfAborted();
    if (!status.clientInitialized || status.csrfToken === null) {
      throw new Error('无法建立本机连接，请重试。');
    }
  }
  setCsrfToken(status.csrfToken);
  return status;
};

/** Revokes application sessions while preserving this browser's initialized client. */
export const logoutBrowser = async (signal: AbortSignal): Promise<void> => {
  await requestJson('/auth/logout', 'POST', {}, signal);
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

/** Cancels pending identity verification without changing the browser client. */
export const cancelLogin = async (id: string, signal: AbortSignal): Promise<void> => {
  await requestJson(`/auth/login-flows/${encodeURIComponent(id)}`, 'DELETE', {}, signal);
};
