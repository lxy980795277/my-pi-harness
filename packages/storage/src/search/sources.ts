import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { Type, type Static } from 'typebox';
import type { SearchScope, SearchSourceRef, SearchSourceTarget } from '@my-pi-harness/protocol';
import type {
  SearchAccess,
  SearchSourceSnapshot,
  SearchSourcePage,
  SearchSourceMembership,
} from '@my-pi-harness/protocol/internal';
import { checked } from '../shared/validation';
import { StorageError } from '../shared/errors';

type FactRow = Static<typeof FactRowSchema>;
export interface SearchPredicate {
  sql: string;
  params: (string | number | null)[];
}

const nullableText = Type.Union([Type.String(), Type.Null()]);
const FactRowSchema = Type.Object({
  sourceId: Type.String(),
  kind: Type.Union([Type.Literal('memory'), Type.Literal('message')]),
  revision: Type.Integer({ minimum: 1 }),
  text: Type.String({ maxLength: 2_000_000 }),
  workspaceId: nullableText,
  sessionId: nullableText,
  messageId: nullableText,
  memoryId: nullableText,
  origin: Type.Union([
    Type.Literal('memory'),
    Type.Literal('user'),
    Type.Literal('assistant'),
    Type.Literal('task'),
    Type.Literal('communication'),
  ]),
  status: Type.String(),
  createdAt: Type.Integer({ minimum: 0 }),
  title: Type.String(),
});
const MembershipSchema = Type.Object({
  branchId: Type.String(),
  taskId: nullableText,
  ordinal: Type.Integer({ minimum: 0 }),
});
const IdSchema = Type.Object({ id: Type.String() });
const FACT_COLUMNS = `f.source_id AS sourceId,f.kind,f.revision,f.text,f.workspace_id AS workspaceId,
 f.session_id AS sessionId,f.message_id AS messageId,f.memory_id AS memoryId,
 f.origin,f.status,f.created_at AS createdAt,f.title`;

/** Shared persistent membership predicates used before source resolution and both candidate engines. */
export function sourcePredicate(access: SearchAccess): SearchPredicate {
  const scope = access.scope;
  const clauses = ['f.owner_user_id = ?'];
  const params: (string | number | null)[] = [access.ownerUserId];
  if (
    scope.createdFrom !== undefined &&
    scope.createdTo !== undefined &&
    scope.createdFrom > scope.createdTo
  )
    throw new StorageError('INVALID_RECORD', 'Search time range is reversed');
  if (scope.createdFrom !== undefined) {
    clauses.push('f.created_at>=?');
    params.push(scope.createdFrom);
  }
  if (scope.createdTo !== undefined) {
    clauses.push('f.created_at<=?');
    params.push(scope.createdTo);
  }
  if (access.excludeSessionId !== undefined) {
    clauses.push('(f.session_id IS NULL OR f.session_id<>?)');
    params.push(access.excludeSessionId);
  }
  if (scope.kind !== undefined) {
    clauses.push('f.kind = ?');
    params.push(scope.kind);
  }
  if (scope.memoryMode !== undefined) {
    clauses.push(
      "f.kind='memory' AND EXISTS(SELECT 1 FROM memory_entries me WHERE me.id=f.memory_id AND json_extract(me.data,'$.mode')=?)",
    );
    params.push(scope.memoryMode);
  }
  if (scope.includeArchived !== true) clauses.push('f.archived = 0');
  const userIds = access.userMemoryIds;
  if (userIds !== undefined && (userIds.length > 100 || new Set(userIds).size !== userIds.length))
    throw new StorageError('INVALID_RECORD', 'User memory scope exceeds its identity limit');
  const userGrant =
    userIds !== undefined && userIds.length > 0
      ? `f.memory_id IN (${userIds.map(() => '?').join(',')})`
      : '0';
  if (scope.workspaceId !== undefined) {
    if (
      scope.workspaceId !== null &&
      (scope.includeUserMemories === true || (userIds?.length ?? 0) > 0)
    ) {
      clauses.push(
        `(f.workspace_id IS ? OR (f.kind='memory' AND f.workspace_id IS NULL AND ${userIds === undefined ? '1' : userGrant}))`,
      );
      params.push(scope.workspaceId, ...(userIds ?? []));
    } else {
      clauses.push('f.workspace_id IS ?');
      params.push(scope.workspaceId);
    }
  }
  if (scope.includeUserMemories === false || userIds !== undefined) {
    clauses.push(`(NOT (f.kind='memory' AND f.workspace_id IS NULL) OR ${userGrant})`);
    params.push(...(userIds ?? []));
  }
  if (scope.sessionId !== undefined) {
    clauses.push('f.session_id = ?');
    params.push(scope.sessionId);
  }
  const member = membershipPredicate(scope, 'sm', 'f.active_branch_id');
  clauses.push(
    `(f.kind='memory' OR EXISTS(SELECT 1 FROM search_memberships sm WHERE sm.source_id=f.source_id AND ${member.sql}))`,
  );
  params.push(...member.params);
  if (scope.branchId !== undefined || scope.taskId !== undefined) clauses.push(`f.kind='message'`);
  return { sql: clauses.join(' AND '), params };
}

/** Read only one persistent text at a time; no live overlay, thinking or provider metadata is selected. */
export class PersistentSearchSources {
  public constructor(private readonly sqlite: Database.Database) {}

  public page(ownerUserId: string, input: { after?: string; limit?: number }): SearchSourcePage {
    const limit = input.limit ?? 8;
    bounded(limit, 1, 16);
    const rows: unknown[] = this.sqlite
      .prepare(
        `SELECT f.source_id AS id FROM search_facts f WHERE f.owner_user_id=? AND f.source_id>? ORDER BY f.source_id LIMIT ?`,
      )
      .all(ownerUserId, input.after ?? '', limit + 1);
    const ids = rows.map((row) => checked(IdSchema, row).id);
    const items = ids.slice(0, limit).map((id) => {
      const source = this.read(ownerUserId, id);
      if (!source)
        throw new StorageError(
          'INVALID_RECORD',
          'A persistent search source disappeared in one read transaction',
        );
      return source;
    });
    return { items, next: ids.length > limit ? (items.at(-1)?.source.id ?? null) : null };
  }

  public read(ownerUserId: string, id: string): SearchSourceSnapshot | null {
    const row: unknown = this.sqlite
      .prepare(
        `SELECT ${FACT_COLUMNS} FROM search_facts f WHERE f.source_id=? AND f.owner_user_id=?`,
      )
      .get(id, ownerUserId);
    if (row === undefined) return null;
    return this.snapshot(checked(FactRowSchema, row));
  }

  public resolve(access: SearchAccess, ref: SearchSourceRef): SearchSourceSnapshot | null {
    const value = this.readScoped(access, ref.id);
    return value?.source.kind === ref.kind && value.source.contentHash === ref.contentHash
      ? value
      : null;
  }

  public readScoped(access: SearchAccess, id: string): SearchSourceSnapshot | null {
    const permitted = sourcePredicate(access);
    const row: unknown = this.sqlite
      .prepare(
        `SELECT ${FACT_COLUMNS} FROM search_facts f WHERE f.source_id=? AND ${permitted.sql}`,
      )
      .get(id, ...permitted.params);
    if (row === undefined) return null;
    return this.snapshot(checked(FactRowSchema, row), access.scope);
  }

  /** Resolve the requested membership under the original scope, then return only that membership. */
  public resolveTarget(
    access: SearchAccess,
    ref: SearchSourceRef,
    target: SearchSourceTarget,
  ): SearchSourceSnapshot | null {
    if (ref.kind !== target.kind) return null;
    const permitted = sourcePredicate(access);
    let targetSql: string;
    let params: (string | number | null)[];
    let scope = access.scope;
    if (target.kind === 'memory') {
      targetSql = "f.kind='memory' AND f.memory_id=?";
      params = [target.memoryId];
    } else {
      const member = membershipPredicate(scope, 'chosen', 'f.active_branch_id');
      targetSql = `f.kind='message' AND f.session_id=? AND f.message_id=? AND EXISTS(SELECT 1 FROM search_memberships chosen WHERE chosen.source_id=f.source_id AND chosen.branch_id=? AND chosen.task_id IS ? AND ${member.sql})`;
      params = [
        target.sessionId,
        target.messageId,
        target.branchId,
        target.taskId ?? null,
        ...member.params,
      ];
      scope = { ...scope, branchId: target.branchId, includeTasks: target.taskId !== undefined };
      if (target.taskId !== undefined) scope.taskId = target.taskId;
      else delete scope.taskId;
    }
    const row = this.sqlite
      .prepare(
        `SELECT ${FACT_COLUMNS} FROM search_facts f WHERE f.source_id=? AND ${permitted.sql} AND ${targetSql}`,
      )
      .get(ref.id, ...permitted.params, ...params);
    if (row === undefined) return null;
    const value = this.snapshot(checked(FactRowSchema, row), scope);
    return value.source.kind === ref.kind && value.source.contentHash === ref.contentHash
      ? value
      : null;
  }

  /** Indexing hashes all facts; a query hashes only source and member metadata in its legal scope. */
  public watermark(owner: string, access?: SearchAccess): string {
    const hash = createHash('sha256');
    const permitted =
      access === undefined
        ? { sql: 'f.owner_user_id=?', params: [owner] }
        : sourcePredicate(access);
    const member =
      access === undefined
        ? { sql: '1', params: [] }
        : membershipPredicate(access.scope, 'sm', 'f.active_branch_id');
    const selectedBranch = access === undefined ? 'f.active_branch_id' : 'NULL AS active_branch_id';
    for (const row of this.sqlite
      .prepare(
        `SELECT f.source_id,f.kind,f.revision,f.workspace_id,f.session_id,f.status,f.created_at,f.archived,${selectedBranch},length(f.text) AS size
      FROM search_facts f WHERE ${permitted.sql} ORDER BY f.source_id`,
      )
      .iterate(...permitted.params))
      hash.update(JSON.stringify(row)).update('\n');
    for (const row of this.sqlite
      .prepare(
        `SELECT sm.source_id,sm.branch_id,sm.task_id,sm.ordinal FROM search_memberships sm
      JOIN search_facts f ON f.source_id=sm.source_id WHERE ${permitted.sql} AND ${member.sql}
      ORDER BY sm.source_id,sm.branch_id,sm.task_id,sm.ordinal`,
      )
      .iterate(...permitted.params, ...member.params))
      hash.update(JSON.stringify(row)).update('\n');
    return hash.digest('hex');
  }

  private snapshot(row: FactRow, scope?: SearchScope): SearchSourceSnapshot {
    let memberships: SearchSourceMembership[] = [];
    if (row.kind === 'message') {
      const filter =
        scope === undefined
          ? { sql: '1', params: [] }
          : membershipPredicate(
              scope,
              'sm',
              "(SELECT json_extract(data,'$.activeBranchId') FROM sessions WHERE id=?)",
            );
      const params = [...filter.params];
      if (
        scope !== undefined &&
        scope.branchId === undefined &&
        scope.includeHistoricalBranches !== true
      )
        params.unshift(row.sessionId);
      memberships = this.sqlite
        .prepare(
          `SELECT sm.branch_id AS branchId,sm.task_id AS taskId,sm.ordinal FROM search_memberships sm
        WHERE sm.source_id=? AND ${filter.sql} ORDER BY sm.branch_id,sm.task_id,sm.ordinal`,
        )
        .all(row.sourceId, ...params)
        .map((entry) => checked(MembershipSchema, entry));
    }
    return {
      source: {
        id: row.sourceId,
        kind: row.kind,
        contentHash: createHash('sha256').update(row.text).digest('hex'),
      },
      revision: row.revision,
      title: row.title,
      text: row.text,
      workspaceId: row.workspaceId,
      sessionId: row.sessionId,
      messageId: row.messageId,
      memoryId: row.memoryId,
      origin: row.origin,
      status: row.status,
      createdAt: row.createdAt,
      memberships,
    };
  }
}

function membershipPredicate(
  scope: SearchScope,
  alias: string,
  currentBranchSql: string,
): SearchPredicate {
  const params: (string | number | null)[] = [];
  let sql: string;
  if (scope.branchId === undefined)
    sql =
      scope.includeHistoricalBranches === true ? '1' : `${alias}.branch_id = ${currentBranchSql}`;
  else {
    sql = `${alias}.branch_id = ?`;
    params.push(scope.branchId);
  }
  if (scope.taskId !== undefined) {
    sql += ` AND ${alias}.task_id = ?`;
    params.push(scope.taskId);
  } else if (scope.includeTasks !== true) sql += ` AND ${alias}.task_id IS NULL`;
  return { sql, params };
}

function bounded(value: number, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new StorageError(
      'INVALID_RECORD',
      'Persistent search page is outside its allocation limit',
    );
}
