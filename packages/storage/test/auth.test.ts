import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openProfileStore,
  type LocalClient,
  type ProfileStore,
  type VerifiedIdentity,
} from '../src/index.js';
import { FOUNDATION_SQL } from '../src/migrations/0001-foundation.js';

interface Fixture {
  directory: string;
  store: ProfileStore;
}
const fixtures: Fixture[] = [];
const directories: string[] = [];
const identity: VerifiedIdentity = {
  providerId: 'github',
  issuer: 'https://github.com',
  subject: '12345',
  name: 'Fixture user',
  avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
};

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function client(id = 'desktop'): LocalClient {
  return {
    id,
    tokenHash: hash(`local-secret-${id}`),
    csrfToken: `csrf-${id}`,
    createdAt: 1,
    expiresAt: 1000,
  };
}

function login(id = 'login') {
  return { id, tokenHash: hash(`login-secret-${id}`), createdAt: 2, expiresAt: 100 };
}

async function fixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-auth-'));
  directories.push(directory);
  const value = { directory, store: await openProfileStore(directory) };
  fixtures.push(value);
  return value;
}

async function reopen(value: Fixture): Promise<void> {
  value.store.close();
  value.store = await openProfileStore(value.directory);
}

function inspect<T>(value: Fixture, operation: (db: Database.Database) => T): T {
  const db = new Database(join(value.directory, 'data.sqlite'));
  db.pragma('foreign_keys = ON');
  try {
    return operation(db);
  } finally {
    db.close();
  }
}

afterEach(async () => {
  for (const value of fixtures.splice(0)) value.store.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('durable application identity and local trust', () => {
  it('retains separate trust and login facts across projection recovery without storing raw tokens', async () => {
    const value = await fixture();
    const local = client();
    value.store.auth.createLocalClient(local);
    expect(value.store.auth.profileOwner()).toBeUndefined();
    expect(value.store.auth.findLocalClient(local.tokenHash, 2)).toEqual(local);
    expect(
      value.store.auth.findLoginSession(hash('login-secret-login'), local.id, 2),
    ).toBeUndefined();
    const accepted = value.store.auth.completeLogin(identity, local.id, login());
    expect(accepted.user).toMatchObject({ name: identity.name, avatarUrl: identity.avatarUrl });
    expect(accepted.user.id).toMatch(/^user_/);
    expect(accepted).not.toHaveProperty('tokenHash');
    expect(accepted).not.toHaveProperty('issuer');
    const durable = inspect(value, (db) =>
      JSON.stringify([
        db.prepare('SELECT * FROM auth_local_clients').all(),
        db.prepare('SELECT * FROM auth_login_sessions').all(),
        db.prepare('SELECT * FROM auth_users').all(),
      ]),
    );
    expect(durable).not.toContain('local-secret-desktop');
    expect(durable).not.toContain('login-secret-login');
    await reopen(value);
    expect(value.store.auth.profileOwner()).toEqual(accepted.user);
    expect(value.store.auth.findLocalClient(local.tokenHash, 3)).toEqual(local);
    expect(value.store.auth.findLoginSession(login().tokenHash, local.id, 3)).toEqual(accepted);
  });

  it('preserves the stable internal user when the same external subject changes its display name', async () => {
    const { store } = await fixture();
    store.auth.createLocalClient(client());
    const first = store.auth.completeLogin(identity, 'desktop', login('first'));
    const updated = store.auth.completeLogin(
      { ...identity, name: 'Renamed user', avatarUrl: null },
      'desktop',
      login('second'),
    );
    expect(updated.user).toEqual({ id: first.user.id, name: 'Renamed user', avatarUrl: null });
    expect(store.auth.findLoginSession(login('first').tokenHash, 'desktop', 3)?.user).toEqual(
      updated.user,
    );
  });

  it.each([
    { subject: '54321' },
    { providerId: 'other-provider' },
    { issuer: 'https://other.example' },
  ])(
    'refuses a changed external identity %j without changing the owner or existing login',
    async (change) => {
      const value = await fixture();
      value.store.auth.createLocalClient(client());
      const first = value.store.auth.completeLogin(identity, 'desktop', login('first'));
      expect(() =>
        value.store.auth.completeLogin({ ...identity, ...change }, 'desktop', login('other')),
      ).toThrow(expect.objectContaining({ code: 'PROFILE_ACCOUNT_MISMATCH' }));
      expect(value.store.auth.profileOwner()).toEqual(first.user);
      expect(value.store.auth.findLoginSession(login('first').tokenHash, 'desktop', 3)).toEqual(
        first,
      );
      expect(
        value.store.auth.findLoginSession(login('other').tokenHash, 'desktop', 3),
      ).toBeUndefined();
      expect(
        inspect(value, (db) => db.prepare('SELECT count(*) AS n FROM auth_users').get()),
      ).toEqual({
        n: 1,
      });
    },
  );

  it('rolls back initial ownership and identity if session insertion fails', async () => {
    const value = await fixture();
    value.store.auth.createLocalClient(client());
    expect(() =>
      value.store.auth.completeLogin(identity, 'desktop', { ...login(), tokenHash: 'raw-token' }),
    ).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(value.store.auth.profileOwner()).toBeUndefined();
    expect(
      inspect(value, (db) =>
        db.prepare('SELECT count(*) AS n FROM auth_external_identities').get(),
      ),
    ).toEqual({ n: 0 });
    const accepted = value.store.auth.completeLogin(identity, 'desktop', login());
    expect(value.store.auth.profileOwner()).toEqual(accepted.user);
  });

  it('rejects an unknown or expired local client before binding an account', async () => {
    const { store } = await fixture();
    expect(() => store.auth.completeLogin(identity, 'unknown', login())).toThrow(
      expect.objectContaining({ code: 'LOCAL_CLIENT_EXPIRED' }),
    );
    store.auth.createLocalClient({ ...client(), expiresAt: 2 });
    expect(() => store.auth.completeLogin(identity, 'desktop', login())).toThrow(
      expect.objectContaining({ code: 'LOCAL_CLIENT_EXPIRED' }),
    );
    expect(store.auth.profileOwner()).toBeUndefined();
  });

  it('binds a login bearer to its original client and independently checks both expiries', async () => {
    const { store } = await fixture();
    store.auth.createLocalClient({ ...client(), expiresAt: 50 });
    store.auth.createLocalClient(client('browser'));
    store.auth.completeLogin(identity, 'desktop', login());
    store.auth.completeLogin(identity, 'browser', login('browser'));
    expect(store.auth.findLoginSession(login().tokenHash, 'browser', 3)).toBeUndefined();
    expect(store.auth.findLoginSession(login().tokenHash, 'desktop', 49)).toBeDefined();
    expect(store.auth.findLoginSession(login().tokenHash, 'desktop', 50)).toBeUndefined();
    expect(store.auth.findLoginSession(login('browser').tokenHash, 'browser', 99)).toBeDefined();
    expect(store.auth.findLoginSession(login('browser').tokenHash, 'browser', 100)).toBeUndefined();
    expect(store.auth.findLocalClient(client('browser').tokenHash, 100)).toBeDefined();
    expect(store.auth.findLocalClient(client('browser').tokenHash, 1000)).toBeUndefined();
  });

  it('revokes all logins for only one client while preserving local trust and another client', async () => {
    const value = await fixture();
    value.store.auth.createLocalClient(client());
    value.store.auth.createLocalClient(client('browser'));
    const first = value.store.auth.completeLogin(identity, 'desktop', login('first'));
    value.store.auth.completeLogin(identity, 'desktop', login('second'));
    const browser = value.store.auth.completeLogin(identity, 'browser', login('browser'));
    value.store.auth.revokeClientSessions('desktop');
    value.store.auth.revokeClientSessions('desktop');
    await reopen(value);
    expect(
      value.store.auth.findLoginSession(login('first').tokenHash, 'desktop', 3),
    ).toBeUndefined();
    expect(
      value.store.auth.findLoginSession(login('second').tokenHash, 'desktop', 3),
    ).toBeUndefined();
    expect(value.store.auth.findLoginSession(login('browser').tokenHash, 'browser', 3)).toEqual(
      browser,
    );
    expect(value.store.auth.findLocalClient(client().tokenHash, 3)).toEqual(client());
    expect(value.store.auth.profileOwner()).toEqual(first.user);
  });

  it('rejects malformed persisted user data instead of returning a partial or mock identity', async () => {
    const value = await fixture();
    value.store.auth.createLocalClient(client());
    value.store.auth.completeLogin(identity, 'desktop', login());
    inspect(value, (db) => db.prepare('UPDATE auth_users SET data = ?').run('{"id":13}'));
    expect(() => value.store.auth.profileOwner()).toThrow(
      expect.objectContaining({ code: 'INVALID_RECORD' }),
    );
    expect(() => value.store.auth.findLoginSession(login().tokenHash, 'desktop', 3)).toThrow(
      expect.objectContaining({ code: 'INVALID_RECORD' }),
    );
  });

  it('bounds expired-row cleanup while reads reject expired records immediately', async () => {
    const value = await fixture();
    value.store.auth.createLocalClient(client());
    const session = value.store.auth.completeLogin(identity, 'desktop', login());
    inspect(value, (db) => {
      db.transaction(() => {
        const addClient = db.prepare(`INSERT INTO auth_local_clients
          (id, token_hash, csrf_token, created_at, expires_at) VALUES (?, ?, 'csrf', 0, 1)`);
        const addLogin = db.prepare(`INSERT INTO auth_login_sessions
          (id, token_hash, client_id, user_id, provider_id, issuer, subject, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)`);
        for (let index = 0; index < 150; index += 1) {
          const id = `expired-${index}`;
          addClient.run(id, hash(`local-${id}`));
          addLogin.run(
            id,
            hash(`login-${id}`),
            id,
            session.user.id,
            identity.providerId,
            identity.issuer,
            identity.subject,
          );
        }
      })();
    });
    expect(value.store.auth.findLocalClient(hash('local-expired-149'), 3)).toBeUndefined();
    value.store.auth.createLocalClient({ ...client('new'), createdAt: 3 });
    expect(
      inspect(value, (db) =>
        db.prepare('SELECT count(*) AS n FROM auth_login_sessions WHERE expires_at = 1').get(),
      ),
    ).toEqual({ n: 50 });
    expect(
      inspect(value, (db) =>
        db.prepare('SELECT count(*) AS n FROM auth_local_clients WHERE expires_at = 1').get(),
      ),
    ).toEqual({ n: 50 });
  });

  it('rejects calls after profile close with the storage lifecycle error', async () => {
    const value = await fixture();
    value.store.close();
    expect(() => value.store.auth.profileOwner()).toThrow(
      expect.objectContaining({ code: 'STORAGE_CLOSED' }),
    );
  });
});

describe('application login schema migration', () => {
  it('adds authentication facts to an existing foundation without rebuilding its configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-auth-migration-'));
    directories.push(directory);
    const db = new Database(join(directory, 'data.sqlite'));
    try {
      db.exec(FOUNDATION_SQL);
      db.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL,
        checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)`);
      db.prepare('INSERT INTO schema_migrations VALUES (1, ?, 1)').run(hash(FOUNDATION_SQL));
      db.pragma('user_version = 1');
      db.prepare('UPDATE app_settings SET revision = 2, data = ? WHERE id = 1').run(
        JSON.stringify({ revision: 2, defaultModel: null }),
      );
    } finally {
      db.close();
    }
    const value = { directory, store: await openProfileStore(directory) };
    fixtures.push(value);
    expect(value.store.getSettings()).toEqual({ revision: 2, defaultModel: null });
    value.store.auth.createLocalClient(client());
    expect(value.store.auth.completeLogin(identity, 'desktop', login()).user.name).toBe(
      identity.name,
    );
    expect(
      inspect(value, (connection) => connection.pragma('user_version', { simple: true })),
    ).toBe(2);
    await reopen(value);
    expect(value.store.auth.profileOwner()?.name).toBe(identity.name);
  });
});
