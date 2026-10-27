import type Database from 'better-sqlite3';
import { Type, type Static } from 'typebox';
import { ConnectionViewSchema } from '@my-pi-harness/protocol';
import { StorageError } from '../shared/errors.js';
import { checked } from '../shared/validation.js';

export type StoredConnection = Static<typeof StoredConnectionSchema>;

const StoredConnectionSchema = Type.Object(
  {
    ...ConnectionViewSchema.properties,
    ownerId: Type.String({ minLength: 1, maxLength: 160 }),
    identityEpoch: Type.Integer({ minimum: 1 }),
    credentialRef: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
  },
  { additionalProperties: false },
);

const Row = Type.Object({ data: Type.String() });

/** Config has CAS revisions and authority epochs; credential bytes remain in CredentialStore. */
export class ConnectionRepository {
  public constructor(
    private readonly sqlite: Database.Database,
    private readonly assertOpen: () => void,
  ) {}
  private decode(row: unknown): StoredConnection {
    const stored = checked(Row, row);
    let value: unknown;
    try {
      value = JSON.parse(stored.data);
    } catch {
      throw new StorageError('INVALID_RECORD', 'Connection record is invalid JSON');
    }
    return checked(StoredConnectionSchema, value);
  }
  public list(ownerId: string): StoredConnection[] {
    this.assertOpen();
    return this.sqlite
      .prepare('SELECT data FROM external_connections WHERE owner_id=? ORDER BY id')
      .all(ownerId)
      .map((row) => this.decode(row));
  }
  public get(id: string): StoredConnection | undefined {
    this.assertOpen();
    const row = this.sqlite.prepare('SELECT data FROM external_connections WHERE id=?').get(id);
    if (row === undefined) return undefined;
    const value = this.decode(row);
    if (value.id !== id) throw new StorageError('INVALID_RECORD', 'Connection identity mismatch');
    return value;
  }
  public save(
    input: StoredConnection,
    expectedRevision: number | null,
    expectedEpoch?: number,
  ): StoredConnection {
    this.assertOpen();
    const value = checked(StoredConnectionSchema, input);
    if (
      (value.connected && (value.credentialRef === null || value.accountId === null)) ||
      (value.clientSecretConfigured && value.credentialRef === null)
    )
      throw new StorageError(
        'INVALID_RECORD',
        'Connected authority requires a credential and verified account',
      );
    return this.sqlite
      .transaction(() => {
        const previous = this.get(value.id);
        if (expectedRevision === null) {
          if (
            previous !== undefined ||
            value.revision !== 1 ||
            value.accessEpoch !== 1 ||
            value.connected ||
            value.credentialRef !== null ||
            value.accountId !== null
          )
            throw new StorageError(
              'CONFLICT',
              'Connection already exists or has invalid initial authority',
            );
        } else {
          if (
            previous === undefined ||
            previous.revision !== expectedRevision ||
            (expectedEpoch !== undefined && previous.accessEpoch !== expectedEpoch)
          )
            throw new StorageError('CONFLICT', 'Connection configuration changed');
          if (
            value.ownerId !== previous.ownerId ||
            value.serviceId !== previous.serviceId ||
            value.identityEpoch < previous.identityEpoch ||
            (value.revision !== previous.revision && value.revision !== previous.revision + 1) ||
            (value.accessEpoch !== previous.accessEpoch &&
              value.accessEpoch !== previous.accessEpoch + 1)
          )
            throw new StorageError(
              'INVALID_RECORD',
              'Connection ownership, service or sequence changed unexpectedly',
            );
        }
        this.sqlite
          .prepare(
            'INSERT INTO external_connections(id,owner_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
          )
          .run(value.id, value.ownerId, JSON.stringify(value));
        return value;
      })
      .immediate();
  }
  public remove(id: string, expectedRevision: number, expectedEpoch: number): void {
    this.assertOpen();
    this.sqlite
      .transaction(() => {
        const previous = this.get(id);
        if (
          previous === undefined ||
          previous.revision !== expectedRevision ||
          previous.accessEpoch !== expectedEpoch
        )
          throw new StorageError('CONFLICT', 'Connection configuration changed');
        this.sqlite.prepare('DELETE FROM external_connections WHERE id=?').run(id);
      })
      .immediate();
  }
}
