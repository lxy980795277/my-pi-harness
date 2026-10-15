import type { SettingsSection } from '@/app/stores/workspace';
import type { Action, ValueChange } from '@/types/view-events';

export interface SettingsDialogState {
  open: boolean;
  section: SettingsSection;
  changeOpen: ValueChange<boolean>;
  changeSection: ValueChange<string>;
  closeProvider: ValueChange<'settings' | 'provider'>;
  closeError: string | null;
}
export interface ProviderDialogCloseState {
  close: Action;
  changeOpen: ValueChange<boolean>;
  error: string | null;
}

export interface SettingsDialogProps {
  theme: 'light' | 'dark';
  onToggleTheme: Action;
}
