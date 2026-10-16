import type { AuthStatus } from '@my-pi-harness/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Action, ValueChange } from '@/types/events';

export type Theme = 'light' | 'dark';
export type WorkspacePage = 'sessions' | 'runtime';
export type SettingsSection = 'general' | 'models';

export interface ApplicationShellState {
  settingsOpen: boolean;
  startNewConversation: Action;
  newConversation: boolean;
  userName: string;
  theme: Theme;
  themeLabel: string;
  toggleTheme: Action;
  auth: UseQueryResult<AuthStatus, Error>;
  pair: (code: string) => Promise<void>;
  page: WorkspacePage;
  pageLabel: string;
  navigate: ValueChange<WorkspacePage>;
  authorized: boolean;
  pairingCode: string | null;
  hideCode: Action;
  settings: Action;
  signOut: Action;
  pairing: Action;
  github: Action;
  reconnect: Action;
  actionError: string | null;
}
export interface NavigationItemState {
  current: 'page' | undefined;
  select: Action;
  className: string;
}
