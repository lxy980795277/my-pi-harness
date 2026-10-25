/** Provider connections persist configuration and opaque credential references, never tokens. */
export const CONNECTIONS_SQL = `
CREATE TABLE external_connections (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES auth_users(id),
  data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE INDEX external_connections_owner ON external_connections(owner_id);
`;
