import type { Action } from '@/types/events';

export type PluginAuthorizationWindow =
  | { type: 'browser'; window: Window }
  | { type: 'desktop'; expiresAt: number };

export interface PluginAuthorizationState {
  description: string;
  connected: boolean;
  loading: boolean;
  waiting: boolean;
  pending: boolean;
  error: string | null;
  label: string;
  activate: Action;
}
