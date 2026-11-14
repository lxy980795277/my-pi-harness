/** File images share immutable blob storage; all history and operations replay from JSONL. */
export const FILE_CHANGES_SQL = `
CREATE TABLE file_operations (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  target_key TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX file_operations_session ON file_operations(session_id, seq DESC);
CREATE INDEX file_operations_target ON file_operations(target_key, expected_revision);
CREATE TABLE file_changes (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  tool_call_id TEXT,
  answer_input_message_id TEXT,
  task_id TEXT,
  data TEXT NOT NULL
);
CREATE INDEX file_changes_session ON file_changes(session_id, seq DESC);
CREATE INDEX file_changes_tool ON file_changes(session_id, tool_call_id, seq DESC);
CREATE INDEX file_changes_answer ON file_changes(session_id, answer_input_message_id, seq DESC);
CREATE TABLE file_change_heads (target_key TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL);
CREATE TABLE file_image_refs (
  operation_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  PRIMARY KEY(operation_id, sha256)
);
CREATE TABLE file_change_batches (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX file_change_batches_session ON file_change_batches(session_id, seq DESC);
`;
