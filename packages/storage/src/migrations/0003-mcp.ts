/** MCP settings and owner authorization are authoritative configuration, not session projections. */
export const MCP_SQL = `
ALTER TABLE queued_inputs ADD COLUMN private_data TEXT;
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE TABLE mcp_startup_grants (
  server_id TEXT NOT NULL REFERENCES mcp_servers(id),
  scope TEXT NOT NULL CHECK (scope IN ('sandboxed', 'full-access')),
  data TEXT NOT NULL CHECK (json_valid(data)),
  PRIMARY KEY (server_id, scope)
);
CREATE TABLE mcp_identity_control (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  data TEXT NOT NULL CHECK (json_valid(data))
);
`;
