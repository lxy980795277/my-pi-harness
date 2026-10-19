import type { AuthStatus, LoginFlow } from '@my-pi-harness/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { completeLogin, fetchAuthStatus, startLogin } from '@/features/auth/services/auth';
import {
  discardLoginFlow,
  finishLoginFlow,
  githubLoginUrl,
  githubWebLoginUrl,
  isDefinitiveLoginRejection,
  restoreLoginFlow,
} from '@/features/auth/utils/login-flow';
import { loginEntry, readLoginCallback } from '@/features/auth/utils/login-entry';
import { useAsyncEvent } from '@/hooks/use-async-event';
import type { LoginPageState } from '@/features/auth/types/auth';
import { describeError } from '@/utils/describe-error';

/** Application login stays view-owned; cancelling or unmounting prevents a late completion. */
export const useLogin = (
  status: AuthStatus,
  onAuthenticated: (status: AuthStatus) => void,
): LoginPageState => {
  const [flow, setFlow] = useState<LoginFlow | null>(null);
  const [completionRejected, setCompletionRejected] = useState(false);
  const [callback] = useState(() => {
    return readLoginCallback(window.location.href);
  });
  // Browser navigation outlives the request event; a restored history entry can start again.
  const [redirecting, setRedirecting] = useState(false);
  const [restoringCallback, setRestoringCallback] = useState(callback.flowId !== null);
  const [callbackError, setCallbackError] = useState(callback.error);
  const [autoOpenError, setAutoOpenError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const desktop = window.desktop !== undefined;
  const entry = loginEntry(status, desktop);
  const { method } = entry;
  const restore = useAsyncEvent(
    useCallback(
      async (ownerSignal: AbortSignal): Promise<void> => {
        if (callback.flowId === null) {
          return;
        }
        const controller = new AbortController();
        active.current = controller;
        const signal = AbortSignal.any([ownerSignal, controller.signal]);
        try {
          const restored = await restoreLoginFlow(callback.flowId, setFlow, signal);
          signal.throwIfAborted();
          onAuthenticated(restored);
        } catch (failure: unknown) {
          if (signal.aborted) {
            return;
          }
          setCompletionRejected(isDefinitiveLoginRejection(failure));
          throw failure;
        } finally {
          if (!signal.aborted) {
            setRestoringCallback(false);
          }
        }
      },
      [callback.flowId, onAuthenticated],
    ),
  );
  const { run: restoreRun, clearError: clearRestoreError } = restore;
  useEffect(() => {
    window.history.replaceState(window.history.state, '', callback.cleanUrl);
    if (callback.flowId !== null) {
      restoreRun();
    }
  }, [callback.cleanUrl, callback.flowId, restoreRun]);
  useEffect(() => {
    const resume = (event: PageTransitionEvent): void => {
      if (event.persisted) {
        setRedirecting(false);
      }
    };
    window.addEventListener('pageshow', resume);
    return (): void => {
      window.removeEventListener('pageshow', resume);
    };
  }, []);
  const start = useAsyncEvent(
    useCallback(
      async (ownerSignal: AbortSignal): Promise<void> => {
        const controller = new AbortController();
        active.current = controller;
        const signal = AbortSignal.any([ownerSignal, controller.signal]);
        setCompletionRejected(false);
        try {
          if (flow) {
            await discardLoginFlow(flow, signal);
            signal.throwIfAborted();
            setFlow(null);
          }
          const started = await startLogin('github', method, signal);
          signal.throwIfAborted();
          setFlow(started);
          if (method === 'web') {
            if (started.url === null) {
              throw new Error('GitHub 登录地址缺失，请重新发起登录。');
            }
            const url = githubWebLoginUrl(started.url);
            setRedirecting(true);
            window.location.assign(url);
            return;
          }
          if (window.desktop) {
            try {
              await window.desktop.openAuth(started.id);
            } catch (failure: unknown) {
              if (!signal.aborted) {
                setAutoOpenError(describeError(failure));
              }
            }
          }
          signal.throwIfAborted();
          const status = await finishLoginFlow(started, setFlow, signal);
          signal.throwIfAborted();
          onAuthenticated(status);
        } catch (failure: unknown) {
          if (signal.aborted) {
            return;
          }
          setRedirecting(false);
          setCompletionRejected(isDefinitiveLoginRejection(failure));
          throw failure;
        }
      },
      [flow, method, onAuthenticated],
    ),
  );
  const { clearError: clearStartError } = start;
  const cancel = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        active.current?.abort();
        setRedirecting(false);
        setRestoringCallback(false);
        if (flow) {
          await discardLoginFlow(flow, signal);
          signal.throwIfAborted();
          setFlow(null);
          clearStartError();
        }
        clearRestoreError();
        setCallbackError(null);
        setAutoOpenError(null);
      },
      [flow, clearStartError, clearRestoreError],
    ),
  );
  const retryCompletion = useAsyncEvent(
    useCallback(
      async (ownerSignal: AbortSignal): Promise<void> => {
        if (!flow || flow.status !== 'completed') {
          return;
        }
        const controller = new AbortController();
        active.current = controller;
        const signal = AbortSignal.any([ownerSignal, controller.signal]);
        try {
          let status = await fetchAuthStatus(signal);
          if (!status.authenticated) {
            status = await completeLogin(flow.id, signal);
          }
          signal.throwIfAborted();
          onAuthenticated(status);
        } catch (failure: unknown) {
          if (signal.aborted) {
            return;
          }
          setCompletionRejected(isDefinitiveLoginRejection(failure));
          throw failure;
        }
      },
      [flow, onAuthenticated],
    ),
  );
  const open = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      if (flow && window.desktop) {
        await window.desktop.openAuth(flow.id);
        setAutoOpenError(null);
      }
    }, [flow]),
  );
  const { run: startRun } = start;
  const { clearError: clearCancelError } = cancel;
  const { run: retryRun, clearError: clearRetryError } = retryCompletion;
  const { clearError: clearOpenError } = open;
  const begin = useCallback((): void => {
    clearCancelError();
    clearRetryError();
    clearOpenError();
    clearRestoreError();
    setCallbackError(null);
    setAutoOpenError(null);
    startRun();
  }, [clearCancelError, clearRetryError, clearOpenError, clearRestoreError, startRun]);
  const retry = useCallback((): void => {
    clearStartError();
    clearCancelError();
    clearOpenError();
    clearRestoreError();
    setAutoOpenError(null);
    retryRun();
  }, [clearStartError, clearCancelError, clearOpenError, clearRestoreError, retryRun]);
  let safeUrl: string | null = null;
  let urlError: string | null = null;
  if (desktop && flow?.url) {
    try {
      safeUrl = githubLoginUrl(flow.url);
    } catch (failure: unknown) {
      urlError = describeError(failure);
    }
  }
  let error = cancel.error;
  if (error === null) {
    error = retryCompletion.error;
  }
  if (error === null) {
    error = start.error;
  }
  if (error === null) {
    error = restore.error;
  }
  if (error === null) {
    error = open.error;
  }
  if (error === null) {
    error = urlError;
  }
  if (error === null) {
    error = autoOpenError;
  }
  if (error === null) {
    error = callbackError;
  }
  const pending =
    start.pending ||
    cancel.pending ||
    retryCompletion.pending ||
    restore.pending ||
    restoringCallback ||
    redirecting;
  const webLoading = !desktop && pending && !cancel.pending;
  const showLoginButton =
    entry.configured &&
    (flow === null || webLoading || (!desktop && flow.status === 'pending' && error === null));
  const loginButtonBusy = showLoginButton && pending;
  let loginButtonLabel = '使用 GitHub 登录';
  if (loginButtonBusy) {
    loginButtonLabel = '正在登录…';
    if (!desktop && (start.pending || redirecting)) {
      loginButtonLabel = '正在前往 GitHub…';
    }
    if (cancel.pending) {
      loginButtonLabel = '正在取消…';
    }
  }
  return {
    flow,
    configured: entry.configured,
    configurationMessage: entry.configurationMessage,
    safeUrl,
    error,
    pending,
    showLoginButton,
    showFlow: flow !== null && !showLoginButton,
    loginButtonLabel,
    loginButtonBusy,
    canRestart: !pending,
    canComplete: flow?.status === 'completed' && !pending && !completionRejected,
    desktop,
    start: begin,
    cancel: cancel.run,
    cancelPending: cancel.pending,
    retryCompletion: retry,
    openDesktop: open.run,
  };
};
