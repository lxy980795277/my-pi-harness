import type {
  McpScope,
  RemoteMcpView,
  McpReadOnlyGrantView,
  McpMetadata,
  RemoteMcpTrustPreview,
  McpServerView,
  McpToolSelection,
  McpToolView,
  McpToolCatalog,
  McpTrustPreview,
} from '@my-pi-harness/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ChangeEventHandler } from 'react';
import type { SelectOption } from '@/components/ui/select-field';
import type { Action, FormSubmit, InputChange, TextChange, ValueChange } from '@/types/events';

export type McpControlAction = 'disable' | 'revoke-trust';
export type McpDiscoveryAction = 'discover' | 'test';
export interface McpServerForm {
  name: string;
  workspaceId: string;
  command: string;
  args: string;
  publicEnvironment: string;
  secretSlots: string;
}
export interface McpSelectableTool {
  key: string;
  serverName: string;
  tool: McpToolView;
  selected: boolean;
  disabled: boolean;
  change: Action;
}
export interface McpSelectionState {
  selected: McpToolSelection[];
  rows: McpSelectableTool[];
  invalid: McpToolSelection[];
  blocked: boolean;
  locked: boolean;
  open: boolean;
  loading: boolean;
  error: string | null;
  openPicker: Action;
  changeOpen: ValueChange<boolean>;
  removeInvalid: Action;
  settings: Action;
  scope: McpScope;
  workspaceMissing: boolean;
  planMode: boolean;
  readOnly: boolean;
}
export interface McpServerItemProps {
  workspaceName: string;
  server: McpServerView;
  onEdit: ValueChange<McpServerView>;
}

export interface McpServerFormState {
  form: McpServerForm;
  workspaceOptions: SelectOption[];
  changeField: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  changeWorkspace: ValueChange<string>;
  submit: FormSubmit;
  pending: boolean;
  error: string | null;
}
export interface McpSecretState {
  slotId: string;
  value: string;
  options: SelectOption[];
  changeValue: InputChange;
  changeSlot: ValueChange<string>;
  submit: FormSubmit;
  remove: Action;
  canRemove: boolean;
  pending: boolean;
  saved: boolean;
  error: string | null;
}
export interface McpServerItemState {
  scope: McpScope;
  changeScope: ValueChange<string>;
  catalog: McpToolCatalog | null | undefined;
  preview: McpTrustPreview | null;
  startup: Action;
  trust: Action;
  closeTrust: ValueChange<boolean>;
  discoverTools: Action;
  test: Action;
  disable: Action;
  revoke: Action;
  edit: Action;
  openDelete: Action;
  deleteOpen: boolean;
  changeDeleteOpen: ValueChange<boolean>;
  remove: Action;
  deleteError: string | null;
  trustError: string | null;
  secretsOpen: boolean;
  openSecrets: Action;
  closeSecrets: Action;
  trusted: boolean;
  pending: boolean;
  error: string | null;
}
export interface McpSettingsState {
  rows: { server: McpServerView; workspaceName: string }[];
  servers: UseQueryResult<McpServerView[], Error>;
  editing: McpServerView | null | undefined;
  editorKey: string;
  create: Action;
  edit: ValueChange<McpServerView>;
  close: Action;
}

export interface McpConfigurationExchangeState {
  open: boolean;
  changeOpen: ValueChange<boolean>;
  show: Action;
  encoded: string;
  change: TextChange;
  summary: string | null;
  preview: string | null;
  download: Action;
  inspect: Action;
  save: Action;
  error: string | null;
  pending: boolean;
}
export interface RemoteMcpSettingsState {
  query: UseQueryResult<RemoteMcpView[], Error>;
  editing: RemoteMcpView | null | undefined;
  editorKey: string;
  open: Action;
  edit: ValueChange<RemoteMcpView>;
  close: Action;
}
export interface McpDirectoryState {
  hasCatalog: boolean;
  rows: { tool: McpToolView; toggle: Action; authorize: Action }[];
  grantRows: { grant: McpReadOnlyGrantView; revoke: Action }[];
  metadata: McpMetadata | null | undefined;
  tool: McpToolView | null;
  args: string;
  changeArgs: TextChange;
  close: ValueChange<boolean>;
  approve: Action;
  approvalError: string | null;
  pending: boolean;
  error: string | null;
}
export interface RemoteMcpItemState {
  preview: RemoteMcpTrustPreview | null;
  deleting: boolean;
  changeDeleting: ValueChange<boolean>;
  secretsOpen: boolean;
  changeSecrets: ValueChange<boolean>;
  secret: string;
  slot: string;
  slotOptions: SelectOption[];
  changeSecret: InputChange;
  changeSlot: ValueChange<string>;
  openSecrets: Action;
  saveSecret: Action;
  saveSecretError: string | null;
  removeSecret: Action;
  canRemoveSecret: boolean;
  openDelete: Action;
  edit: Action;
  discover: Action;
  test: Action;
  testSummary: string | null;
  disable: Action;
  connect: Action;
  disconnect: Action;
  startup: Action;
  trust: Action;
  closeTrust: ValueChange<boolean>;
  trustError: string | null;
  remove: Action;
  removeError: string | null;
  refresh: Action;
  reopenOAuth: Action;
  oauthUrl: string | null;
  error: string | null;
  pending: boolean;
}

export type McpManagementTransport = 'stdio' | 'remote';
export type RemoteMcpAction = 'discover' | 'disable' | 'oauth/start' | 'oauth/disconnect';
