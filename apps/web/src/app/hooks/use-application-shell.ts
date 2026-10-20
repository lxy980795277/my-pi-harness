import type { ApplicationShellState } from '@/app/types/application';
import { useCallback, useEffect, useState } from 'react';
import { useTheme } from '@/app/hooks/use-theme';
import { useWorkspaceStore } from '@/app/stores/workspace';
import type { WorkspacePage } from '@/app/types/application';
import { useAuthorization } from '@/features/auth/hooks/use-authorization';
import { createPairingCode } from '@/features/auth/services/auth';
import { hasValidApplicationSession } from '@/features/auth/utils/application-session';
import { readLoginCallback } from '@/features/auth/utils/login-entry';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { getUserProfile } from '@/app/utils/user-profile';

const PAGE_LABELS: Record<WorkspacePage, string> = { sessions: '新对话', runtime: '运行状态' };
const THEME_LABELS = { light: '切换到深色主题', dark: '切换到浅色主题' } as const;

/** Shell commands share one cancellable owner; secrets never enter mutation variables. */
export const useApplicationShell = (): ApplicationShellState => {
  const { theme, toggleTheme } = useTheme();
  const {
    query: auth,
    pair,
    logout,
    reconnect: reconnectAuthorization,
    receive,
    revoked,
  } = useAuthorization();
  const page = useWorkspaceStore((state) => {
    return state.page;
  });
  const navigate = useWorkspaceStore((state) => {
    return state.navigate;
  });
  const startNewConversation = useWorkspaceStore((state) => {
    return state.startNewConversation;
  });
  const activeSessionId = useWorkspaceStore((state) => {
    return state.activeSessionId;
  });
  const reset = useWorkspaceStore((state) => {
    return state.reset;
  });
  const settingsOpen = useWorkspaceStore((state) => {
    return state.settingsOpen;
  });
  const openSettings = useWorkspaceStore((state) => {
    return state.openSettings;
  });
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const authorized = hasValidApplicationSession(auth.data, revoked, Date.now());
  useEffect(() => {
    if (!authorized) {
      return;
    }
    const callback = readLoginCallback(window.location.href);
    if (callback.flowId !== null || callback.error !== null) {
      window.history.replaceState(window.history.state, '', callback.cleanUrl);
    }
  }, [authorized]);
  useEffect(() => {
    if (!authorized) {
      setPairingCode(null);
    }
  }, [authorized]);
  const signOut = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await logout();
      setPairingCode(null);
      reset();
    }, [logout, reset]),
  );
  const pairing = useAsyncEvent(
    useCallback(async (signal: AbortSignal): Promise<void> => {
      const code = await createPairingCode(signal);
      signal.throwIfAborted();
      setPairingCode(code);
    }, []),
  );
  const reconnect = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await reconnectAuthorization();
    }, [reconnectAuthorization]),
  );
  const hideCode = useCallback((): void => {
    setPairingCode(null);
  }, []);
  const settings = useCallback((): void => {
    openSettings('models');
  }, [openSettings]);
  let actionError = signOut.error;
  if (actionError === null) {
    actionError = pairing.error;
  }
  if (actionError === null) {
    actionError = reconnect.error;
  }
  return {
    settingsOpen,
    startNewConversation,
    newConversation: page === 'sessions' && activeSessionId === null,
    userName: getUserProfile(auth.data).name,
    theme,
    themeLabel: THEME_LABELS[theme],
    toggleTheme,
    auth,
    pair,
    receiveLogin: receive,
    localAuthorized: auth.data?.localAuthorized === true,
    checkingAuthorization: revoked && auth.data?.authenticated === true,
    page,
    pageLabel: PAGE_LABELS[page],
    navigate,
    authorized,
    pairingCode,
    hideCode,
    settings,
    signOut: signOut.run,
    pairing: pairing.run,
    reconnect: reconnect.run,
    actionError: actionError,
  };
};
