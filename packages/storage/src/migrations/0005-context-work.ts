/** Branch-local work snapshots, frozen attachments and immutable checkpoint projections. */
export const CONTEXT_WORK_SQL = `
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
