/** Confirmed memory is independent of session rebuilds; adoption rows are request projections. */
export const MEMORY_SQL = `
CREATE TABLE memory_entries (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES auth_users(id),
  scope_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE INDEX memory_entries_owner_scope ON memory_entries(owner_user_id, scope_key, id);
CREATE TABLE memory_settings (
  owner_user_id TEXT PRIMARY KEY NOT NULL REFERENCES auth_users(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE TABLE memory_write_receipts (
  owner_user_id TEXT NOT NULL REFERENCES auth_users(id),
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  operation TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  PRIMARY KEY (owner_user_id, request_id)
);
CREATE TABLE memory_suppressions (
  owner_user_id TEXT NOT NULL REFERENCES auth_users(id),
  memory_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  source_fingerprint TEXT NOT NULL,
  forgotten_at INTEGER NOT NULL,
  PRIMARY KEY (owner_user_id, memory_id)
);
CREATE TABLE memory_adoptions (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  run_id TEXT PRIMARY KEY NOT NULL REFERENCES runs(id),
  branch_id TEXT NOT NULL,
  task_id TEXT,
  prepared_seq INTEGER NOT NULL,
  prepared_at INTEGER NOT NULL,
  snapshot TEXT CHECK (snapshot IS NULL OR json_valid(snapshot))
);
`;
