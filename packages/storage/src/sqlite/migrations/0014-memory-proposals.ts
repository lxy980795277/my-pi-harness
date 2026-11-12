/** Independent proposal state survives session projection rebuilds; terminal data has no draft. */
export const MEMORY_PROPOSALS_SQL = `
CREATE INDEX memory_suppressions_source ON memory_suppressions(owner_user_id,source_fingerprint);
CREATE TABLE memory_entry_sources (
  owner_user_id TEXT NOT NULL REFERENCES auth_users(id),
  memory_id TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  PRIMARY KEY(owner_user_id,memory_id,source_fingerprint)
);
CREATE INDEX memory_entry_sources_fingerprint ON memory_entry_sources(owner_user_id,source_fingerprint,memory_id);
CREATE TABLE memory_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES auth_users(id),
  source_session_id TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  source_context TEXT,
  candidate_fingerprint TEXT NOT NULL,
  target_memory_id TEXT,
  tool_call_id TEXT NOT NULL,
  learning_action_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','stale')),
  data TEXT NOT NULL CHECK(json_valid(data)),
  UNIQUE(owner_user_id,tool_call_id),
  UNIQUE(owner_user_id,source_session_id,learning_action_id),
  CHECK(json_extract(data,'$.status')=status),
  CHECK(status='pending' OR (json_type(data,'$.draft') IS NULL AND json_type(data,'$.source') IS NULL))
);
CREATE INDEX memory_proposals_owner_pending ON memory_proposals(owner_user_id,status,id);
CREATE INDEX memory_proposals_session_pending ON memory_proposals(source_session_id,status);
CREATE TABLE memory_proposal_receipts (
  owner_user_id TEXT NOT NULL REFERENCES auth_users(id),
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('confirm','reject')),
  data TEXT NOT NULL CHECK(json_valid(data)),
  PRIMARY KEY(owner_user_id,request_id)
);
`;
