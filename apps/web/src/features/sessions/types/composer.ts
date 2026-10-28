import type {
  ApprovalMode,
  DefaultModel,
  InputRequest,
  WorkspaceIcon,
} from '@my-pi-harness/protocol';
import type { CompositionEventHandler, KeyboardEventHandler, ReactNode } from 'react';
import type { SelectOption } from '@/components/ui/select-field';
import type { ModelMenuGroup } from '@/features/models/types/model-menu';
import type { SkillSelectionState } from '@/features/skills/types/skill';
import type { McpSelectionState } from '@/features/mcp/types/mcp';
import type { Action, FormSubmit, TextChange, ValueChange } from '@/types/events';

export interface ComposerCompositionState {
  active: boolean;
  endedAt: number | null;
}

export type ComposerKey = Pick<
  globalThis.KeyboardEvent,
  'key' | 'shiftKey' | 'altKey' | 'isComposing' | 'timeStamp'
>;

export interface ComposerKeyboardHandlers {
  keyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  keyUp: KeyboardEventHandler<HTMLTextAreaElement>;
  compositionStart: CompositionEventHandler<HTMLTextAreaElement>;
  compositionEnd: CompositionEventHandler<HTMLTextAreaElement>;
}

export interface ComposerChoices {
  workspaceValue: string;
  workspaceOptions: SelectOption[];
  workspaceLocked: boolean;
  workspaceLabel: string;
  workspaceIcon: WorkspaceIcon;
  changeWorkspace: ValueChange<string>;
  approvalMode: ApprovalMode;
  changeApprovalMode: ValueChange<string>;
  modelKey: string;
  modelGroups: ModelMenuGroup[];
  changeModel: ValueChange<string>;
  thinking: string;
  thinkingOptions: SelectOption[];
  changeThinking: ValueChange<string>;
  settings: Action;
  disabled: boolean;
}

export interface ComposerSurfaceProps {
  id: string;
  draft: string;
  changeDraft: TextChange;
  submit: FormSubmit;
  choices: ComposerChoices;
  pending: boolean;
  disabled: boolean;
  draftLocked?: boolean;
  running?: boolean;
  stopping?: boolean;
  stop?: Action;
  footer?: ReactNode;
  error: string | null;
  uncertain?: boolean;
  attachmentDraftKey: string;
  attachmentIds: string[];
  removeAttachment: (id: string) => void;
  mcp: McpSelectionState;
  skills: SkillSelectionState;
}

export interface NewSessionState extends Omit<ComposerSurfaceProps, 'id'> {
  invalid: boolean;
}

export interface NewConversationIntent {
  model: DefaultModel;
  workspaceId: string | null;
  approvalMode: ApprovalMode;
  input: InputRequest;
}

export type NewConversationAttempt = NewConversationIntent & { generation: string } & (
    | { phase: 'created'; sessionId: string }
    | { phase: 'creating'; sessionId: null }
    | { phase: 'unknown'; sessionId: null }
  );

export interface ComposerChoicesState {
  submitBlocked: boolean;
  choices: ComposerChoices;
  error: string | null;
}
