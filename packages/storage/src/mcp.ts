import type Database from 'better-sqlite3';
import { Type, type Static, type TSchema } from 'typebox';
import { McpScopeSchema, McpServerInputSchema, type McpScope } from '@my-pi-harness/protocol';
import { StorageError } from './errors.js';
import { checked } from './validation.js';
import { McpDirectoryRepository } from './mcp-directory.js';

const epoch = Type.Integer({ minimum: 1 });
const id = Type.String({ minLength: 1, maxLength: 160 });
const SecretBindingSchema = Type.Object(
  {
    slotId: id,
    environmentName: Type.String(),
    credentialRef: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    credentialEpoch: epoch,
  },
  { additionalProperties: false },
);
/** Host-only secret identities; bytes belong exclusively to the credential adapter. */
export type McpSecretBinding = Static<typeof SecretBindingSchema>;
const ServerSchema = Type.Object(
  {
    ...McpServerInputSchema.properties,
    id,
    revision: epoch,
    enabled: Type.Boolean(),
    accessEpoch: epoch,
    secretBindings: Type.Array(SecretBindingSchema),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
/** SQLite authority for startup configuration and explicit control epochs. */
export type StoredMcpServer = Static<typeof ServerSchema>;
const GrantSchema = Type.Object(
  {
    id,
    serverId: id,
    serverRevision: epoch,
    accessEpoch: epoch,
    scope: McpScopeSchema,
    ownerId: id,
    identityEpoch: epoch,
    workspaceId: id,
    workspaceRoot: Type.String(),
    startupFingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    grantedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
/** One owner-authorized startup scope; never inferred from a different scope. */
export type McpStartupGrant = Static<typeof GrantSchema>;
const IdentitySchema = Type.Object({ ownerId: id, epoch }, { additionalProperties: false });
export type McpIdentity = Static<typeof IdentitySchema>;
const RowSchema = Type.Object({ data: Type.String() });
const IdRowSchema = Type.Object({ id, data: Type.String() });
const GrantRowSchema = Type.Object({ scope: McpScopeSchema, data: Type.String() });

/** Independent configuration tables survive all session projection rebuilds. */
export class McpRepository {
  public readonly directory: McpDirectoryRepository;
  public constructor(
    private readonly sqlite: Database.Database,
    private readonly assertOpen: () => void,
  ) {
    this.directory = new McpDirectoryRepository(sqlite, assertOpen);
  }

  private read<T extends TSchema>(schema: T, row: unknown): Static<T> | undefined {
    if (row === undefined) return undefined;
    const stored = checked(RowSchema, row);
    let decoded: unknown;
    try {
      decoded = JSON.parse(stored.data);
    } catch (cause) {
      throw new StorageError('INVALID_RECORD', 'Stored MCP configuration is invalid JSON', {
        cause,
      });
    }
    return checked(schema, decoded);
  }

  private transaction<T>(operation: () => T): T {
    this.assertOpen();
    return this.sqlite.transaction(operation).immediate();
  }

  public list(): StoredMcpServer[] {
    this.assertOpen();
    return this.sqlite
      .prepare('SELECT id, data FROM mcp_servers ORDER BY id')
      .all()
      .map((row) => {
        const stored = checked(IdRowSchema, row);
        const value = this.read(ServerSchema, stored);
        if (value !== undefined && value.id !== stored.id)
          throw new StorageError('INVALID_RECORD', 'Stored MCP server identity is inconsistent');
        if (value === undefined) throw new StorageError('INVALID_RECORD', 'MCP server disappeared');
        return value;
      });
  }

  public get(serverId: string): StoredMcpServer | undefined {
    this.assertOpen();
    const value = this.read(
      ServerSchema,
      this.sqlite.prepare('SELECT data FROM mcp_servers WHERE id = ?').get(serverId),
    );
    if (value !== undefined && value.id !== serverId)
      throw new StorageError('INVALID_RECORD', 'Stored MCP server identity is inconsistent');
    return value;
  }

  /** CAS covers configuration and control independently; replacing configuration invalidates grants. */
  public save(
    input: StoredMcpServer,
    expectedRevision: number | null,
    expectedAccessEpoch?: number,
  ): StoredMcpServer {
    const value = checked(ServerSchema, input);
    return this.transaction(() => {
      const previous = this.get(value.id);
      if (expectedRevision === null) {
        if (
          previous !== undefined ||
          value.revision !== 1 ||
          value.accessEpoch !== 1 ||
          value.enabled
        )
          throw new StorageError(
            'CONFLICT',
            'MCP server already exists or initial control state is invalid',
          );
      } else {
        if (
          previous === undefined ||
          previous.revision !== expectedRevision ||
          (expectedAccessEpoch !== undefined && previous.accessEpoch !== expectedAccessEpoch)
        )
          throw new StorageError('CONFLICT', 'MCP server revision or access epoch has changed');
        const configurationChanged = value.revision === previous.revision + 1;
        const controlChanged =
          value.revision === previous.revision && value.accessEpoch === previous.accessEpoch + 1;
        if (!configurationChanged && !controlChanged)
          throw new StorageError(
            'INVALID_RECORD',
            'MCP updates must advance configuration or control',
          );
        if (
          configurationChanged &&
          (![previous.accessEpoch, previous.accessEpoch + 1].includes(value.accessEpoch) ||
            value.enabled)
        )
          throw new StorageError(
            'INVALID_RECORD',
            'Changed startup configuration requires renewed trust',
          );
        if (controlChanged) {
          const previousConfiguration = {
            ...previous,
            accessEpoch: 0,
            enabled: false,
            updatedAt: 0,
          };
          const nextConfiguration = { ...value, accessEpoch: 0, enabled: false, updatedAt: 0 };
          if (
            value.enabled ||
            JSON.stringify(previousConfiguration) !== JSON.stringify(nextConfiguration)
          )
            throw new StorageError(
              'INVALID_RECORD',
              'Control updates cannot change startup configuration or grant trust',
            );
        }
        this.sqlite.prepare('DELETE FROM mcp_startup_grants WHERE server_id = ?').run(value.id);
      }
      this.sqlite
        .prepare(
          'INSERT INTO mcp_servers(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
        )
        .run(value.id, JSON.stringify(value));
      return value;
    });
  }

  public remove(serverId: string, expectedRevision: number): void {
    this.transaction(() => {
      const value = this.get(serverId);
      if (value === undefined || value.revision !== expectedRevision)
        throw new StorageError('CONFLICT', 'MCP server revision has changed');
      this.sqlite.prepare('DELETE FROM mcp_startup_grants WHERE server_id = ?').run(serverId);
      this.sqlite.prepare('DELETE FROM mcp_servers WHERE id = ?').run(serverId);
    });
  }

  public grants(serverId: string): McpStartupGrant[] {
    this.assertOpen();
    return this.sqlite
      .prepare('SELECT scope, data FROM mcp_startup_grants WHERE server_id = ? ORDER BY scope')
      .all(serverId)
      .map((row) => {
        const stored = checked(GrantRowSchema, row);
        const grant = this.read(GrantSchema, stored);
        if (grant !== undefined && (grant.serverId !== serverId || grant.scope !== stored.scope))
          throw new StorageError(
            'INVALID_RECORD',
            'Stored MCP startup grant identity is inconsistent',
          );
        if (grant === undefined) throw new StorageError('INVALID_RECORD', 'MCP grant disappeared');
        return grant;
      });
  }

  /** Trust and enable are committed together after the service rechecks the launch fingerprint. */
  public trust(input: McpStartupGrant): StoredMcpServer {
    const grant = checked(GrantSchema, input);
    return this.transaction(() => {
      const server = this.get(grant.serverId);
      const identity = this.identity(grant.ownerId);
      if (
        server === undefined ||
        server.revision !== grant.serverRevision ||
        server.accessEpoch !== grant.accessEpoch ||
        server.workspaceId !== grant.workspaceId ||
        identity.epoch !== grant.identityEpoch
      )
        throw new StorageError('CONFLICT', 'MCP startup authorization has changed');
      this.sqlite
        .prepare(
          'INSERT INTO mcp_startup_grants(server_id, scope, data) VALUES (?, ?, ?) ON CONFLICT(server_id, scope) DO UPDATE SET data = excluded.data',
        )
        .run(server.id, grant.scope, JSON.stringify(grant));
      const enabled = { ...server, enabled: true, updatedAt: grant.grantedAt };
      this.sqlite
        .prepare('UPDATE mcp_servers SET data = ? WHERE id = ?')
        .run(JSON.stringify(enabled), server.id);
      return enabled;
    });
  }

  public grant(serverId: string, scope: McpScope): McpStartupGrant | undefined {
    return this.grants(serverId).find((grant) => grant.scope === scope);
  }

  /** Profile identity epochs are independent of individual browser login sessions. */
  public identity(ownerId: string): McpIdentity {
    this.assertOpen();
    const current = this.read(
      IdentitySchema,
      this.sqlite.prepare('SELECT data FROM mcp_identity_control WHERE id = 1').get(),
    );
    if (current !== undefined) {
      if (current.ownerId !== ownerId)
        throw new StorageError(
          'PROFILE_ACCOUNT_MISMATCH',
          'MCP profile identity does not match its owner',
        );
      return current;
    }
    const initial = checked(IdentitySchema, { ownerId, epoch: 1 });
    this.sqlite
      .prepare('INSERT INTO mcp_identity_control(id, data) VALUES (1, ?)')
      .run(JSON.stringify(initial));
    return initial;
  }

  /** Explicit profile revocation invalidates every saved grant without revoking browser cookies. */
  public revokeIdentity(ownerId: string): McpIdentity {
    return this.transaction(() => {
      const previous = this.identity(ownerId);
      const current = { ...previous, epoch: previous.epoch + 1 };
      this.sqlite
        .prepare('UPDATE mcp_identity_control SET data = ? WHERE id = 1')
        .run(JSON.stringify(current));
      this.sqlite.prepare('DELETE FROM mcp_startup_grants').run();
      return current;
    });
  }
}
