import type {
  Checkpoint,
  Compaction,
  PlanReview,
  QuestionItem,
  Question,
  QuestionResponse,
  Todo,
  WorkPatch,
  WorkSnapshot,
} from '@my-pi-harness/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SelectOption } from '@/components/ui/select-field';
import type { AsyncEvent } from '@/hooks/use-async-event';
import type { Action, FormSubmit, InputChange, TextChange, ValueChange } from '@/types/events';

export interface WorkView {
  query: UseQueryResult<WorkSnapshot, Error>;
  contextLabel: string;
  conversationCount: number;
  pendingQuestions: Question[];
  reviewingPlan: boolean;
  hasRequests: boolean;
  running: boolean;
  open: boolean;
  setOpen: ValueChange<boolean>;
  tab: string;
  setTab: ValueChange<string>;
  show: Action;
  patch: (input: WorkPatch) => Promise<void>;
  command: (name: string, input: unknown) => Promise<void>;
  answer: (questionId: string, value: QuestionResponse[] | null) => Promise<void>;
}
export interface PlanPanelState {
  newTodo: string;
  changeTodo: InputChange;
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
  current: QuestionItem | undefined;
  index: number;
  selected: string[];
  text: string;
  change: TextChange;
  choose: ValueChange<string>;
  previous: Action;
  next: Action;
  submit: FormSubmit;
  cancel: Action;
  valid: boolean;
  currentValid: boolean;
  last: boolean;
  action: AsyncEvent<[QuestionResponse[] | null]>;
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
  openResetTasks: Action;
  openResetContext: Action;
  openRestore: Action;
  confirmation: CheckpointAction | null;
  changeConfirmation: ValueChange<boolean>;
  confirm: Action;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel: string;
}

export type CheckpointAction = 'reset-tasks' | 'reset-context' | 'restore';

export interface WorkDifference {
  label: string;
  left: string;
  right: string;
  changed: boolean;
}
export type ComparisonState = Pick<Checkpoint, 'state' | 'messageIds'>;
export interface SummaryRow {
  label: string;
  content: string;
}
export interface CompactionView {
  leftId: string;
  rightId: string;
  setLeftId: ValueChange<string>;
  setRightId: ValueChange<string>;
  right: Compaction | null;
  rows: WorkDifference[] | null;
  summary: SummaryRow[] | null;
  options: SelectOption[];
  action: AsyncEvent<[]>;
  confirming: boolean;
  setConfirming: ValueChange<boolean>;
  openConfirmation: Action;
  selected: boolean;
}
export interface PlanReviewView {
  feedback: string;
  changeFeedback: TextChange;
  approve: Action;
  revise: Action;
  cancel: Action;
  action: AsyncEvent<[PlanReview['decision']]>;
}
export interface TodoEvidence {
  step: string | null;
  tools: { id: string; name: string; summary: string }[];
}
