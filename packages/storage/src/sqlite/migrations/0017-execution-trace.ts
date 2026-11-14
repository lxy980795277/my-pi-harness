/** Rebuildable summaries and input anchors; large request bodies remain in the journal. */
export const EXECUTION_TRACE_SQL = `
CREATE TABLE trace_entries (
  id TEXT NOT NULL,
  version_seq INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  order_seq INTEGER NOT NULL,
  branch_id TEXT NOT NULL,
  run_id TEXT,
  task_id TEXT,
  kind TEXT NOT NULL,
  purpose TEXT,
  status TEXT NOT NULL,
  entry TEXT NOT NULL,
  request TEXT,
  PRIMARY KEY(session_id, id, version_seq)
);
CREATE INDEX trace_entries_page ON trace_entries(session_id, order_seq, version_seq);
CREATE INDEX trace_entries_run ON trace_entries(session_id, run_id, version_seq);
CREATE INDEX trace_entries_task ON trace_entries(session_id, task_id, version_seq);
CREATE TABLE request_snapshots (
  model_request_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL
);
`;
