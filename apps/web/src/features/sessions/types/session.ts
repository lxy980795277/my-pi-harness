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
import type { SkillSelectionState } from '@/features/skills/types/skill';
import type { McpSelectionState } from '@/features/mcp/types/mcp';
import type { Action, FormSubmit, TextChange, ValueChange } from '@/types/events';

export type SessionCommandMethod = 'POST' | 'PUT' | 'DELETE';

export type SessionConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type TimelineMessagePart = 'all' | 'thinking' | 'body';

export interface AnswerTurn {
  user: MessageView;
  assistants: MessageView[];
}

export type TimelineContentEntry =
  | {
      type: 'message';
      id: string;
      createdAt: number;
      message: MessageView;
      part?: TimelineMessagePart;
    }
  | { type: 'tool'; id: string; createdAt: number; tool: ToolCallView };

export interface TimelineProcessEntry {
  type: 'process';
  id: string;
  sessionId: string;
  inputId: string;
  durationLabel: string;
  entries: readonly TimelineContentEntry[];
}

export type TimelineEntry =
  | TimelineContentEntry
  | TimelineProcessEntry
  | { type: 'answer-footer'; id: string; footer: AnswerFooter }
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
  mcp: McpSelectionState;
  skills: SkillSelectionState;
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
  mcp: McpSelectionState;
  skills: SkillSelectionState;
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
  mcp: McpSelectionState;
  skills: SkillSelectionState;
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
  contentElement: RefObject<HTMLDivElement | null>;
  empty: boolean;
  rows: TimelineRow[];
  measureList: (node: HTMLDivElement | null) => void;
  measureRow: (node: HTMLDivElement | null) => void;
  showJump: boolean;
  beforeProcessToggle: Action;
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
