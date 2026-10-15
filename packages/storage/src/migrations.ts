import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { StorageError } from './errors.js';
import { FOUNDATION_SQL } from './migrations/0001-foundation.js';
import { MODEL_SETTINGS_SQL } from './migrations/0002-model-settings.js';
import { WORKSPACES_SQL } from './migrations/0003-workspaces.js';
import { WORKSPACE_ICONS_SQL } from './migrations/0004-workspace-icons.js';

const migrations = [
  { version: 1, sql: FOUNDATION_SQL },
  { version: 2, sql: MODEL_SETTINGS_SQL },
  { version: 3, sql: WORKSPACES_SQL },
  { version: 4, sql: WORKSPACE_ICONS_SQL },
];
const MigrationRowSchema = Type.Object({ version: Type.Integer(), checksum: Type.String() });

/** Highest installed schema version understood by this build. */
export const SCHEMA_VERSION = 4;

/**
 * Apply ordered migrations atomically and reject newer or edited committed generations.
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
