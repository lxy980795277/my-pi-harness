import type Database from 'better-sqlite3';
import { Type, type Static } from 'typebox';
import { RemoteMcpInputSchema } from '@my-pi-harness/protocol';
import { StorageError } from './errors.js';
import { checked } from './validation.js';

const epoch = Type.Integer({ minimum: 1 });
const id = Type.String({ minLength: 1, maxLength: 160 });
const StoredRemoteSchema = Type.Object(
  {
    ...RemoteMcpInputSchema.properties,
    pluginOwner: Type.Optional(
      Type.Object({ pluginId: id, componentId: id }, { additionalProperties: false }),
    ),
    id,
    revision: epoch,
    accessEpoch: epoch,
    enabled: Type.Boolean(),
    secretBindings: Type.Array(
      Type.Object(
        {
          slotId: id,
          headerName: Type.String(),
          credentialRef: Type.Union([Type.String(), Type.Null()]),
          epoch,
        },
        { additionalProperties: false },
      ),
    ),
    oauthCredentialRef: Type.Union([Type.String(), Type.Null()]),
    oauthClientSecretRef: Type.Union([Type.String(), Type.Null()]),
    oauthConnected: Type.Boolean(),
    grant: Type.Union([
      Type.Object(
        {
          id,
          ownerId: id,
          identityEpoch: epoch,
          fingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type StoredRemoteMcpServer = Static<typeof StoredRemoteSchema>;
const Row = Type.Object({ data: Type.String() });

/** Remote settings own only credential references; token bytes stay in the OS credential adapter. */
export class RemoteMcpRepository {
  public constructor(
    private readonly sqlite: Database.Database,
    private readonly assertOpen: () => void,
  ) {}
  private decode(row: unknown): StoredRemoteMcpServer {
    const stored = checked(Row, row);
    let value: unknown;
    try {
      value = JSON.parse(stored.data);
    } catch {
      throw new StorageError('INVALID_RECORD', 'Remote MCP settings are invalid JSON');
    }
    return checked(StoredRemoteSchema, value);
  }
  public list(): StoredRemoteMcpServer[] {
    this.assertOpen();
    return this.sqlite
      .prepare('SELECT data FROM remote_mcp_servers ORDER BY id')
      .all()
      .map((row) => this.decode(row));
  }
  public get(id: string): StoredRemoteMcpServer | undefined {
    this.assertOpen();
    const row = this.sqlite.prepare('SELECT data FROM remote_mcp_servers WHERE id=?').get(id);
    if (row === undefined) return undefined;
    const value = this.decode(row);
    if (value.id !== id) throw new StorageError('INVALID_RECORD', 'Remote MCP identity mismatch');
    return value;
  }
  public save(
    input: StoredRemoteMcpServer,
    expectedRevision: number | null,
    expectedAccessEpoch?: number,
  ): StoredRemoteMcpServer {
    this.assertOpen();
    const value = checked(StoredRemoteSchema, input);
    return this.sqlite
      .transaction(() => {
        const previous = this.get(value.id);
        if (expectedRevision === null) {
          if (
            previous !== undefined ||
            value.revision !== 1 ||
            value.accessEpoch !== 1 ||
            value.enabled ||
            value.grant !== null
          )
            throw new StorageError('CONFLICT', 'Remote MCP already exists');
        } else if (
          previous === undefined ||
          previous.revision !== expectedRevision ||
          (expectedAccessEpoch !== undefined && previous.accessEpoch !== expectedAccessEpoch)
        )
          throw new StorageError('CONFLICT', 'Remote MCP configuration changed');
        else if (value.revision !== previous.revision && value.revision !== previous.revision + 1)
          throw new StorageError(
            'INVALID_RECORD',
            'Remote MCP revision cannot move backwards or skip',
          );
        this.sqlite
          .prepare(
            'INSERT INTO remote_mcp_servers(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
          )
          .run(value.id, JSON.stringify(value));
        return value;
      })
      .immediate();
  }
  public remove(id: string, expectedRevision: number): void {
    this.assertOpen();
    this.sqlite
      .transaction(() => {
        const server = this.get(id);
        if (server === undefined || server.revision !== expectedRevision)
          throw new StorageError('CONFLICT', 'Remote MCP configuration changed');
        this.sqlite.prepare('DELETE FROM remote_mcp_servers WHERE id=?').run(id);
      })
      .immediate();
  }
}
