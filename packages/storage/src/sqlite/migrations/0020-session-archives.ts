/** Imported history is readable independently from explicitly rebound local execution. */
export const SESSION_ARCHIVES_SQL = `
CREATE TABLE session_import_access (
  session_id TEXT PRIMARY KEY NOT NULL,
  imported_through_seq INTEGER NOT NULL,
  bound INTEGER NOT NULL,
  owner_user_id TEXT,
  data TEXT NOT NULL
);
CREATE TABLE session_archive_imports (
  id TEXT PRIMARY KEY NOT NULL,
  archive_sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX session_archive_imports_order ON session_archive_imports(created_at DESC,id DESC);
`;
