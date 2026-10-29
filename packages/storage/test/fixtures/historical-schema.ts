import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { FOUNDATION_SQL } from '../../src/sqlite/migrations/0001-foundation.js';
import { APPLICATION_LOGIN_SQL } from '../../src/sqlite/migrations/0002-application-login.js';
import { MCP_SQL } from '../../src/sqlite/migrations/0003-mcp.js';
import { EXTENSIONS_SQL } from '../../src/sqlite/migrations/0004-extensions.js';
import { REMOTE_MCP_SQL } from '../../src/sqlite/migrations/0005-remote-mcp.js';
import { CONNECTIONS_SQL } from '../../src/sqlite/migrations/0006-connections.js';
import { PLUGIN_ACCOUNTS_SQL } from '../../src/sqlite/migrations/0007-plugin-accounts.js';
import { MCP_CATALOGS_SQL } from '../../src/sqlite/migrations/0008-mcp-catalogs.js';

type HistoricalSchemaVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const historicalSql = [
  FOUNDATION_SQL,
  APPLICATION_LOGIN_SQL,
  MCP_SQL,
  EXTENSIONS_SQL,
  REMOTE_MCP_SQL,
  CONNECTIONS_SQL,
  PLUGIN_ACCOUNTS_SQL,
  MCP_CATALOGS_SQL,
];

/** Build an actual predecessor instead of partially deleting a newer schema. */
export function installHistoricalSchema(
  database: Database.Database,
  version: HistoricalSchemaVersion,
): void {
  database.exec(
    'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)',
  );
  for (const [index, statement] of historicalSql.slice(0, version).entries()) {
    database.exec(statement);
    database
      .prepare('INSERT INTO schema_migrations VALUES (?, ?, 1)')
      .run(index + 1, createHash('sha256').update(statement).digest('hex'));
  }
  database.pragma(`user_version = ${version}`);
}
