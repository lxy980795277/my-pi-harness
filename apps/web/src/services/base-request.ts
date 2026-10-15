import { API_PREFIX } from '@/constants/api';

let csrfToken: string | null = null;
const authorizationListeners = new Set<() => void>();

/** Notifies the authorization owner immediately when a protected request rejects its cookie. */
export const subscribeAuthorizationLoss = (listener: () => void): (() => void) => {
  authorizationListeners.add(listener);
  return (): void => {
    authorizationListeners.delete(listener);
  };
};

/** Keeps the current cookie session's CSRF token in volatile transport memory. */
export const setCsrfToken = (token: string | null): void => {
  csrfToken = token;
};

/** HTTP failure retains status so authorization failures can reopen pairing. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

/** Sends same-origin JSON with cancellation, cookie auth and bounded response wait. */
export const requestJson = async (
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body: unknown,
  signal: AbortSignal,
  timeoutMs = 8_000,
): Promise<unknown> => {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (csrfToken !== null && method !== 'GET') {
    headers['X-CSRF-Token'] = csrfToken;
  }
  let serializedBody: Pick<RequestInit, 'body'> = {};
  if (body !== undefined) {
    serializedBody = { body: JSON.stringify(body) };
  }
  const response = await fetch(`${API_PREFIX}${path}`, {
    method,
    headers,
    ...serializedBody,
    credentials: 'same-origin',
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    cache: 'no-store',
  });

  if (!response.ok) {
    if (response.status === 401) {
      csrfToken = null;
      for (const listener of authorizationListeners) {
        listener();
      }
    }
    let message = `本机服务返回错误（HTTP ${response.status}），请检查服务后重试。`;
    try {
      const failure: unknown = await response.json();
      if (
        typeof failure === 'object' &&
        failure !== null &&
        'message' in failure &&
        typeof failure.message === 'string'
      ) {
        message = failure.message;
      }
    } catch {
      // Non-JSON gateway failures keep the HTTP status message.
    }
    throw new RequestError(message, response.status);
  }

  if (response.status === 204) {
    return null;
  }
  const data: unknown = await response.json();
  return data;
};

/** Reads JSON through the same authenticated transport as mutations. */
export const getJson = async (path: string, signal: AbortSignal): Promise<unknown> => {
  return requestJson(path, 'GET', undefined, signal);
};
