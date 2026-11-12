import type {
  SearchHit,
  SearchQueryInput,
  SearchQueryResult,
  SearchSourceSelection,
  SearchSourceWindow,
  SessionSnapshot,
} from '@my-pi-harness/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SelectOption } from '@/components/ui/select-field';
import type { AsyncEvent } from '@/hooks/use-async-event';
import type { Action, FormSubmit, InputChange, ValueChange } from '@/types/events';

export type SearchPeriod = 'all' | 'week' | 'month' | 'year';
export type SourceReaderAction =
  | { kind: 'quote'; selection: SearchSourceSelection }
  | { kind: 'locate' };
export interface SearchFilters {
  query: string;
  kind: 'message' | 'memory';
  workspace: string;
  period: SearchPeriod;
  archived: boolean;
  historical: boolean;
  tasks: boolean;
  userMemories: boolean;
  branchId: string;
}
export interface SearchIntent {
  input: SearchQueryInput;
  fingerprint: string;
}
export interface SearchDialogState {
  filters: SearchFilters;
  changeQuery: InputChange;
  changeKind: ValueChange<string>;
  changeWorkspace: ValueChange<string>;
  changePeriod: ValueChange<string>;
  changeBranch: ValueChange<string>;
  changeArchived: ValueChange<boolean>;
  changeHistorical: ValueChange<boolean>;
  changeTasks: ValueChange<boolean>;
  changeUserMemories: ValueChange<boolean>;
  workspaceOptions: SelectOption[];
  branchOptions: SelectOption[];
  submit: FormSubmit;
  results: UseQueryResult<SearchQueryResult, Error>;
  hasIntent: boolean;
  indexLabel: string | null;
  selected: SearchSourceSelection | null;
  openResult: ValueChange<SearchHit>;
  closeSource: Action;
  close: Action;
  changeOpen: ValueChange<boolean>;
  activeSessionId: string | null;
  activeSnapshot: SessionSnapshot | undefined;
  error: string | null;
  ownerId: string;
}
export interface SourceReaderState {
  query: UseQueryResult<SearchSourceWindow, Error>;
  previous: Action;
  next: Action;
  previousText: Action;
  nextText: Action;
  canPreviousText: boolean;
  canNextText: boolean;
  action: AsyncEvent<[SourceReaderAction]>;
  quote: ValueChange<SearchSourceSelection>;
  quoteSelected: Action;
  selectedText: string | null;
  locate: Action;
  canLocate: boolean;
}

export interface ComposerSourceState {
  title: string;
  text: string | null;
  open: Action;
  remove: Action;
}

export interface SourceWorkspaceView {
  label: string;
  detailId: string | null;
}
