import type {
  ApprovalMode,
  DefaultModel,
  InputRequest,
  WorkspaceIcon,
} from '@my-pi-harness/protocol';
import type { KeyboardEvent } from 'react';
import type { SelectOption } from '@/components/ui/select-field';
import type { Action, FormSubmit, TextChange, ValueChange } from '@/types/view-events';

export interface ComposerChoices {
  workspaceValue: string;
  workspaceOptions: SelectOption[];
  workspaceLocked: boolean;
  workspaceLabel: string;
  workspacePath: string | undefined;
  workspaceIcon: WorkspaceIcon;
  changeWorkspace: ValueChange<string>;
  approvalMode: ApprovalMode;
  changeApprovalMode: ValueChange<string>;
  modelKey: string;
  modelOptions: SelectOption[];
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
  keyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  submit: FormSubmit;
  choices: ComposerChoices;
  pending: boolean;
  disabled: boolean;
  draftLocked?: boolean;
  running?: boolean;
  stopping?: boolean;
  stop?: Action;
  mode?: string;
  modeOptions?: SelectOption[];
  changeMode?: ValueChange<string>;
  error: string | null;
  uncertain?: boolean;
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
  choices: ComposerChoices;
  error: string | null;
}

export interface ToolCardState {
  statusLabel: string;
  argumentsText: string;
  needsApproval: boolean;
  allow: Action;
  deny: Action;
  pending: boolean;
  error: string | null;
}
