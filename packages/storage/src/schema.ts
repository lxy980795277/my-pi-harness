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
  data: text('data', { mode: 'json' }).$type<RunView>().notNull(),
  privateData: text('private_data'),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  data: text('data', { mode: 'json' }).$type<MessageView>().notNull(),
  privateData: text('private_data'),
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
  privateData: text('private_data').notNull(),
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
  privateData: text('private_data'),
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
