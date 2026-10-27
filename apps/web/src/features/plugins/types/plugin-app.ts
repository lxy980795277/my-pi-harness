import type { McpToolCatalog, McpToolView } from '@my-pi-harness/protocol';
import type { Action } from '@/types/events';

export type PluginAppAction = { type: 'refresh' } | { type: 'tool'; tool: McpToolView };

export interface PluginAppOAuthState {
  authorize: Action;
  waiting: boolean;
  pending: boolean;
  error: string | null;
}

export interface PluginAppRowState {
  authorizationRequired: boolean;
  authorizationLabel: string;
  authorize: Action;
  pending: boolean;
  error: string | null;
}

export interface PluginAppConnectionState {
  authDescription: string;
  authLabel: string;
  authorize: Action;
  canAuthorize: boolean;
  canRefresh: boolean;
  refresh: Action;
  pending: boolean;
  catalog: McpToolCatalog | null;
  toolRows: { tool: McpToolView; change: Action }[];
  error: string | null;
}
