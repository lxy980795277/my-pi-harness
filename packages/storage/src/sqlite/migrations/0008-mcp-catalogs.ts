/** Rebuildable MCP catalogs are bound to the exact host authorization snapshot. */
export const MCP_CATALOGS_SQL = `
CREATE TABLE mcp_catalog_snapshots (
  server_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  authority TEXT NOT NULL,
  discovered_at INTEGER NOT NULL CHECK(discovered_at >= 0),
  data TEXT NOT NULL CHECK(json_valid(data)),
  PRIMARY KEY(server_id, scope)
);
`;
