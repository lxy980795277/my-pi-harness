/** Add workspace registration and execution projections without rewriting released events. */
export const WORKSPACES_SQL = `
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  root_path TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
);
CREATE UNIQUE INDEX workspaces_active_root ON workspaces(root_path) WHERE archived = 0;
ALTER TABLE sessions ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
CREATE INDEX sessions_workspace ON sessions(workspace_id, archived);
UPDATE sessions SET data = json_set(data, '$.workspaceId', NULL, '$.approvalMode', 'ask');
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
`;
