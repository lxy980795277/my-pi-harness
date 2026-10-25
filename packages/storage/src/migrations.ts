import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { StorageError } from './errors.js';
import { FOUNDATION_SQL } from './migrations/0001-foundation.js';
import { APPLICATION_LOGIN_SQL } from './migrations/0002-application-login.js';
import { MCP_SQL } from './migrations/0003-mcp.js';
import { EXTENSIONS_SQL } from './migrations/0004-extensions.js';
import { REMOTE_MCP_SQL } from './migrations/0005-remote-mcp.js';
import { CONNECTIONS_SQL } from './migrations/0006-connections.js';
const MigrationRowSchema = Type.Object({ version: Type.Integer(), checksum: Type.String() });

/** Highest installed schema version understood by this build. */
export const SCHEMA_VERSION = 6;
const migrations = [
  { version: 1, sql: FOUNDATION_SQL },
  { version: 2, sql: APPLICATION_LOGIN_SQL },
  { version: 3, sql: MCP_SQL },
  { version: 4, sql: EXTENSIONS_SQL },
  { version: 5, sql: REMOTE_MCP_SQL },
  { version: 6, sql: CONNECTIONS_SQL },
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
