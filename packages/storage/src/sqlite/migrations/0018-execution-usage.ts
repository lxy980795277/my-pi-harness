/** Disposable timing/source projections; execution and pricing facts remain in JSONL. */
export const EXECUTION_USAGE_SQL = `
CREATE INDEX events_message_identity ON events(session_id, json_extract(data, '$.id'), seq) WHERE type='message.started';
CREATE INDEX trace_request_answer ON trace_entries(session_id, json_extract(request, '$.answerInputMessageId'), version_seq) WHERE request IS NOT NULL;
CREATE INDEX trace_request_input ON trace_entries(session_id, json_extract(request, '$.inputMessageId'), version_seq) WHERE request IS NOT NULL;
CREATE INDEX trace_request_run_order ON trace_entries(session_id, run_id, order_seq DESC, version_seq DESC) WHERE request IS NOT NULL;
CREATE TABLE trace_tool_timings (
  tool_call_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  task_id TEXT,
  branch_id TEXT NOT NULL,
  source_request_id TEXT,
  answer_input_message_id TEXT,
  input_message_id TEXT,
  service TEXT,
  data TEXT NOT NULL
);
CREATE INDEX trace_tool_scope ON trace_tool_timings(session_id, task_id, run_id);
CREATE INDEX trace_tool_answer ON trace_tool_timings(session_id, answer_input_message_id);
CREATE TABLE trace_human_waits (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  run_id TEXT,
  task_id TEXT,
  branch_id TEXT NOT NULL,
  answer_input_message_id TEXT,
  input_message_id TEXT,
  started_at INTEGER NOT NULL,
  duration_ms INTEGER,
  data TEXT NOT NULL
);
CREATE INDEX trace_wait_scope ON trace_human_waits(session_id, task_id, run_id);
CREATE INDEX trace_wait_answer ON trace_human_waits(session_id, answer_input_message_id);
`;
