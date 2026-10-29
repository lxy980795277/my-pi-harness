/** Agent execution facts are rebuilt from the owning session journal. */
export const AGENT_TASKS_SQL = `
ALTER TABLE runs ADD COLUMN task_id TEXT;
CREATE INDEX runs_task ON runs(task_id);
CREATE TABLE agent_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  source_tool_call_id TEXT NOT NULL UNIQUE,
  parent_run_id TEXT NOT NULL,
  root_run_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  anchor_message_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  waiting TEXT,
  closed_at INTEGER,
  close_reason TEXT,
  error TEXT,
  data TEXT NOT NULL
);
CREATE INDEX agent_tasks_session ON agent_tasks(session_id, created_at);
CREATE INDEX agent_tasks_parent ON agent_tasks(parent_run_id);
CREATE INDEX agent_tasks_root ON agent_tasks(root_run_id);
CREATE TABLE task_messages (
  task_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (task_id, message_id),
  UNIQUE (task_id, ordinal)
);
CREATE TABLE task_work_states (
  task_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE agent_messages (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  source_run_id TEXT NOT NULL,
  target_run_id TEXT,
  target_task_id TEXT,
  data TEXT NOT NULL
);
CREATE INDEX agent_messages_task ON agent_messages(target_task_id);
CREATE INDEX agent_messages_run ON agent_messages(target_run_id);
CREATE TABLE agent_settings (
  id INTEGER PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL,
  data TEXT NOT NULL
);
`;
