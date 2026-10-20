import { create } from 'zustand';
import type { SettingsSection } from '@/features/settings/types/settings';

interface SettingsState {
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  providerDialogId: string | null;
  providerAuthFlowId: string | null;
  providerAuthStarting: boolean;
  modelsDialogId: string | null;
  reset: () => void;
  openSettings: (section: SettingsSection) => void;
  closeSettings: () => void;
  setSettingsSection: (section: SettingsSection) => void;
  openProvider: (id: string) => void;
  closeProvider: () => void;
  setProviderAuthFlow: (id: string | null) => void;
  setProviderAuthStarting: (starting: boolean) => void;
  openModels: (id: string) => void;
  closeModels: () => void;
}

/** Owns settings, Provider and model dialogs; configuration facts remain in Query. */
export const useSettingsStore = create<SettingsState>((set) => {
  return {
    settingsOpen: false,
    settingsSection: 'models',
    providerDialogId: null,
    providerAuthFlowId: null,
    providerAuthStarting: false,
    modelsDialogId: null,
    reset: (): void => {
      set({
        settingsOpen: false,
        settingsSection: 'models',
        providerDialogId: null,
        providerAuthFlowId: null,
        providerAuthStarting: false,
        modelsDialogId: null,
      });
    },
    openSettings: (section: SettingsSection): void => {
      set({ settingsOpen: true, settingsSection: section });
    },
    closeSettings: (): void => {
      set({
        settingsOpen: false,
        providerDialogId: null,
        providerAuthFlowId: null,
        providerAuthStarting: false,
        modelsDialogId: null,
      });
    },
    setSettingsSection: (section: SettingsSection): void => {
      set({ settingsSection: section });
    },
    openProvider: (id: string): void => {
      set({ providerDialogId: id, providerAuthFlowId: null });
    },
    closeProvider: (): void => {
      set({ providerDialogId: null, providerAuthFlowId: null });
    },
    setProviderAuthStarting: (providerAuthStarting: boolean): void => {
      set({ providerAuthStarting });
    },
    setProviderAuthFlow: (id: string | null): void => {
      set({ providerAuthFlowId: id });
    },
    openModels: (id: string): void => {
      set({ modelsDialogId: id });
    },
    closeModels: (): void => {
      set({ modelsDialogId: null });
    },
  };
});
