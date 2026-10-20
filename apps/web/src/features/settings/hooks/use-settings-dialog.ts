import type { SettingsCloseTarget, SettingsDialogState } from '@/features/settings/types/settings';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useSettingsStore } from '@/features/settings/stores/settings';
import { cancelAuthFlow } from '@/features/auth/services/auth';
import { useAsyncEvent } from '@/hooks/use-async-event';

/** Parent and child closes first cancel the model exchange owned by the settings window. */
export const useSettingsDialog = (): SettingsDialogState => {
  const client = useQueryClient();
  const open = useSettingsStore((state) => {
    return state.settingsOpen;
  });
  const section = useSettingsStore((state) => {
    return state.settingsSection;
  });
  const setSection = useSettingsStore((state) => {
    return state.setSettingsSection;
  });
  const closeSettings = useSettingsStore((state) => {
    return state.closeSettings;
  });
  const closeProvider = useSettingsStore((state) => {
    return state.closeProvider;
  });
  const flowId = useSettingsStore((state) => {
    return state.providerAuthFlowId;
  });
  const authStarting = useSettingsStore((state) => {
    return state.providerAuthStarting;
  });
  const close = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, target: SettingsCloseTarget): Promise<void> => {
        if (authStarting) {
          throw new Error('正在创建授权流程，请稍候再关闭。');
        }
        if (flowId !== null) {
          await cancelAuthFlow(flowId, signal);
          await Promise.all([
            client.invalidateQueries({ queryKey: ['auth-flows'] }),
            client.invalidateQueries({ queryKey: ['auth-flow', flowId] }),
          ]);
          signal.throwIfAborted();
        }
        if (target === 'settings') {
          closeSettings();
          return;
        }
        closeProvider();
      },
      [authStarting, client, closeProvider, closeSettings, flowId],
    ),
  );
  const { run: closeRun } = close;
  const changeOpen = useCallback(
    (next: boolean): void => {
      if (!next) {
        closeRun('settings');
      }
    },
    [closeRun],
  );
  const changeSection = useCallback(
    (value: string): void => {
      if (value === 'general' || value === 'models') {
        setSection(value);
      }
    },
    [setSection],
  );
  return {
    open,
    section,
    changeOpen,
    changeSection,
    closeProvider: closeRun,
    closeError: close.error,
  };
};
