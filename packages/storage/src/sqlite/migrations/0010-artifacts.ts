/** Artifact metadata is rebuilt from host publication facts; exact bytes live outside SQLite. */
export const ARTIFACTS_SQL = `
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX artifacts_session ON artifacts(session_id);
CREATE INDEX artifacts_hash ON artifacts(sha256);
`;
