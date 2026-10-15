import type { Todo, WorkPatch, WorkSnapshot } from '@my-pi-harness/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SelectOption } from '@/components/ui/select-field';
import type { AsyncEvent } from '@/hooks/use-async-event';
import type { Action, FormSubmit, InputChange, TextChange, ValueChange } from '@/types/view-events';
import type { WorkDifference } from '@/features/work/utils/work-view';

export interface WorkView {
  query: UseQueryResult<WorkSnapshot, Error>;
  running: boolean;
  open: boolean;
  setOpen: ValueChange<boolean>;
  tab: string;
  setTab: ValueChange<string>;
  show: Action;
  patch: (input: WorkPatch) => Promise<void>;
  command: (name: string, input: unknown) => Promise<void>;
  answer: (questionId: string, value: string | null) => Promise<void>;
}
export interface PlanPanelState {
  editing: boolean;
  title: string;
  content: string;
  newTodo: string;
  start: Action;
  cancel: Action;
  changeTitle: InputChange;
  changeContent: TextChange;
  changeTodo: InputChange;
  save: FormSubmit;
  approve: Action;
  complete: Action;
  mode: ValueChange<string>;
  addTodo: FormSubmit;
  saveTodo: (todo: Todo) => Promise<void>;
  removeTodo: (id: string) => Promise<void>;
  action: AsyncEvent<[WorkPatch]>;
}
export interface TodoRowState {
  editing: boolean;
  title: string;
  start: Action;
  cancel: Action;
  change: InputChange;
  save: Action;
  remove: Action;
  status: ValueChange<string>;
  action: AsyncEvent<[Todo | null]>;
}
export interface QuestionView {
  answer: string;
  change: TextChange;
  choose: ValueChange<string>;
  submit: FormSubmit;
  cancel: Action;
  action: AsyncEvent<[string | null]>;
}
export interface CheckpointView {
  label: string;
  changeLabel: InputChange;
  create: FormSubmit;
  leftId: string;
  setLeftId: ValueChange<string>;
  rightId: string;
  setRightId: ValueChange<string>;
  options: SelectOption[];
  differences: WorkDifference[];
  action: AsyncEvent<[string, unknown]>;
  openReset: Action;
  openRestore: Action;
  confirmation: 'reset' | 'restore' | null;
  changeConfirmation: ValueChange<boolean>;
  confirm: Action;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel: string;
}
