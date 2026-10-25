/** Remote configuration and tool authorizations are independent of session projections. */
export const REMOTE_MCP_SQL = `
CREATE TABLE remote_mcp_servers (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE mcp_tool_controls (server_id TEXT NOT NULL, tool_name TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(server_id,tool_name));
CREATE TABLE mcp_readonly_grants (id TEXT PRIMARY KEY NOT NULL, server_id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
`;
