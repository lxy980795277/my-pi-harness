import type Database from 'better-sqlite3';
import {
  MemoryEntrySchema,
  MemorySettingsSchema,
  MemoryWriteReceiptSchema,
  MemoryModeSchema,
  type MemoryEntry,
  type MemoryMutationResult,
  type MemoryScope,
  type MemorySettings,
  type MemorySource,
  type MemoryWriteReceipt,
  type MemoryListInput,
  type MemoryPage,
  type MemoryCurrentStatus,
} from '@my-pi-harness/protocol';
import type {
  MemoryAccess,
  MemoryRepositorySnapshot,
  MemoryCandidateKey,
} from '@my-pi-harness/protocol/internal';
import type {
  MemoryCreateRecord,
  MemoryForgetRecord,
  MemoryRepository as MemoryStorePort,
  MemorySettingsRecord,
  MemoryUpdateRecord,
  MemoryAgentMutationRecord,
} from '@my-pi-harness/memory';
import { Type, type Static, type TSchema } from 'typebox';
import { checked } from '../shared/validation';
import { StorageError } from '../shared/errors';
import { DEFAULT_MEMORY_SETTINGS } from '@my-pi-harness/memory';
import { assertMemoryMutationAccess } from './mutation-access';
import { memorySource, memorySourceFingerprint } from './sources';

type EntryRow = Static<typeof EntryRowSchema>;
type ReceiptRow = Static<typeof ReceiptRowSchema>;
interface MemoryFilter {
  sql: string;
  params: (string | number)[];
}

const EntryRowSchema = Type.Object({
  id: Type.String(),
  scopeKey: Type.String(),
  revision: Type.Integer(),
  data: Type.String(),
});
const ReceiptRowSchema = Type.Object({
  fingerprint: Type.String(),
  operation: Type.String(),
  data: Type.String(),
});
const MAX_ENABLED_FIXED = 100;
const RECEIPT_OPERATIONS = {
  save: 'create',
  learn: 'create',
  update: 'update',
  delete: 'forget',
} as const;
const KeyRowSchema = Type.Object({
  id: Type.String(),
  scopeKey: Type.String(),
  revision: Type.Integer({ minimum: 1 }),
  mode: MemoryModeSchema,
  enabled: Type.Integer({ minimum: 0, maximum: 1 }),
});
const CountSchema = Type.Object({ count: Type.Integer({ minimum: 0 }) });
const SettingsRowSchema = Type.Object({
  revision: Type.Integer({ minimum: 1 }),
  data: Type.String(),
});
const KEY_COLUMNS =
  "id,scope_key AS scopeKey,revision,json_extract(data,'$.mode') AS mode,json_extract(data,'$.enabled') AS enabled";

/** Independent facts use the profile's transaction/failure gate and never append session events. */
export class MemoryRepository implements MemoryStorePort {
  public constructor(
    private readonly sqlite: Database.Database,
    private readonly transact: <T>(operation: () => T, readOnly?: boolean) => T,
    private readonly profileOwner: () => string | undefined,
    private readonly forgotten?: (id: string) => void,
  ) {}

  public mutateFromAgent(record: MemoryAgentMutationRecord): MemoryMutationResult {
    const { access } = record;
    return this.owned(access.ownerUserId, () => {
      const operation = RECEIPT_OPERATIONS[record.operation];
      const retry = this.receipt(
        access.ownerUserId,
        access.toolCallId,
        record.fingerprint,
        operation,
      );
      if (retry)
        return this.result(access.ownerUserId, decode(MemoryWriteReceiptSchema, retry.data));
      const target =
        record.operation === 'update' || record.operation === 'delete'
          ? this.entry(access.ownerUserId, record.input.memoryId)
          : undefined;
      if ((record.operation === 'update' || record.operation === 'delete') && target === undefined)
        throw new StorageError('MEMORY_NOT_FOUND', 'Memory does not exist or has been forgotten');
      const scope = assertMemoryMutationAccess(this.sqlite, record, target?.scope);
      if (record.operation === 'learn') {
        const settings = this.settings(access.ownerUserId) ?? DEFAULT_MEMORY_SETTINGS;
        if (!settings.allowUse || !settings.allowLearning)
          throw new StorageError('CONFLICT', 'Automatic memory learning is disabled');
      }
      switch (record.operation) {
        case 'save':
        case 'learn': {
          const duplicate = this.sqlite
            .prepare(
              `SELECT id,scope_key AS scopeKey,revision,data FROM memory_entries
            WHERE owner_user_id=? AND scope_key=? AND json_extract(data,'$.category')=?
            AND json_extract(data,'$.body')=? ORDER BY id LIMIT 1`,
            )
            .get(access.ownerUserId, scopeKey(scope), record.input.category, record.input.body);
          if (duplicate !== undefined) {
            const existing = this.decodeEntry(duplicate);
            if (!existing.enabled || existing.mode !== record.input.mode)
              conflict(
                'Existing memory is disabled or uses a different mode; update it explicitly or manage it in settings',
              );
            this.recordSource(access.ownerUserId, existing.id, access.source);
            const receipt = this.writeReceipt(
              access.ownerUserId,
              access.toolCallId,
              record.fingerprint,
              {
                requestId: access.toolCallId,
                operation: 'create',
                memoryId: existing.id,
                revision: existing.revision,
                status: 'applied',
              },
            );
            return { entry: existing, receipt };
          }
          return this.create(access.ownerUserId, {
            requestId: access.toolCallId,
            fingerprint: record.fingerprint,
            entry: {
              id: record.memoryId,
              scope,
              category: record.input.category,
              body: record.input.body,
              mode: record.input.mode,
              enabled: true,
              source: access.source,
              revision: 1,
              createdAt: record.at,
              updatedAt: record.at,
            },
          });
        }
        case 'update': {
          if (target === undefined)
            throw new StorageError('MEMORY_NOT_FOUND', 'Memory is unavailable');
          return this.update(access.ownerUserId, record.input.memoryId, {
            requestId: access.toolCallId,
            fingerprint: record.fingerprint,
            expectedRevision: record.input.expectedRevision,
            category: record.input.category,
            body: record.input.body,
            enabled: target.enabled,
            source: access.source,
            ...(record.input.mode === undefined ? {} : { mode: record.input.mode }),
            at: record.at,
          });
        }
        case 'delete':
          return this.forget(access.ownerUserId, record.input.memoryId, {
            requestId: access.toolCallId,
            fingerprint: record.fingerprint,
            expectedRevision: record.input.expectedRevision,
            at: record.at,
          });
      }
    });
  }

  public list(ownerUserId: string, input: MemoryListInput = {}): MemoryPage {
    return this.owned(
      ownerUserId,
      () => {
        const limit = input.limit ?? 20;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
          invalid('Memory page limit must be between 1 and 100');
        const clauses = ['owner_user_id=?'];
        const params: (string | number)[] = [ownerUserId];
        if (input.scope !== undefined) {
          clauses.push('scope_key=?');
          params.push(scopeKey(input.scope));
        }
        if (input.mode !== undefined) {
          clauses.push("json_extract(data,'$.mode')=?");
          params.push(input.mode);
        }
        if (input.enabled !== undefined) {
          clauses.push("json_extract(data,'$.enabled')=?");
          params.push(input.enabled ? 1 : 0);
        }
        if (input.category !== undefined) {
          clauses.push("json_extract(data,'$.category')=?");
          params.push(input.category);
        }
        const where = clauses.join(' AND ');
        const total = checked(
          CountSchema,
          this.sqlite
            .prepare(`SELECT COUNT(*) AS count FROM memory_entries WHERE ${where}`)
            .get(...params),
        ).count;
        const rows = this.sqlite
          .prepare(
            `SELECT id,scope_key AS scopeKey,revision,data FROM memory_entries WHERE ${where} AND id>? ORDER BY id LIMIT ?`,
          )
          .all(...params, input.cursor ?? '', limit + 1);
        const items = rows.slice(0, limit).map((row) => this.decodeEntry(row));
        return {
          items,
          total,
          nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
        };
      },
      true,
    );
  }

  public entries(access: MemoryAccess, ids: readonly string[]): MemoryEntry[] {
    return this.owned(
      access.ownerUserId,
      () => {
        this.assertIds(ids, 100);
        if (ids.length === 0) return [];
        const filter = this.accessFilter(access);
        return this.sqlite
          .prepare(
            `SELECT id,scope_key AS scopeKey,revision,data FROM memory_entries WHERE ${filter.sql} AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
          )
          .all(...filter.params, ...ids)
          .map((row) => this.decodeEntry(row));
      },
      true,
    );
  }

  public statuses(ownerUserId: string, ids: readonly string[]): MemoryCurrentStatus[] {
    return this.owned(
      ownerUserId,
      () => {
        this.assertIds(ids, 128);
        if (ids.length === 0) return [];
        const keys = this.sqlite
          .prepare(
            `SELECT ${KEY_COLUMNS} FROM memory_entries WHERE owner_user_id=? AND id IN (${ids.map(() => '?').join(',')})`,
          )
          .all(ownerUserId, ...ids)
          .map((row) => this.key(row));
        const found = new Map(keys.map((key) => [key.id, key]));
        return ids.map((id) => {
          const key = found.get(id);
          return {
            id,
            revision: key?.revision ?? null,
            enabled: key?.enabled ?? false,
            mode: key?.mode ?? null,
          };
        });
      },
      true,
    );
  }

  public readSnapshot(access: MemoryAccess, includeFixed = true): MemoryRepositorySnapshot {
    return this.owned(
      access.ownerUserId,
      () => {
        const filter = this.accessFilter(access);
        const candidates = this.sqlite
          .prepare(`SELECT ${KEY_COLUMNS} FROM memory_entries WHERE ${filter.sql} ORDER BY id`)
          .all(...filter.params)
          .map((row) => this.key(row));
        let entries: MemoryEntry[] = [];
        const settings = this.settings(access.ownerUserId) ?? null;
        if (includeFixed && settings?.allowUse !== false) {
          entries = this.sqlite
            .prepare(
              `SELECT id, scope_key AS scopeKey, revision, data FROM memory_entries
          WHERE ${filter.sql} AND json_extract(data,'$.mode')='fixed' AND json_extract(data,'$.enabled')=1 ORDER BY id LIMIT 101`,
            )
            .all(...filter.params)
            .map((row) => this.decodeEntry(row));
        }
        if (entries.length > MAX_ENABLED_FIXED)
          invalid('Stored enabled fixed memory count exceeds the supported limit');
        return { settings, entries, candidates };
      },
      true,
    );
  }

  public create(ownerUserId: string, record: MemoryCreateRecord): MemoryMutationResult {
    return this.owned(ownerUserId, () => {
      const retry = this.receipt(ownerUserId, record.requestId, record.fingerprint, 'create');
      if (retry) return this.result(ownerUserId, decode(MemoryWriteReceiptSchema, retry.data));
      const value = checked(MemoryEntrySchema, record.entry);
      if (value.revision !== 1 || !value.body.trim())
        invalid('New memory requires a first revision and non-empty text');
      this.assertScope(value.scope);
      this.assertSource(value.scope, value.source);
      this.assertFixedQuota(ownerUserId, value);
      if (
        this.sqlite.prepare('SELECT 1 FROM memory_suppressions WHERE memory_id = ?').get(value.id)
      )
        throw new StorageError('CONFLICT', 'A forgotten memory identity cannot be reused');
      this.sqlite
        .prepare(
          'INSERT INTO memory_entries (id,owner_user_id,scope_key,revision,data) VALUES (?,?,?,?,?)',
        )
        .run(value.id, ownerUserId, scopeKey(value.scope), value.revision, JSON.stringify(value));
      this.recordSource(ownerUserId, value.id, value.source);
      const receipt = this.writeReceipt(ownerUserId, record.requestId, record.fingerprint, {
        requestId: record.requestId,
        operation: 'create',
        memoryId: value.id,
        revision: 1,
        status: 'applied',
      });
      return { entry: value, receipt };
    });
  }

  public update(ownerUserId: string, id: string, record: MemoryUpdateRecord): MemoryMutationResult {
    return this.owned(ownerUserId, () => {
      const retry = this.receipt(ownerUserId, record.requestId, record.fingerprint, 'update');
      if (retry) return this.result(ownerUserId, decode(MemoryWriteReceiptSchema, retry.data));
      const previous = this.required(ownerUserId, id, record.expectedRevision);
      if (record.source !== undefined) this.assertSource(previous.scope, record.source);
      if (record.source !== undefined) this.recordSource(ownerUserId, id, previous.source);
      const value = checked(MemoryEntrySchema, {
        ...previous,
        category: record.category,
        body: record.body,
        enabled: record.enabled,
        mode: record.mode ?? previous.mode,
        source: record.source ?? previous.source,
        revision: previous.revision + 1,
        updatedAt: Math.max(previous.updatedAt, record.at),
      });
      if (!value.body.trim()) invalid('Memory text must not be empty');
      this.assertFixedQuota(ownerUserId, value);
      this.sqlite
        .prepare(
          'UPDATE memory_entries SET revision = ?, data = ? WHERE id = ? AND owner_user_id = ?',
        )
        .run(value.revision, JSON.stringify(value), id, ownerUserId);
      if (record.source !== undefined) this.recordSource(ownerUserId, id, value.source);
      const receipt = this.writeReceipt(ownerUserId, record.requestId, record.fingerprint, {
        requestId: record.requestId,
        operation: 'update',
        memoryId: id,
        revision: value.revision,
        status: 'applied',
      });
      return { entry: value, receipt };
    });
  }

  public forget(ownerUserId: string, id: string, record: MemoryForgetRecord): MemoryMutationResult {
    return this.owned(ownerUserId, () => {
      const retry = this.receipt(ownerUserId, record.requestId, record.fingerprint, 'forget');
      if (retry) return this.result(ownerUserId, decode(MemoryWriteReceiptSchema, retry.data));
      const previous = this.required(ownerUserId, id, record.expectedRevision);
      const nextRevision = previous.revision + 1;
      this.sqlite
        .prepare('DELETE FROM memory_entries WHERE owner_user_id = ? AND id = ?')
        .run(ownerUserId, id);
      this.forgotten?.(id);
      const sourceFingerprint = memorySourceFingerprint(previous.source);
      this.sqlite
        .prepare(
          `INSERT INTO memory_suppressions(owner_user_id,memory_id,revision,source_fingerprint,forgotten_at)
        VALUES (?,?,?,?,?)`,
        )
        .run(ownerUserId, id, nextRevision, sourceFingerprint, record.at);
      const receipt = this.writeReceipt(ownerUserId, record.requestId, record.fingerprint, {
        requestId: record.requestId,
        operation: 'forget',
        memoryId: id,
        revision: nextRevision,
        status: 'forgotten',
      });
      return { entry: null, receipt };
    });
  }

  public getSettings(ownerUserId: string): MemorySettings | undefined {
    return this.owned(ownerUserId, () => this.settings(ownerUserId), true);
  }

  public updateSettings(ownerUserId: string, record: MemorySettingsRecord): MemorySettings {
    return this.owned(ownerUserId, () => {
      const retry = this.receipt(ownerUserId, record.requestId, record.fingerprint, 'settings');
      if (retry) return decode(MemorySettingsSchema, retry.data);
      const previous = this.settings(ownerUserId);
      if ((previous?.revision ?? 0) !== record.expectedRevision) conflict();
      const value = checked(MemorySettingsSchema, {
        allowUse: record.allowUse,
        allowLearning: record.allowLearning,
        revision: record.expectedRevision + 1,
      });
      this.sqlite
        .prepare(
          `INSERT INTO memory_settings(owner_user_id,revision,data) VALUES (?,?,?)
        ON CONFLICT(owner_user_id) DO UPDATE SET revision = excluded.revision, data = excluded.data`,
        )
        .run(ownerUserId, value.revision, JSON.stringify(value));
      this.sqlite
        .prepare(
          'INSERT INTO memory_write_receipts(owner_user_id,request_id,fingerprint,operation,data) VALUES (?,?,?,?,?)',
        )
        .run(ownerUserId, record.requestId, record.fingerprint, 'settings', JSON.stringify(value));
      return value;
    });
  }

  private owned<T>(owner: string, operation: () => T, readOnly = false): T {
    return this.transact(() => {
      if (this.profileOwner() !== owner)
        throw new StorageError(
          'PROFILE_ACCOUNT_MISMATCH',
          'Memory belongs to the authenticated profile owner',
        );
      return operation();
    }, readOnly);
  }

  private assertFixedQuota(owner: string, entry: MemoryEntry): void {
    if (!entry.enabled || entry.mode !== 'fixed') return;
    const count = checked(
      CountSchema,
      this.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM memory_entries WHERE owner_user_id=? AND id<>? AND json_extract(data,'$.enabled')=1 AND json_extract(data,'$.mode')='fixed'",
        )
        .get(owner, entry.id),
    ).count;
    if (count >= MAX_ENABLED_FIXED)
      throw new StorageError(
        'CONFLICT',
        'At most 100 enabled fixed memories may be stored; disable an entry or use relevant mode',
      );
  }

  private accessFilter(access: MemoryAccess): MemoryFilter {
    const scopes: string[] = [];
    const params: (string | number)[] = [access.ownerUserId];
    if (access.workspaceId !== null) {
      this.assertScope({ kind: 'workspace', workspaceId: access.workspaceId });
      scopes.push('scope_key=?');
      params.push(`workspace:${access.workspaceId}`);
    }
    if (access.userMemoryIds !== undefined) {
      this.assertIds(access.userMemoryIds, 100);
      if (access.userMemoryIds.length > 0) {
        scopes.push(
          `(scope_key='user' AND id IN (${access.userMemoryIds.map(() => '?').join(',')}))`,
        );
        params.push(...access.userMemoryIds);
      }
    } else if (access.includeUser) scopes.push("scope_key='user'");
    return { sql: `owner_user_id=? AND (${scopes.length ? scopes.join(' OR ') : '0'})`, params };
  }

  private key(input: unknown): MemoryCandidateKey {
    const value = checked(KeyRowSchema, input);
    let scope: MemoryScope;
    if (value.scopeKey === 'user') scope = { kind: 'user' };
    else if (value.scopeKey.startsWith('workspace:') && value.scopeKey.length > 10)
      scope = { kind: 'workspace', workspaceId: value.scopeKey.slice(10) };
    else invalid('Memory scope is invalid');
    return {
      id: value.id,
      revision: value.revision,
      scope,
      mode: value.mode,
      enabled: value.enabled === 1,
    };
  }

  private assertIds(ids: readonly string[], maximum: number): void {
    if (ids.length > maximum || new Set(ids).size !== ids.length)
      invalid('Memory identity selection exceeds its limit or contains duplicates');
  }

  private entry(owner: string, id: string): MemoryEntry | undefined {
    const row: unknown = this.sqlite
      .prepare(
        'SELECT id,scope_key AS scopeKey,revision,data FROM memory_entries WHERE owner_user_id = ? AND id = ?',
      )
      .get(owner, id);
    return row === undefined ? undefined : this.decodeEntry(row);
  }

  private required(owner: string, id: string, revision: number): MemoryEntry {
    const current = this.entry(owner, id);
    if (!current)
      throw new StorageError('MEMORY_NOT_FOUND', 'Memory does not exist or has been forgotten');
    if (current.revision !== revision) conflict();
    return current;
  }

  private decodeEntry(input: unknown): MemoryEntry {
    const row: EntryRow = checked(EntryRowSchema, input);
    const entry = decode(MemoryEntrySchema, row.data);
    if (
      entry.id !== row.id ||
      entry.revision !== row.revision ||
      scopeKey(entry.scope) !== row.scopeKey
    )
      invalid('Memory columns and durable data disagree');
    return entry;
  }

  private settings(owner: string): MemorySettings | undefined {
    const row: unknown = this.sqlite
      .prepare('SELECT revision,data FROM memory_settings WHERE owner_user_id = ?')
      .get(owner);
    if (row === undefined) return undefined;
    const value = checked(SettingsRowSchema, row);
    const settings = decode(MemorySettingsSchema, value.data);
    if (settings.revision !== value.revision) invalid('Memory settings revision is inconsistent');
    return settings;
  }

  private receipt(
    owner: string,
    requestId: string,
    fingerprint: string,
    operation: string,
  ): ReceiptRow | undefined {
    const row: unknown = this.sqlite
      .prepare(
        'SELECT fingerprint,operation,data FROM memory_write_receipts WHERE owner_user_id = ? AND request_id = ?',
      )
      .get(owner, requestId);
    if (row === undefined) return undefined;
    const receipt = checked(ReceiptRowSchema, row);
    if (receipt.fingerprint !== fingerprint || receipt.operation !== operation)
      throw new StorageError(
        'CONFLICT',
        'Memory request identity was already used for another operation',
      );
    return receipt;
  }

  private result(owner: string, receipt: MemoryWriteReceipt): MemoryMutationResult {
    return { receipt, entry: this.entry(owner, receipt.memoryId) ?? null };
  }

  private writeReceipt(
    owner: string,
    requestId: string,
    fingerprint: string,
    input: MemoryWriteReceipt,
  ): MemoryWriteReceipt {
    const receipt = checked(MemoryWriteReceiptSchema, input);
    this.sqlite
      .prepare(
        'INSERT INTO memory_write_receipts(owner_user_id,request_id,fingerprint,operation,data) VALUES (?,?,?,?,?)',
      )
      .run(owner, requestId, fingerprint, receipt.operation, JSON.stringify(receipt));
    return receipt;
  }

  private assertScope(scope: MemoryScope): void {
    if (scope.kind === 'user') return;
    const row: unknown = this.sqlite
      .prepare('SELECT id FROM workspaces WHERE id = ? AND archived = 0')
      .get(scope.workspaceId);
    if (row === undefined)
      throw new StorageError('WORKSPACE_NOT_FOUND', 'Memory workspace is unavailable');
  }

  private assertSource(scope: MemoryScope, source: MemorySource): void {
    memorySource(this.sqlite, scope, source);
  }

  private recordSource(owner: string, id: string, source: MemorySource): void {
    if (source.kind === 'message')
      this.sqlite
        .prepare(
          'INSERT OR IGNORE INTO memory_entry_sources(owner_user_id,memory_id,source_fingerprint) VALUES (?,?,?)',
        )
        .run(owner, id, memorySourceFingerprint(source));
  }
}

function decode<T extends TSchema>(schema: T, text: string): Static<T> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new StorageError('INVALID_RECORD', 'Stored memory is not valid JSON', { cause });
  }
  return checked(schema, value);
}

function scopeKey(scope: MemoryScope): string {
  return scope.kind === 'user' ? 'user' : `workspace:${scope.workspaceId}`;
}

function conflict(message = 'Memory revision has changed'): never {
  throw new StorageError('CONFLICT', message);
}

function invalid(message: string): never {
  throw new StorageError('INVALID_RECORD', message);
}
