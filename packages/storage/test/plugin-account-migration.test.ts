import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { applyMigrations, SCHEMA_VERSION } from '../src/sqlite/migrations/apply.js';

it('retires the plugin account marker without removing independent accounts, credential references or saved fields', () => {
  const db = new Database(':memory:');
  try {
    applyMigrations(db);
    db.prepare('DELETE FROM schema_migrations WHERE version >= 7').run();
    db.exec('DROP TABLE mcp_catalog_snapshots');
    db.pragma('user_version = 6');
    db.prepare('INSERT INTO auth_users (id,data) VALUES (?,?)').run(
      'owner',
      JSON.stringify({ id: 'owner', name: 'Fixture' }),
    );
    const prior = {
      id: 'prior',
      credentialRef: 'private-ref',
      accessEpoch: 4,
      managedPluginId: 'github',
    };
    const manual = { id: 'manual', credentialRef: 'manual-ref', accessEpoch: 2 };
    const insert = db.prepare('INSERT INTO external_connections (id,owner_id,data) VALUES (?,?,?)');
    insert.run('prior', 'owner', JSON.stringify(prior));
    insert.run('manual', 'owner', JSON.stringify(manual));
    applyMigrations(db);
    const rows = db.prepare('SELECT data FROM external_connections ORDER BY id').all();
    expect(rows).toEqual([
      { data: JSON.stringify(manual) },
      {
        data: JSON.stringify({
          id: prior.id,
          credentialRef: prior.credentialRef,
          accessEpoch: prior.accessEpoch,
        }),
      },
    ]);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    applyMigrations(db);
    expect(db.prepare('SELECT data FROM external_connections ORDER BY id').all()).toEqual(rows);
  } finally {
    db.close();
  }
});
