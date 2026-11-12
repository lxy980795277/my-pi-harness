import type { LoginFlow, LoginMethod } from '@my-pi-harness/protocol';
import type { Action } from '@/types/events';

export interface LoginPageState {
  flow: LoginFlow | null;
  configured: boolean;
  configurationMessage: string | null;
  safeUrl: string | null;
  error: string | null;
  pending: boolean;
  showLoginButton: boolean;
  showFlow: boolean;
  loginButtonLabel: string;
  loginButtonBusy: boolean;
  canRestart: boolean;
  canComplete: boolean;
  desktop: boolean;
  start: Action;
  cancel: Action;
  cancelPending: boolean;
  retryCompletion: Action;
  openDesktop: Action;
}

export interface LoginEntry {
  method: LoginMethod;
  configured: boolean;
  configurationMessage: string | null;
}

export interface LoginCallback {
  flowId: string | null;
  cleanUrl: string;
  error: string | null;
}
