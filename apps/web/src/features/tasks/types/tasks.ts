import type {
  AgentBoard,
  AgentLimits,
  AgentRole,
  AgentSettings,
  AgentTaskDetail,
  AgentTaskList,
  AgentTaskSummary,
  ProviderConfig,
  Question,
  QuestionResponse,
  ToolCallView,
  ToolDecisionInput,
} from '@my-pi-harness/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SelectOption } from '@/components/ui/select-field';
import type { AsyncEvent } from '@/hooks/use-async-event';
import type { Action, FormSubmit, InputChange, TextChange, ValueChange } from '@/types/events';
import type { TaskFilter } from '@/features/tasks/stores/tasks';
import type { TaskBoardColumn, TaskTreeItem } from '@/features/tasks/utils/task-view';

export interface TaskDetailState {
  query: UseQueryResult<AgentTaskDetail, Error>;
  cursor: number;
  previous: Action;
  next: Action;
  text: string;
  changeText: TextChange;
  submit: FormSubmit;
  sending: AsyncEvent<[]>;
  stopping: AsyncEvent<[]>;
  answer: (id: string, answers: QuestionResponse[] | null) => Promise<void>;
  command: (name: string, input: unknown) => Promise<void>;
  decide: (id: string, decision: ToolDecisionInput['decision']) => Promise<void>;
  pendingQuestions: Question[];
  pendingTools: ToolCallView[];
  modelLabel: string;
  canStop: boolean;
  canMessage: boolean;
  uncertain: boolean;
  draftLocked: boolean;
  continuing: boolean;
}

export interface TaskDialogState {
  sessionId: string | null;
  selected: AgentTaskSummary | undefined;
  tree: TaskTreeItem[];
  query: UseQueryResult<AgentTaskList, Error>;
  changeOpen: ValueChange<boolean>;
  conversation: Action;
}

export interface SessionTaskEntryState {
  show: Action;
  count: number;
  pending: number;
}

export interface TaskBoardState {
  query: UseQueryResult<AgentBoard, Error>;
  cursor: number;
  previous: Action;
  next: Action;
  tasks: AgentTaskSummary[];
  columns: TaskBoardColumn[];
  workspaceId: string | null;
  workspaceOptions: SelectOption[];
  changeWorkspace: ValueChange<string>;
  filter: TaskFilter;
  filterOptions: SelectOption[];
  changeFilter: ValueChange<string>;
}

export interface AgentLimitField {
  key: keyof AgentLimits;
  label: string;
  value: number;
  change: InputChange;
}

export interface AgentSettingsEditorState {
  draft: AgentSettings;
  fields: AgentLimitField[];
  providers: ProviderConfig[];
  save: AsyncEvent<[]>;
  reload: AsyncEvent<[]>;
  submit: FormSubmit;
  changeEnabled: ValueChange<boolean>;
  updateRole: ValueChange<AgentRole>;
}

export interface AgentRoleEditorState {
  changeName: InputChange;
  changeDescription: InputChange;
  changeInstructions: TextChange;
  changeEnabled: ValueChange<boolean>;
  changeAccess: ValueChange<string>;
  changeModel: ValueChange<string>;
  changeThinking: ValueChange<string>;
  modelValue: string;
  thinkingValue: string;
  modelOptions: SelectOption[];
  thinkingOptions: SelectOption[];
  accessOptions: SelectOption[];
}
