/** Authentication facts are independent of rebuildable session projections. */
export const APPLICATION_LOGIN_SQL = `
CREATE TABLE auth_users (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE TABLE auth_external_identities (
  provider_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_users(id),
  PRIMARY KEY (provider_id, issuer, subject)
);
CREATE TABLE auth_profile_owner (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  user_id TEXT NOT NULL UNIQUE REFERENCES auth_users(id)
);
CREATE TABLE auth_local_clients (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  csrf_token TEXT NOT NULL CHECK (length(csrf_token) > 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX auth_local_clients_expiry ON auth_local_clients(expires_at);
CREATE TABLE auth_login_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  client_id TEXT NOT NULL REFERENCES auth_local_clients(id),
  user_id TEXT NOT NULL REFERENCES auth_users(id),
  provider_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  FOREIGN KEY (provider_id, issuer, subject)
    REFERENCES auth_external_identities(provider_id, issuer, subject)
);
CREATE INDEX auth_login_sessions_client ON auth_login_sessions(client_id);
CREATE INDEX auth_login_sessions_expiry ON auth_login_sessions(expires_at);
`;
