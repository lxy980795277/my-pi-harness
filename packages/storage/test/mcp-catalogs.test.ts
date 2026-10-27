import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { applyMigrations, SCHEMA_VERSION } from '../src/sqlite/migrations/apply.js';
import { McpDirectoryRepository } from '../src/repositories/mcp-directory.js';

it('adds rebuildable catalog storage to schema seven while preserving existing configuration', () => {
  const database = new Database(':memory:');
  try {
    applyMigrations(database);
    database.exec('DROP TABLE mcp_catalog_snapshots');
    database.prepare('DELETE FROM schema_migrations WHERE version=8').run();
    database.pragma('user_version=7');
    const original = database.prepare('SELECT data FROM app_settings WHERE id=1').get();
    applyMigrations(database);
    expect(database.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(database.prepare('SELECT data FROM app_settings WHERE id=1').get()).toEqual(original);
    const directory = new McpDirectoryRepository(database, () => undefined);
    const snapshot = {
      authority: 'a'.repeat(64),
      discoveredAt: 123,
      data: '{"tools":[],"resources":[],"prompts":[]}',
    };
    directory.saveCatalog('server', 'remote', snapshot);
    directory.saveCatalog('server', 'sandboxed', { ...snapshot, authority: 'b'.repeat(64) });
    expect(directory.catalog('server', 'remote')).toEqual(snapshot);
    directory.removeCatalog('server', 'remote');
    expect(directory.catalog('server', 'remote')).toBeUndefined();
    expect(directory.catalog('server', 'sandboxed')).toBeDefined();
    directory.remove('server');
    expect(directory.catalog('server', 'sandboxed')).toBeUndefined();
  } finally {
    database.close();
  }
});

it('rejects invalid snapshot authority and JSON without publishing a row', () => {
  const database = new Database(':memory:');
  try {
    applyMigrations(database);
    const directory = new McpDirectoryRepository(database, () => undefined);
    expect(() =>
      directory.saveCatalog('server', 'remote', {
        authority: 'invalid',
        discoveredAt: 1,
        data: '{}',
      }),
    ).toThrow();
    expect(() =>
      directory.saveCatalog('server', 'remote', {
        authority: 'a'.repeat(64),
        discoveredAt: 1,
        data: 'invalid-json',
      }),
    ).toThrow();
    expect(directory.catalog('server', 'remote')).toBeUndefined();
  } finally {
    database.close();
  }
});
