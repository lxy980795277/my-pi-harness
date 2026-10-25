import type { ChangeEvent } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type {
  ConnectionView,
  ConnectionProviderView,
  ConnectionServiceId,
  ConnectionAuthMode,
} from '@my-pi-harness/protocol';
export type ConnectionAction = 'oauth/start' | 'oauth/cancel' | 'disconnect';
export type ConnectionEditorState = ConnectionView | null | undefined;
export interface ConnectionItemProps {
  connection: ConnectionView;
  onEdit: (connection: ConnectionView) => void;
}
export interface ConnectionsSettingsState {
  connections: UseQueryResult<ConnectionView[]>;
  providers: UseQueryResult<ConnectionProviderView[]>;
  providerOptions: { value: string; label: string }[];
  editing: ConnectionEditorState;
  serviceId: ConnectionServiceId;
  authMode: ConnectionAuthMode;
  name: string;
  clientId: string;
  scopes: string;
  open: () => void;
  edit: (connection: ConnectionView) => void;
  close: (open: boolean) => void;
  changeService: (value: string) => void;
  changeAuth: (value: string) => void;
  changeName: (event: ChangeEvent<HTMLInputElement>) => void;
  changeClientId: (event: ChangeEvent<HTMLInputElement>) => void;
  changeScopes: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  save: () => void;
  pending: boolean;
  error: string | null;
  refresh: () => void;
}
export interface ConnectionItemState {
  secret: string;
  secretLabel: string;
  saveLabel: string;
  changeSecret: (event: ChangeEvent<HTMLInputElement>) => void;
  save: () => void;
  connect: () => void;
  disconnect: () => void;
  cancel: () => void;
  edit: () => void;
  askDelete: () => void;
  deleting: boolean;
  closeDelete: (open: boolean) => void;
  remove: () => void;
  oauthUrl: string | null;
  reopen: () => void;
  pending: boolean;
  error: string | null;
}
