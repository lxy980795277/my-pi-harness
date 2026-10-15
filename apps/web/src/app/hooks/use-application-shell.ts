import type { ApplicationShellState } from '@/app/types/application-view';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTheme } from '@/app/hooks/use-theme';
import { useWorkspaceStore, type WorkspacePage } from '@/app/stores/workspace';
import { useAuthorization } from '@/features/auth/hooks/use-authorization';
import {
  createPairingCode,
  startGithubDeviceLogin,
  startGithubWebLogin,
} from '@/features/auth/services/auth';
import { useAsyncEvent } from '@/hooks/use-async-event';
import { authorizationUrl } from '@/utils/authorization-url';
import { getUserProfile } from '@/app/utils/user-profile';

const PAGE_LABELS: Record<WorkspacePage, string> = { sessions: '新对话', runtime: '运行状态' };
const THEME_LABELS = { light: '切换到深色主题', dark: '切换到浅色主题' } as const;

/** Shell commands share one cancellable owner; secrets never enter mutation variables. */
export const useApplicationShell = (): ApplicationShellState => {
  const { theme, toggleTheme } = useTheme();
  const { query: auth, pair, logout, revoked } = useAuthorization();
  const { refetch: authRefetch } = auth;
  const client = useQueryClient();
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
  const addAuthFlow = useWorkspaceStore((state) => {
    return state.addAuthFlow;
  });
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const authorized = auth.isSuccess && auth.data.authenticated && !revoked;
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
  const github = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        if (window.desktop) {
          const flow = await startGithubDeviceLogin(signal);
          signal.throwIfAborted();
          addAuthFlow(flow.id);
          await client.invalidateQueries({ queryKey: ['auth-flows'] });
          return;
        }
        window.location.assign(authorizationUrl(await startGithubWebLogin(signal)));
      },
      [addAuthFlow, client],
    ),
  );
  const reconnect = useAsyncEvent(
    useCallback(async (): Promise<void> => {
      await authRefetch();
    }, [authRefetch]),
  );
  const hideCode = useCallback((): void => {
    setPairingCode(null);
  }, []);
  const settings = useCallback((): void => {
    openSettings('models');
  }, [openSettings]);
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
    page,
    pageLabel: PAGE_LABELS[page],
    navigate,
    authorized,
    pairingCode,
    hideCode,
    settings,
    signOut: signOut.run,
    pairing: pairing.run,
    github: github.run,
    reconnect: reconnect.run,
    actionError: signOut.error ?? pairing.error ?? github.error ?? reconnect.error,
  };
};
