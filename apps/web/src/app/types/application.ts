import type { AuthStatus } from '@my-pi-harness/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import type { RefObject } from 'react';
import type { Action, ValueChange } from '@/types/events';
import type { ApplicationInitialization } from '@/app/types/initialization';

export type Theme = 'light' | 'dark';
export type WorkspacePage = 'sessions' | 'runtime';

export interface ApplicationShellState {
  initialization: ApplicationInitialization;
  settingsOpen: boolean;
  startNewConversation: Action;
  newConversation: boolean;
  userName: string;
  theme: Theme;
  themeLabel: string;
  toggleTheme: Action;
  auth: UseQueryResult<AuthStatus, Error>;
  pair: (code: string) => Promise<void>;
  receiveLogin: (status: AuthStatus) => void;
  localAuthorized: boolean;
  checkingAuthorization: boolean;
  page: WorkspacePage;
  pageLabel: string;
  navigate: ValueChange<WorkspacePage>;
  authorized: boolean;
  pairingCode: string | null;
  hideCode: Action;
  settings: Action;
  signOut: Action;
  pairing: Action;
  reconnect: Action;
  actionError: string | null;
}
export interface NavigationItemState {
  current: 'page' | undefined;
  select: Action;
  className: string;
}

export interface UserProfile {
  name: string;
  initial: string;
  avatarUrl: string | null;
}
export interface UserProfileState extends UserProfile {
  failAvatar: Action;
}

export interface UserMenuState {
  open: boolean;
  trigger: RefObject<HTMLButtonElement | null>;
  changeOpen: ValueChange<boolean>;
  settings: Action;
  logout: Action;
  logoutOpen: boolean;
  changeLogoutOpen: ValueChange<boolean>;
  confirmLogout: Action;
  closeFocus: (event: Event) => void;
}
