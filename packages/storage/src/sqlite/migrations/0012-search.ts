/** Search is rebuildable from confirmed memory and persistent message text, never private codecs. */
export const SEARCH_SQL = `
CREATE TABLE search_generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signature TEXT NOT NULL,
  watermark TEXT
);
INSERT INTO search_generations(id,signature,watermark) VALUES (1,'unprepared',NULL);
CREATE TABLE search_index_state (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  active_generation INTEGER NOT NULL REFERENCES search_generations(id),
  building_generation INTEGER REFERENCES search_generations(id),
  lexical_ready INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
INSERT INTO search_index_state(id,active_generation) VALUES (1,1);
CREATE TABLE search_sources (
  generation INTEGER NOT NULL REFERENCES search_generations(id),
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  revision INTEGER NOT NULL,
  signature TEXT NOT NULL,
  PRIMARY KEY(generation,id)
);
CREATE TABLE search_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation INTEGER NOT NULL,
  source_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  text TEXT NOT NULL,
  UNIQUE(generation,source_id,ordinal),
  FOREIGN KEY(generation,source_id) REFERENCES search_sources(generation,id)
);
CREATE INDEX search_chunks_source ON search_chunks(generation,source_id);
CREATE VIRTUAL TABLE search_fts USING fts5(tokens,tokenize='unicode61');
CREATE TABLE search_vectors (
  chunk_id INTEGER NOT NULL REFERENCES search_chunks(id),
  model_signature TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector BLOB NOT NULL,
  PRIMARY KEY(chunk_id,model_signature)
);
CREATE VIEW search_memberships AS
SELECT 'message:' || bm.message_id AS source_id,bm.branch_id,NULL AS task_id,bm.ordinal
FROM branch_messages bm JOIN messages m ON m.id=bm.message_id
JOIN branches b ON b.id=bm.branch_id AND b.session_id=m.session_id
UNION ALL
SELECT 'message:' || tm.message_id, anchor.branch_id, t.id, tm.ordinal
FROM task_messages tm JOIN agent_tasks t ON t.id=tm.task_id
JOIN messages m ON m.id=tm.message_id AND m.session_id=t.session_id
JOIN branch_messages anchor ON anchor.message_id=t.anchor_message_id
JOIN branches b ON b.id=anchor.branch_id AND b.session_id=t.session_id;
CREATE VIEW search_facts AS
SELECT 'memory:' || me.id AS source_id,'memory' AS kind,
 me.revision,json_extract(me.data,'$.body') AS text,
 CASE WHEN json_extract(me.data,'$.scope.kind')='workspace' THEN json_extract(me.data,'$.scope.workspaceId') ELSE NULL END AS workspace_id,
 NULL AS session_id,NULL AS message_id,me.id AS memory_id,
 'memory' AS origin,'complete' AS status,json_extract(me.data,'$.createdAt') AS created_at,
 substr(json_extract(me.data,'$.body'),1,100) AS title,
 CASE WHEN w.archived=1 THEN 1 ELSE 0 END AS archived,NULL AS active_branch_id,
 me.owner_user_id AS owner_user_id
FROM memory_entries me LEFT JOIN workspaces w ON w.id=json_extract(me.data,'$.scope.workspaceId')
WHERE json_extract(me.data,'$.enabled')=1
UNION ALL
SELECT 'message:' || m.id,'message',1,json_extract(m.data,'$.text'),
 s.workspace_id,m.session_id,m.id,NULL,
 CASE WHEN json_extract(m.data,'$.agentMessageId') IS NOT NULL THEN 'communication'
 WHEN EXISTS(SELECT 1 FROM task_messages tm WHERE tm.message_id=m.id) THEN 'task'
 ELSE json_extract(m.data,'$.role') END,
 json_extract(m.data,'$.status'),json_extract(m.data,'$.createdAt'),json_extract(s.data,'$.title'),
 s.archived,json_extract(s.data,'$.activeBranchId'),o.user_id
FROM messages m JOIN sessions s ON s.id=m.session_id JOIN auth_profile_owner o ON o.id=1
WHERE json_extract(m.data,'$.status')<>'streaming' AND length(json_extract(m.data,'$.text'))>0
AND EXISTS(SELECT 1 FROM search_memberships membership WHERE membership.source_id='message:' || m.id);
`;
