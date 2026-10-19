import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { type Static, Type } from 'typebox';
import { AppUserSchema, type AppUser } from '@my-pi-harness/protocol';
import { StorageError } from './errors.js';
import { checked } from './validation.js';
import type {
  LocalClient,
  LoginSessionInput,
  StoredLoginSession,
  VerifiedIdentity,
} from './auth-types.js';

const IdSchema = Type.String({ minLength: 1, maxLength: 100 });
const TimestampSchema = Type.Integer({ minimum: 0, maximum: 8_640_000_000_000_000 });
const TokenHashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' });
const LocalClientSchema = Type.Object(
  {
    id: IdSchema,
    tokenHash: TokenHashSchema,
    csrfToken: Type.String({ minLength: 1 }),
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema,
  },
  { additionalProperties: false },
);
const OwnerRowSchema = Type.Object({ userId: IdSchema, data: Type.String() });
const IdentityRowSchema = Type.Object({ userId: IdSchema });
const SessionRowSchema = Type.Object(
  {
    id: IdSchema,
    tokenHash: TokenHashSchema,
    clientId: IdSchema,
    userId: IdSchema,
    providerId: Type.String({ minLength: 1, maxLength: 80 }),
    issuer: Type.String({ minLength: 1, maxLength: 2048 }),
    subject: Type.String({ minLength: 1, maxLength: 200 }),
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema,
  },
  { additionalProperties: false },
);
type SessionRow = Static<typeof SessionRowSchema>;

const LOCAL_CLIENT_COLUMNS = `id, token_hash AS tokenHash, csrf_token AS csrfToken,
  created_at AS createdAt, expires_at AS expiresAt`;
const SESSION_COLUMNS = `id, token_hash AS tokenHash, client_id AS clientId, user_id AS userId,
  provider_id AS providerId, issuer, subject, created_at AS createdAt, expires_at AS expiresAt`;
const EXPIRY_CLEANUP_LIMIT = 100;

/** Authentication facts survive session projection rebuilds and never retain upstream tokens. */
export class AuthRepository {
  public constructor(
    private readonly sqlite: Database.Database,
    private readonly assertOpen: () => void,
  ) {}

  private transaction<T>(operation: () => T): T {
    this.assertOpen();
    try {
      return this.sqlite.transaction(operation).immediate();
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        error.code.startsWith('SQLITE_CONSTRAINT')
      ) {
        throw new StorageError('CONFLICT', 'An authentication record conflicts with stored facts', {
          cause: error,
        });
      }
      throw error;
    }
  }

  private cleanupExpired(now: number): void {
    this.sqlite
      .prepare(
        `DELETE FROM auth_login_sessions WHERE id IN (
        SELECT id FROM auth_login_sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT ?
      )`,
      )
      .run(now, EXPIRY_CLEANUP_LIMIT);
    this.sqlite
      .prepare(
        `DELETE FROM auth_local_clients WHERE id IN (
        SELECT c.id FROM auth_local_clients c WHERE c.expires_at <= ?
          AND NOT EXISTS (SELECT 1 FROM auth_login_sessions s WHERE s.client_id = c.id)
        ORDER BY c.expires_at LIMIT ?
      )`,
      )
      .run(now, EXPIRY_CLEANUP_LIMIT);
  }

  private client(row: unknown, now: number): LocalClient | undefined {
    if (row === undefined) return undefined;
    const value = checked(LocalClientSchema, row);
    if (value.expiresAt <= value.createdAt)
      throw new StorageError('INVALID_RECORD', 'Local client expiry is inconsistent');
    if (value.expiresAt <= now) return undefined;
    return value;
  }

  /** Persist a hashed local trust credential; cleanup work is bounded per write. */
  public createLocalClient(input: LocalClient): LocalClient {
    return this.transaction(() => {
      this.cleanupExpired(input.createdAt);
      this.sqlite
        .prepare(
          `INSERT INTO auth_local_clients
          (id, token_hash, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(input.id, input.tokenHash, input.csrfToken, input.createdAt, input.expiresAt);
      const value = this.findLocalClientById(input.id, input.createdAt);
      if (!value) throw new StorageError('INVALID_RECORD', 'New local client is already expired');
      return value;
    });
  }

  /** Read trust by a bearer digest; expiry is checked without mutating records. */
  public findLocalClient(tokenHash: string, now: number): LocalClient | undefined {
    this.assertOpen();
    return this.client(
      this.sqlite
        .prepare(`SELECT ${LOCAL_CLIENT_COLUMNS} FROM auth_local_clients WHERE token_hash = ?`)
        .get(tokenHash),
      now,
    );
  }

  /** Resolve the owner of an in-flight login without accepting expired local trust. */
  public findLocalClientById(id: string, now: number): LocalClient | undefined {
    this.assertOpen();
    return this.client(
      this.sqlite
        .prepare(`SELECT ${LOCAL_CLIENT_COLUMNS} FROM auth_local_clients WHERE id = ?`)
        .get(id),
      now,
    );
  }

  /** Read the bound profile owner; malformed JSON or inconsistent ownership fails closed. */
  public profileOwner(): AppUser | undefined {
    this.assertOpen();
    const row: unknown = this.sqlite
      .prepare(
        `SELECT o.user_id AS userId, u.data
        FROM auth_profile_owner o LEFT JOIN auth_users u ON u.id = o.user_id WHERE o.id = 1`,
      )
      .get();
    if (row === undefined) return undefined;
    const owner = checked(OwnerRowSchema, row);
    let decoded: unknown;
    try {
      decoded = JSON.parse(owner.data);
    } catch (cause) {
      throw new StorageError('INVALID_RECORD', 'Stored application user is not valid JSON', {
        cause,
      });
    }
    const user = checked(AppUserSchema, decoded);
    if (user.id !== owner.userId)
      throw new StorageError('INVALID_RECORD', 'Application user identity is inconsistent');
    return user;
  }

  private identityUser(identity: VerifiedIdentity): string | undefined {
    const row: unknown = this.sqlite
      .prepare(
        `SELECT user_id AS userId FROM auth_external_identities
        WHERE provider_id = ? AND issuer = ? AND subject = ?`,
      )
      .get(identity.providerId, identity.issuer, identity.subject);
    if (row === undefined) return undefined;
    return checked(IdentityRowSchema, row).userId;
  }

  private bindIdentity(identity: VerifiedIdentity): AppUser {
    const owner = this.profileOwner();
    const identityUserId = this.identityUser(identity);
    if (owner) {
      if (identityUserId === undefined)
        throw new StorageError(
          'PROFILE_ACCOUNT_MISMATCH',
          'This profile belongs to another account. Sign in with the bound account.',
        );
      if (identityUserId !== owner.id)
        throw new StorageError('INVALID_RECORD', 'External identity does not match profile owner');
      const user = checked(AppUserSchema, {
        id: owner.id,
        name: identity.name,
        avatarUrl: identity.avatarUrl,
      });
      this.sqlite
        .prepare('UPDATE auth_users SET data = ? WHERE id = ?')
        .run(JSON.stringify(user), user.id);
      return user;
    }
    const existing: unknown = this.sqlite.prepare('SELECT id FROM auth_users LIMIT 1').get();
    if (identityUserId !== undefined || existing !== undefined)
      throw new StorageError('INVALID_RECORD', 'Authentication facts have no profile owner');
    const user = checked(AppUserSchema, {
      id: `user_${randomUUID()}`,
      name: identity.name,
      avatarUrl: identity.avatarUrl,
    });
    this.sqlite
      .prepare('INSERT INTO auth_users (id, data) VALUES (?, ?)')
      .run(user.id, JSON.stringify(user));
    this.sqlite
      .prepare(
        `INSERT INTO auth_external_identities
        (provider_id, issuer, subject, user_id) VALUES (?, ?, ?, ?)`,
      )
      .run(identity.providerId, identity.issuer, identity.subject, user.id);
    this.sqlite.prepare('INSERT INTO auth_profile_owner (id, user_id) VALUES (1, ?)').run(user.id);
    return user;
  }

  /**
   * Atomically bind the first verified account and issue its application session.
   * A different provider/issuer/subject never inherits existing profile data.
   */
  public completeLogin(
    identity: VerifiedIdentity,
    clientId: string,
    input: LoginSessionInput,
  ): StoredLoginSession {
    return this.transaction(() => {
      this.cleanupExpired(input.createdAt);
      if (!this.findLocalClientById(clientId, input.createdAt))
        throw new StorageError('LOCAL_CLIENT_EXPIRED', 'Local client authorization has expired');
      const user = this.bindIdentity(identity);
      this.sqlite
        .prepare(
          `INSERT INTO auth_login_sessions
          (id, token_hash, client_id, user_id, provider_id, issuer, subject, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.tokenHash,
          clientId,
          user.id,
          identity.providerId,
          identity.issuer,
          identity.subject,
          input.createdAt,
          input.expiresAt,
        );
      const session = this.findLoginSession(input.tokenHash, clientId, input.createdAt);
      if (!session) throw new StorageError('INVALID_RECORD', 'New application session is expired');
      return session;
    });
  }

  private storedSession(row: SessionRow, owner: AppUser): StoredLoginSession {
    if (row.expiresAt <= row.createdAt || row.userId !== owner.id)
      throw new StorageError('INVALID_RECORD', 'Application session ownership is inconsistent');
    const identityUserId = this.identityUser({
      providerId: row.providerId,
      issuer: row.issuer,
      subject: row.subject,
      name: owner.name,
      avatarUrl: owner.avatarUrl,
    });
    if (identityUserId !== owner.id)
      throw new StorageError('INVALID_RECORD', 'Application session identity is inconsistent');
    return {
      id: row.id,
      clientId: row.clientId,
      user: owner,
      providerId: row.providerId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }

  /** A login bearer is valid only alongside its original, still-authorized local client. */
  public findLoginSession(
    tokenHash: string,
    clientId: string,
    now: number,
  ): StoredLoginSession | undefined {
    this.assertOpen();
    const row: unknown = this.sqlite
      .prepare(
        `SELECT ${SESSION_COLUMNS} FROM auth_login_sessions
        WHERE token_hash = ? AND client_id = ?`,
      )
      .get(tokenHash, clientId);
    if (row === undefined) return undefined;
    const value = checked(SessionRowSchema, row);
    if (value.expiresAt <= now || !this.findLocalClientById(clientId, now)) return undefined;
    const owner = this.profileOwner();
    if (!owner)
      throw new StorageError('INVALID_RECORD', 'Application session has no profile owner');
    return this.storedSession(value, owner);
  }

  /** Revoke every login for one client while retaining its local trust and profile data. */
  public revokeClientSessions(clientId: string): void {
    this.transaction(() => {
      this.sqlite.prepare('DELETE FROM auth_login_sessions WHERE client_id = ?').run(clientId);
    });
  }
}
