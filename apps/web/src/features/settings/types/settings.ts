import type { Theme } from '@/app/types/application';
import type { Action, ValueChange } from '@/types/events';

export type SettingsCloseTarget = 'settings' | 'provider';

export type SettingsSection =
  | 'general'
  | 'models'
  | 'mcp'
  | 'skills'
  | 'plugins'
  | 'connections'
  | 'agents';

export interface SettingsDialogState {
  open: boolean;
  section: SettingsSection;
  changeOpen: ValueChange<boolean>;
  changeSection: ValueChange<string>;
  closeProvider: ValueChange<SettingsCloseTarget>;
  closeError: string | null;
}
export interface ProviderDialogCloseState {
  close: Action;
  changeOpen: ValueChange<boolean>;
  error: string | null;
}

export interface SettingsDialogProps {
  theme: Theme;
  onToggleTheme: Action;
}
