import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { StorageError } from '../../shared/errors';
import { FOUNDATION_SQL } from './0001-foundation';
import { APPLICATION_LOGIN_SQL } from './0002-application-login';
import { MCP_SQL } from './0003-mcp';
import { EXTENSIONS_SQL } from './0004-extensions';
import { REMOTE_MCP_SQL } from './0005-remote-mcp';
import { CONNECTIONS_SQL } from './0006-connections';
import { PLUGIN_ACCOUNTS_SQL } from './0007-plugin-accounts';
import { MCP_CATALOGS_SQL } from './0008-mcp-catalogs';
import { AGENT_TASKS_SQL } from './0009-agent-tasks';
import { ARTIFACTS_SQL } from './0010-artifacts';
import { MEMORY_SQL } from './0011-memory';
import { SEARCH_SQL } from './0012-search';
import { MEMORY_RELEVANCE_SQL } from './0013-memory-relevance';
import { MEMORY_PROPOSALS_SQL } from './0014-memory-proposals';
import { SEARCH_CURSOR_SQL } from './0015-search-cursor';
import { DIRECT_MEMORY_WRITES_SQL } from './0016-direct-memory-writes';
const MigrationRowSchema = Type.Object({ version: Type.Integer(), checksum: Type.String() });

/** Highest installed schema version understood by this build. */
export const SCHEMA_VERSION = 16;
const migrations = [
  { version: 1, sql: FOUNDATION_SQL },
  { version: 2, sql: APPLICATION_LOGIN_SQL },
  { version: 3, sql: MCP_SQL },
  { version: 4, sql: EXTENSIONS_SQL },
  { version: 5, sql: REMOTE_MCP_SQL },
  { version: 6, sql: CONNECTIONS_SQL },
  { version: 7, sql: PLUGIN_ACCOUNTS_SQL },
  { version: 8, sql: MCP_CATALOGS_SQL },
  { version: 9, sql: AGENT_TASKS_SQL },
  { version: 10, sql: ARTIFACTS_SQL },
  { version: 11, sql: MEMORY_SQL },
  { version: 12, sql: SEARCH_SQL },
  { version: 13, sql: MEMORY_RELEVANCE_SQL },
  { version: 14, sql: MEMORY_PROPOSALS_SQL },
  { version: 15, sql: SEARCH_CURSOR_SQL },
  { version: 16, sql: DIRECT_MEMORY_WRITES_SQL },
];

/**
 * Install the fresh development schema and reject incompatible existing profiles.
 * @param database The business database opened after profile ownership was acquired.
 */
export function applyMigrations(database: Database.Database): void {
  const integrity = database.pragma('quick_check', { simple: true });
  if (integrity !== 'ok')
    throw new StorageError('DATABASE_INVALID', 'SQLite integrity check failed');
  const current: unknown = database.pragma('user_version', { simple: true });
  if (typeof current !== 'number' || current < 0 || current > SCHEMA_VERSION) {
    throw new StorageError('MIGRATION_VERSION', 'This database uses an unsupported schema version');
  }
  database
    .transaction(() => {
      database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )`);
      const applied: unknown[] = database
        .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
        .all();
      if (applied.length !== current) {
        throw new StorageError(
          'MIGRATION_CHANGED',
          'Applied migration records do not match the schema version',
        );
      }
      for (const migration of migrations) {
        const checksum = createHash('sha256').update(migration.sql).digest('hex');
        if (migration.version <= current) {
          const row = applied[migration.version - 1];
          if (
            !Value.Check(MigrationRowSchema, row) ||
            row.version !== migration.version ||
            row.checksum !== checksum
          ) {
            throw new StorageError(
              'MIGRATION_CHANGED',
              'An applied migration no longer matches this build',
            );
          }
          continue;
        }
        database.exec(migration.sql);
        database
          .prepare('INSERT INTO schema_migrations(version, checksum, applied_at) VALUES (?, ?, ?)')
          .run(migration.version, checksum, Date.now());
        database.pragma(`user_version = ${migration.version}`);
      }
    })
    .immediate();
}
