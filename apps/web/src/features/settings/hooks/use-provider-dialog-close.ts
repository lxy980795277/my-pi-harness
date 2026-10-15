import type { ProviderDialogCloseState } from '@/features/settings/types/settings-view';
import { useCallback } from 'react';
import { useSettingsDialog } from '@/features/settings/hooks/use-settings-dialog';

/** Both Escape and the cancel button use the same owned-flow cleanup. */
export const useProviderDialogClose = (): ProviderDialogCloseState => {
  const settings = useSettingsDialog();
  const { closeProvider: settingsCloseProvider } = settings;
  const close = useCallback((): void => {
    settingsCloseProvider('provider');
  }, [settingsCloseProvider]);
  const changeOpen = useCallback(
    (open: boolean): void => {
      if (!open) {
        close();
      }
    },
    [close],
  );
  return { close, changeOpen, error: settings.closeError };
};
