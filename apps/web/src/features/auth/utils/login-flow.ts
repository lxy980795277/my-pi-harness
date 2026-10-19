import type { AuthStatus, LoginFlow } from '@my-pi-harness/protocol';
import {
  cancelLogin,
  completeLogin,
  fetchAuthStatus,
  fetchLoginFlow,
} from '@/features/auth/services/auth';
import { RequestError } from '@/services/base-request';
import { authorizationUrl } from '@/utils/authorization-url';

/** Keeps provider-owned login destinations separate from general model OAuth addresses. */
export const githubLoginUrl = (value: string): string => {
  const url = new URL(authorizationUrl(value));
  if (
    url.origin !== 'https://github.com' ||
    url.pathname !== '/login/device' ||
    url.search ||
    url.hash
  ) {
    throw new Error('GitHub 登录地址无效，请重新发起登录。');
  }
  return url.href;
};

/** Web login is restricted to GitHub's PKCE authorization endpoint and a local callback. */
export const githubWebLoginUrl = (value: string): string => {
  const url = new URL(authorizationUrl(value));
  if (
    url.origin !== 'https://github.com' ||
    url.pathname !== '/login/oauth/authorize' ||
    url.hash
  ) {
    throw new Error('GitHub 登录地址无效，请重新发起登录。');
  }
  const callbackValue = url.searchParams.get('redirect_uri');
  if (!callbackValue) {
    throw new Error('GitHub 登录回调地址缺失，请重新发起登录。');
  }
  const callback = new URL(authorizationUrl(callbackValue));
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(callback.hostname);
  if (
    !local ||
    callback.pathname !== '/api/auth/callback/github' ||
    callback.search ||
    callback.hash ||
    !url.searchParams.get('client_id') ||
    !url.searchParams.get('state') ||
    !url.searchParams.get('code_challenge') ||
    url.searchParams.get('code_challenge_method') !== 'S256' ||
    url.searchParams.get('scope') !== 'read:user'
  ) {
    throw new Error('GitHub 登录地址无效，请重新发起登录。');
  }
  return url.href;
};

const pausePolling = async (signal: AbortSignal): Promise<void> => {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = (): void => {
      window.clearTimeout(timer);
      reject(new DOMException('登录已取消。', 'AbortError'));
    };
    const ready = (): void => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = window.setTimeout(ready, 1_000);
    signal.addEventListener('abort', abort, { once: true });
  });
};

/** Polls one flow; completion is a single write in this request chain, never an Effect retry. */
export const finishLoginFlow = async (
  initial: LoginFlow,
  receive: (flow: LoginFlow) => void,
  signal: AbortSignal,
): Promise<AuthStatus> => {
  let flow = initial;
  while (flow.status === 'pending') {
    if (flow.expiresAt <= Date.now()) {
      throw new Error('登录已过期，请重新登录。');
    }
    await pausePolling(signal);
    flow = await fetchLoginFlow(flow.id, signal);
    signal.throwIfAborted();
    receive(flow);
  }
  signal.throwIfAborted();
  if (flow.status !== 'completed') {
    let message = '登录已取消，请重新登录。';
    if (flow.error) {
      message = flow.error;
    }
    throw new Error(message);
  }
  return completeLogin(flow.id, signal);
};

/** Restores a callback with the current browser's cookies and avoids replaying an existing session. */
export const restoreLoginFlow = async (
  id: string,
  receive: (flow: LoginFlow) => void,
  signal: AbortSignal,
): Promise<AuthStatus> => {
  const status = await fetchAuthStatus(signal);
  signal.throwIfAborted();
  if (status.authenticated) {
    return status;
  }
  const flow = await fetchLoginFlow(id, signal);
  signal.throwIfAborted();
  receive(flow);
  return finishLoginFlow(flow, receive, signal);
};

/** A definite client-side rejection needs a new identity exchange; network outcomes can be recovered. */
export const isDefinitiveLoginRejection = (failure: unknown): boolean => {
  return failure instanceof RequestError && failure.status >= 400 && failure.status < 500;
};

/** Expired or already-removed exchanges cannot block an explicit new login. */
export const discardLoginFlow = async (flow: LoginFlow, signal: AbortSignal): Promise<void> => {
  signal.throwIfAborted();
  if (flow.expiresAt <= Date.now()) {
    return;
  }
  try {
    await cancelLogin(flow.id, signal);
  } catch (failure: unknown) {
    if (failure instanceof RequestError && failure.status === 404) {
      return;
    }
    throw failure;
  }
};
