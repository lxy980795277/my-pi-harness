import type Database from 'better-sqlite3';
import { Type, type Static, type TSchema } from 'typebox';
import { McpToolControlSchema, type McpToolControl } from '@my-pi-harness/protocol';
import { StorageError } from './errors.js';
import { checked } from './validation.js';

const id = Type.String({ minLength: 1, maxLength: 160 });
const epoch = Type.Integer({ minimum: 1 });
const hash = Type.String({ pattern: '^[a-f0-9]{64}$' });
const ReadOnlyGrantSchema = Type.Object(
  {
    id,
    serverId: id,
    remoteToolName: Type.String(),
    serverRevision: epoch,
    accessEpoch: epoch,
    definitionFingerprint: hash,
    argumentsHash: hash,
    ownerId: id,
    identityEpoch: epoch,
    toolControlRevision: epoch,
    grantedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type McpReadOnlyGrant = Static<typeof ReadOnlyGrantSchema>;
const Row = Type.Object({ data: Type.String() });
const CatalogRow = Type.Object({
  authority: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  discovered_at: Type.Integer({ minimum: 0 }),
  data: Type.String({ maxLength: 8 * 1024 * 1024 }),
});

/** The owning host validates the opaque catalog JSON using the official MCP schemas. */
export interface StoredMcpCatalog {
  authority: string;
  discoveredAt: number;
  data: string;
}

/** Per-tool controls and exact argument authorizations never contain credentials. */
export class McpDirectoryRepository {
  public constructor(
    private readonly sqlite: Database.Database,
    private readonly assertOpen: () => void,
  ) {}
  private decode<T extends TSchema>(schema: T, row: unknown): Static<T> {
    const record = checked(Row, row);
    let value: unknown;
    try {
      value = JSON.parse(record.data);
    } catch {
      throw new StorageError('INVALID_RECORD', 'Invalid MCP directory record');
    }
    return checked(schema, value);
  }
  public control(serverId: string, remoteToolName: string): McpToolControl {
    this.assertOpen();
    const row = this.sqlite
      .prepare('SELECT data FROM mcp_tool_controls WHERE server_id=? AND tool_name=?')
      .get(serverId, remoteToolName);
    if (row === undefined) return { serverId, remoteToolName, revision: 1, enabled: true };
    return this.decode(McpToolControlSchema, row);
  }
  public setControl(serverId: string, remoteToolName: string, enabled: boolean): McpToolControl {
    this.assertOpen();
    return this.sqlite
      .transaction(() => {
        const previous = this.control(serverId, remoteToolName);
        const value = { ...previous, revision: previous.revision + 1, enabled };
        this.sqlite
          .prepare(
            'INSERT INTO mcp_tool_controls(server_id,tool_name,data) VALUES(?,?,?) ON CONFLICT(server_id,tool_name) DO UPDATE SET data=excluded.data',
          )
          .run(serverId, remoteToolName, JSON.stringify(value));
        this.sqlite.prepare('DELETE FROM mcp_readonly_grants WHERE server_id=?').run(serverId);
        return value;
      })
      .immediate();
  }
  public grants(serverId: string): McpReadOnlyGrant[] {
    this.assertOpen();
    return this.sqlite
      .prepare('SELECT data FROM mcp_readonly_grants WHERE server_id=? ORDER BY id')
      .all(serverId)
      .map((row) => this.decode(ReadOnlyGrantSchema, row));
  }
  public grant(input: McpReadOnlyGrant): void {
    this.assertOpen();
    const value = checked(ReadOnlyGrantSchema, input);
    this.sqlite
      .prepare('INSERT INTO mcp_readonly_grants(id,server_id,data) VALUES(?,?,?)')
      .run(value.id, value.serverId, JSON.stringify(value));
  }
  public revoke(serverId: string, grantId: string): void {
    this.assertOpen();
    this.sqlite
      .prepare('DELETE FROM mcp_readonly_grants WHERE server_id=? AND id=?')
      .run(serverId, grantId);
  }
  public remove(serverId: string): void {
    this.assertOpen();
    this.sqlite.prepare('DELETE FROM mcp_readonly_grants WHERE server_id=?').run(serverId);
    this.sqlite.prepare('DELETE FROM mcp_tool_controls WHERE server_id=?').run(serverId);
    this.removeCatalog(serverId);
  }
  public catalog(serverId: string, scope: string): StoredMcpCatalog | undefined {
    this.assertOpen();
    const row = this.sqlite
      .prepare(
        'SELECT authority,discovered_at,data FROM mcp_catalog_snapshots WHERE server_id=? AND scope=?',
      )
      .get(serverId, scope);
    if (row === undefined) return undefined;
    const value = checked(CatalogRow, row);
    return { authority: value.authority, discoveredAt: value.discovered_at, data: value.data };
  }
  public saveCatalog(serverId: string, scope: string, input: StoredMcpCatalog): void {
    this.assertOpen();
    const value = checked(CatalogRow, {
      authority: input.authority,
      discovered_at: input.discoveredAt,
      data: input.data,
    });
    if (Buffer.byteLength(value.data) > 8 * 1024 * 1024)
      throw new StorageError('INVALID_RECORD', 'MCP catalog snapshot exceeds its limit');
    this.sqlite
      .prepare(
        'INSERT INTO mcp_catalog_snapshots(server_id,scope,authority,discovered_at,data) VALUES(?,?,?,?,?) ON CONFLICT(server_id,scope) DO UPDATE SET authority=excluded.authority,discovered_at=excluded.discovered_at,data=excluded.data',
      )
      .run(serverId, scope, value.authority, value.discovered_at, value.data);
  }
  public removeCatalog(serverId: string, scope?: string): void {
    this.assertOpen();
    if (scope === undefined)
      this.sqlite.prepare('DELETE FROM mcp_catalog_snapshots WHERE server_id=?').run(serverId);
    else
      this.sqlite
        .prepare('DELETE FROM mcp_catalog_snapshots WHERE server_id=? AND scope=?')
        .run(serverId, scope);
  }
}
