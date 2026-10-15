import type { AuthStatus } from '@my-pi-harness/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import type { WorkspacePage } from '@/app/stores/workspace';
import type { Action, ValueChange } from '@/types/view-events';

export interface ApplicationShellState {
  settingsOpen: boolean;
  startNewConversation: Action;
  newConversation: boolean;
  userName: string;
  theme: 'light' | 'dark';
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
