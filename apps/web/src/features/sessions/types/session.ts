import type { ProviderConfig, RunView, SessionSnapshot } from '@my-pi-harness/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Key, RefObject, UIEvent } from 'react';
import type { SelectOption } from '@/components/ui/select-field';
import type { SessionCommands } from '@/features/sessions/hooks/use-session-commands';
import type { Action, FormSubmit, InputChange, TextChange, ValueChange } from '@/types/events';
import type { TimelineEntry } from '@/features/sessions/utils/timeline-entries';

export type SessionCommandMethod = 'POST' | 'PUT' | 'DELETE';

export type SessionConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface LiveSession {
  query: UseQueryResult<SessionSnapshot, Error>;
  connection: SessionConnectionStatus;
  connectionError: string | null;
}

export interface SessionSettingsState {
  title: string;
  providerId: string;
  modelId: string;
  thinkingLevel: string;
  providerOptions: SelectOption[];
  modelOptions: SelectOption[];
  thinkingOptions: SelectOption[];
  changeTitle: InputChange;
  changeProvider: ValueChange<string>;
  changeModel: ValueChange<string>;
  changeThinking: ValueChange<string>;
  submit: FormSubmit;
  pending: boolean;
  modelsReady: boolean;
  legacy: boolean;
  disabled: boolean;
  error: string | null;
}
export interface ComposerState {
  draft: string;
  changeDraft: TextChange;
  mode: string;
  changeMode: ValueChange<string>;
  modeOptions: SelectOption[];
  submit: FormSubmit;
  stop: Action;
  running: boolean;
  stopping: boolean;
  pending: boolean;
  disabled: boolean;
  error: string | null;
  draftLocked: boolean;
  uncertain: boolean;
  attachmentDraftKey: string;
  attachmentIds: string[];
  removeAttachment: (id: string) => void;
}
export interface ConversationState extends LiveSession {
  commands: SessionCommands;
  snapshot: SessionSnapshot | undefined;
  lastRun: RunView | undefined;
  branchOptions: SelectOption[];
  branch: ValueChange<string>;
  branchPending: boolean;
  confirmDelete: boolean;
  openDelete: Action;
  cancelDelete: Action;
  remove: Action;
  deletePending: boolean;
  reload: Action;
  branchError: string | null;
}
export interface MessageEditorState {
  editing: boolean;
  text: string;
  changeText: TextChange;
  submit: FormSubmit;
  start: Action;
  cancel: Action;
  pending: boolean;
  error: string | null;
}
export interface QueueItemState {
  editing: boolean;
  text: string;
  changeText: TextChange;
  start: Action;
  cancel: Action;
  update: Action;
  remove: Action;
  pending: boolean;
  error: string | null;
}
export interface SessionNavigationState {
  select: Action;
  current: 'page' | undefined;
  className: string;
  createdAtLabel: string;
  createdAtTitle: string;
}
export interface TimelineRow {
  key: Key;
  index: number;
  entry: TimelineEntry;
  measure: (node: HTMLDivElement | null) => void;
}
export interface MessageTimelineState {
  scrollElement: RefObject<HTMLDivElement | null>;
  showJump: boolean;
  jump: Action;
  scroll: (event: UIEvent<HTMLDivElement>) => void;
  measureList: (node: HTMLDivElement | null) => void;
  rows: TimelineRow[];
}
export interface SessionsWorkspaceState {
  activeId: string | null;
  generation: string;
  providersQuery: UseQueryResult<ProviderConfig[], Error>;
  created: ValueChange<SessionSnapshot>;
  deleted: Action;
}
