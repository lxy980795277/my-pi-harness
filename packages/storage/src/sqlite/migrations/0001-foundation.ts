/** Fresh development schema; session tables are rebuildable JSONL projections. */
export const FOUNDATION_SQL = `
CREATE TABLE provider_configs (
  id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  snapshot_seq INTEGER NOT NULL DEFAULT 0,
  active_run_id TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  workspace_id TEXT,
  data TEXT NOT NULL
);
CREATE TABLE provider_versions (
  id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (id, revision)
);
CREATE TABLE branches (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  data TEXT NOT NULL
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  data TEXT NOT NULL,
  private_data TEXT
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  data TEXT NOT NULL,
  private_data TEXT
);
CREATE TABLE branch_messages (
  branch_id TEXT NOT NULL REFERENCES branches(id),
  message_id TEXT NOT NULL REFERENCES messages(id),
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (branch_id, message_id),
  UNIQUE (branch_id, ordinal)
);
CREATE TABLE queued_inputs (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  data TEXT NOT NULL
);
CREATE TABLE events (
  event_id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version = 1),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  seq INTEGER NOT NULL,
  run_id TEXT,
  type TEXT NOT NULL,
  at INTEGER NOT NULL,
  data TEXT NOT NULL,
  private_data TEXT,
  UNIQUE (session_id, seq)
);
CREATE TABLE requests (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  request_id TEXT NOT NULL,
  run_id TEXT,
  input_id TEXT,
  PRIMARY KEY (session_id, request_id)
);
CREATE INDEX events_session_seq ON events(session_id, seq);
CREATE INDEX runs_session ON runs(session_id);
CREATE INDEX branches_session ON branches(session_id);
CREATE INDEX queue_session ON queued_inputs(session_id);
CREATE TRIGGER provider_versions_immutable_update BEFORE UPDATE ON provider_versions BEGIN
  SELECT RAISE(ABORT, 'provider versions are immutable');
END;
CREATE TRIGGER provider_versions_immutable_delete BEFORE DELETE ON provider_versions BEGIN
  SELECT RAISE(ABORT, 'provider versions are immutable');
END;

CREATE TABLE builtin_provider_slots (
  builtin_id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL UNIQUE REFERENCES provider_configs(id)
);
CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  revision INTEGER NOT NULL,
  data TEXT NOT NULL
);
INSERT INTO app_settings(id, revision, data) VALUES
  (1, 1, '{"revision":1,"defaultModel":null}');

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  root_path TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
);
CREATE UNIQUE INDEX workspaces_active_root ON workspaces(root_path) WHERE archived = 0;
CREATE INDEX sessions_workspace ON sessions(workspace_id, archived);
CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  anchor_message_id TEXT NOT NULL REFERENCES messages(id),
  data TEXT NOT NULL
);
CREATE INDEX tool_calls_session ON tool_calls(session_id, branch_id);
CREATE TABLE tool_contexts (
  tool_call_id TEXT PRIMARY KEY NOT NULL REFERENCES tool_calls(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  after_message_id TEXT NOT NULL REFERENCES messages(id),
  seq INTEGER NOT NULL,
  private_data TEXT NOT NULL
);
CREATE INDEX tool_contexts_anchor ON tool_contexts(after_message_id, seq);

CREATE TABLE work_states (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  revision INTEGER NOT NULL CHECK(revision > 0),
  data TEXT NOT NULL,
  PRIMARY KEY(session_id, branch_id)
);
CREATE TABLE attachments (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX checkpoints_session_order ON checkpoints(session_id, created_at, id);
`;
