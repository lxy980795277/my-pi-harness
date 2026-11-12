import type {
  MemoryCreateInput,
  MemoryCategory,
  MemoryAdoptedEntry,
  MemoryEntry,
  MemoryMode,
  MemoryPage,
  MemoryOmission,
  MemoryScope,
  MemorySettings,
  MemoryUpdateInput,
  MemoryUsage,
  MessageView,
} from '@my-pi-harness/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SelectOption } from '@/components/ui/select-field';
import type { AsyncEvent } from '@/hooks/use-async-event';
import type { Action, FormSubmit, TextChange, ValueChange } from '@/types/events';

export interface MemoryEditorTarget {
  entry: MemoryEntry | null;
  workspaceId: string | null;
  workspaceName: string | null;
  message?: MessageView;
  branchId?: string;
  defaultScope?: MemoryScope;
  defaultMode?: MemoryMode;
}

export interface MemoryEditorProps {
  target: MemoryEditorTarget;
  onClose: Action;
  onSaved?: Action;
}

export interface MemoryEditorState {
  title: string;
  body: string;
  category: string;
  mode: MemoryMode;
  enabled: boolean;
  scope: string;
  scopeOptions: SelectOption[];
  scopeLocked: boolean;
  sourceLabel: string;
  changeBody: TextChange;
  changeCategory: ValueChange<string>;
  changeMode: ValueChange<string>;
  changeEnabled: ValueChange<boolean>;
  changeScope: ValueChange<string>;
  submit: FormSubmit;
  save: AsyncEvent<[]>;
  close: Action;
  changeOpen: ValueChange<boolean>;
}

export interface MemorySettingsState {
  settings: UseQueryResult<MemorySettings, Error>;
  changeAllowUse: ValueChange<boolean>;
  changeAllowLearning: ValueChange<boolean>;
  updateSettings: AsyncEvent<[MemorySettingKey, boolean]>;
}

export interface MemoryPanelState extends MemorySettingsState {
  entries: UseQueryResult<MemoryPage, Error>;
  scopeValue: string;
  scopeOptions: SelectOption[];
  workspaceError: string | null;
  workspacePending: boolean;
  editor: MemoryEditorTarget | null;
  changeScope: ValueChange<string>;
  modeFilter: MemoryModeFilter;
  view: MemoryManagerView;
  changeView: ValueChange<string>;
  profileCategory: MemoryCategoryFilter;
  changeProfileCategory: ValueChange<string>;
  changeModeFilter: ValueChange<string>;
  hasPrevious: boolean;
  hasNext: boolean;
  pageLabel: string;
  previous: Action;
  next: Action;
  refresh: AsyncEvent<[]>;
  resetPage: Action;
  create: Action;
  edit: ValueChange<MemoryEntry>;
  closeEditor: Action;
}

export type MemorySettingKey = 'allowUse' | 'allowLearning';
export type MemoryManagerView = 'entries' | 'profile';
export type MemoryCategoryFilter = MemoryCategory | 'all';

export interface MemoryRowState {
  edit: Action;
  changeEnabled: ValueChange<boolean>;
  update: AsyncEvent<[boolean]>;
  forgetting: boolean;
  openForget: Action;
  changeForgetting: ValueChange<boolean>;
  forget: AsyncEvent<[]>;
}

export interface MemoryEditorAttempt {
  fingerprint: string;
  input: MemoryCreateInput | MemoryUpdateInput;
}

export interface MessageMemoryEditorState {
  target: MemoryEditorTarget | null;
  open: ValueChange<MessageView>;
  close: Action;
}

export interface MemoryAdoptionView {
  entry: MemoryAdoptedEntry;
  sourceLabel: string;
  changeLabel: string;
  modeLabel: string;
}

export interface MemoryUsageView {
  query: UseQueryResult<MemoryUsage | null, Error>;
  entries: MemoryAdoptionView[];
  selectionLabel: string;
  verificationLabel: string | null;
  selectionSummary: string | null;
  omissions: MemoryOmissionView[];
  moreOmissions: number;
  incomplete: boolean;
}

export type MemoryModeFilter = MemoryMode | 'all';

export interface MemoryPagination {
  key: string;
  cursors: readonly (string | null)[];
}

export interface MemoryOmissionView {
  omission: MemoryOmission;
  modeLabel: string;
  reasonLabel: string;
}
