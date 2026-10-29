import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type {
  BranchView,
  AppSettings,
  HarnessEvent,
  MessageView,
  ProviderConfig,
  QueueInput,
  RunView,
  SessionSummary,
  Workspace,
  ToolCallRecord,
  WorkState,
  Attachment,
  Checkpoint,
  AgentTask,
  AgentMessage,
  AgentSettings,
} from '@my-pi-harness/protocol';

/** Private SQLite columns never serve as HTTP responses without protocol validation. */
export const providers = sqliteTable('provider_configs', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull(),
  data: text('data', { mode: 'json' }).$type<ProviderConfig>().notNull(),
});

export const builtinSlots = sqliteTable('builtin_provider_slots', {
  builtinId: text('builtin_id').primaryKey(),
  providerId: text('provider_id').notNull().unique(),
});

export const appSettings = sqliteTable('app_settings', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull(),
  data: text('data', { mode: 'json' }).$type<AppSettings>().notNull(),
});

export const providerVersions = sqliteTable(
  'provider_versions',
  {
    id: text('id').notNull(),
    revision: integer('revision').notNull(),
    data: text('data', { mode: 'json' }).$type<ProviderConfig>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.id, table.revision] })],
);

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  rootPath: text('root_path').notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  data: text('data', { mode: 'json' }).$type<Workspace>().notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  snapshotSeq: integer('snapshot_seq').notNull(),
  activeRunId: text('active_run_id'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  workspaceId: text('workspace_id'),
  data: text('data', { mode: 'json' }).$type<SessionSummary>().notNull(),
});

export const branches = sqliteTable('branches', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  data: text('data', { mode: 'json' }).$type<BranchView>().notNull(),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  branchId: text('branch_id').notNull(),
  taskId: text('task_id'),
  data: text('data', { mode: 'json' }).$type<RunView>().notNull(),
  privateData: text('private_data', { mode: 'json' }).$type<Record<string, unknown>>(),
});

export const agentTasks = sqliteTable('agent_tasks', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  sourceToolCallId: text('source_tool_call_id').notNull().unique(),
  parentRunId: text('parent_run_id').notNull(),
  rootRunId: text('root_run_id').notNull(),
  branchId: text('branch_id').notNull(),
  anchorMessageId: text('anchor_message_id').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  waiting: text('waiting'),
  closedAt: integer('closed_at'),
  closeReason: text('close_reason'),
  error: text('error'),
  data: text('data', { mode: 'json' }).$type<AgentTask>().notNull(),
});

export const taskMessages = sqliteTable(
  'task_messages',
  {
    taskId: text('task_id').notNull(),
    messageId: text('message_id').notNull(),
    ordinal: integer('ordinal').notNull(),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.messageId] })],
);

export const taskWorkStates = sqliteTable('task_work_states', {
  taskId: text('task_id').primaryKey(),
  sessionId: text('session_id').notNull(),
  revision: integer('revision').notNull(),
  data: text('data', { mode: 'json' }).$type<WorkState>().notNull(),
});

export const agentMessages = sqliteTable('agent_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  sourceRunId: text('source_run_id').notNull(),
  targetRunId: text('target_run_id'),
  targetTaskId: text('target_task_id'),
  data: text('data', { mode: 'json' }).$type<AgentMessage>().notNull(),
});

export const agentSettings = sqliteTable('agent_settings', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull(),
  data: text('data', { mode: 'json' }).$type<AgentSettings>().notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  data: text('data', { mode: 'json' }).$type<MessageView>().notNull(),
  privateData: text('private_data', { mode: 'json' }).$type<Record<string, unknown>>(),
});

export const toolCalls = sqliteTable('tool_calls', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  branchId: text('branch_id').notNull(),
  runId: text('run_id').notNull(),
  anchorMessageId: text('anchor_message_id').notNull(),
  data: text('data', { mode: 'json' }).$type<ToolCallRecord>().notNull(),
});

export const toolContexts = sqliteTable('tool_contexts', {
  toolCallId: text('tool_call_id').primaryKey(),
  sessionId: text('session_id').notNull(),
  runId: text('run_id').notNull(),
  afterMessageId: text('after_message_id').notNull(),
  seq: integer('seq').notNull(),
  privateData: text('private_data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
});

export const branchMessages = sqliteTable(
  'branch_messages',
  {
    branchId: text('branch_id').notNull(),
    messageId: text('message_id').notNull(),
    ordinal: integer('ordinal').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.branchId, table.messageId] }),
    uniqueIndex('branch_message_ordinal').on(table.branchId, table.ordinal),
  ],
);

export const queue = sqliteTable('queued_inputs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  data: text('data', { mode: 'json' }).$type<QueueInput>().notNull(),
  privateData: text('private_data', { mode: 'json' }).$type<Record<string, unknown>>(),
});

export const events = sqliteTable('events', {
  eventId: text('event_id').primaryKey(),
  version: integer('version').$type<HarnessEvent['version']>().notNull().default(1),
  sessionId: text('session_id').notNull(),
  seq: integer('seq').notNull(),
  runId: text('run_id'),
  type: text('type').notNull(),
  at: integer('at').notNull(),
  data: text('data', { mode: 'json' }).$type<HarnessEvent['data']>().notNull(),
  privateData: text('private_data', { mode: 'json' }).$type<Record<string, unknown>>(),
});

export const requests = sqliteTable(
  'requests',
  {
    sessionId: text('session_id').notNull(),
    requestId: text('request_id').notNull(),
    runId: text('run_id'),
    inputId: text('input_id'),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.requestId] })],
);

/** Validated snapshots are projected from immutable work.updated events. */
export const workStates = sqliteTable(
  'work_states',
  {
    sessionId: text('session_id').notNull(),
    branchId: text('branch_id').notNull(),
    revision: integer('revision').notNull(),
    data: text('data', { mode: 'json' }).$type<WorkState>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.branchId] })],
);

/** Attachment metadata is a rebuildable index; frozen content lives in immutable private files. */
export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  data: text('data', { mode: 'json' }).$type<Attachment>().notNull(),
});

export const checkpoints = sqliteTable('checkpoints', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  branchId: text('branch_id').notNull(),
  createdAt: integer('created_at').notNull(),
  data: text('data', { mode: 'json' }).$type<Checkpoint>().notNull(),
});
