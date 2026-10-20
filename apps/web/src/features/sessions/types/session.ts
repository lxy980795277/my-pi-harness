import type {
  MessageView,
  ProviderConfig,
  RunView,
  SessionSnapshot,
  ToolCallView,
} from '@my-pi-harness/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import type { RefObject, UIEvent } from 'react';
import type { SessionCommands } from '@/features/sessions/hooks/use-session-commands';
import type { AnswerFooter } from '@/features/sessions/types/answer-metadata';
import type { Action, FormSubmit, TextChange, ValueChange } from '@/types/events';

export type SessionCommandMethod = 'POST' | 'PUT' | 'DELETE';

export type SessionConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type TimelineEntry =
  | {
      type: 'message';
      id: string;
      createdAt: number;
      message: MessageView;
    }
  | { type: 'answer-footer'; id: string; footer: AnswerFooter }
  | { type: 'tool'; id: string; createdAt: number; tool: ToolCallView }
  | { type: 'waiting'; id: string; runId: string };

export interface LiveSession {
  query: UseQueryResult<SessionSnapshot, Error>;
  connection: SessionConnectionStatus;
  connectionError: string | null;
}

export interface ComposerState {
  draft: string;
  changeDraft: TextChange;
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
  download: Action;
  downloading: boolean;
  reload: Action;
  error: string | null;
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
export interface MessageTimelineState {
  scrollElement: RefObject<HTMLDivElement | null>;
  empty: boolean;
  rows: TimelineRow[];
  measureList: (node: HTMLDivElement | null) => void;
  measureRow: (node: HTMLDivElement | null) => void;
  showJump: boolean;
  jump: Action;
  scroll: (event: UIEvent<HTMLDivElement>) => void;
}
export interface TimelineRow {
  index: number;
  entry: TimelineEntry;
}
export interface SessionsWorkspaceState {
  activeId: string | null;
  generation: string;
  providersQuery: UseQueryResult<ProviderConfig[], Error>;
  created: ValueChange<SessionSnapshot>;
}
