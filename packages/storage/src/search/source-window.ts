import type Database from 'better-sqlite3';
import { Type, type Static } from 'typebox';
import type {
  SearchSourceSelection,
  SearchSourceReadInput,
  SearchSourceExcerpt,
  SearchSourceWindow,
  SearchSourceTarget,
  SearchWindowCursor,
} from '@my-pi-harness/protocol';
import type { SearchAccess, SearchSourceSnapshot } from '@my-pi-harness/protocol/internal';
import { checked } from '../shared/validation';
import { StorageError } from '../shared/errors';
import { sourcePredicate, type PersistentSearchSources } from './sources';

type Member = Static<typeof MemberSchema>;

const MemberSchema = Type.Object({
  sourceId: Type.String(),
  messageId: Type.String(),
  ordinal: Type.Integer({ minimum: 0 }),
});
const MetadataSchema = Type.Object({
  archived: Type.Integer({ minimum: 0, maximum: 1 }),
  active: Type.Union([Type.String(), Type.Null()]),
});
const RoleSchema = Type.Object({
  role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
});
const MAX_EXCERPT = 8000;
const NEIGHBOR_EXCERPT = 2000;

/** Resolve bounded persistent text windows; callers retain the original human/model scope policy. */
export class PersistentSourceReader {
  public constructor(
    private readonly sqlite: Database.Database,
    private readonly sources: PersistentSearchSources,
  ) {}

  public readSelection(
    access: SearchAccess,
    selection: SearchSourceSelection,
  ): SearchSourceExcerpt | null {
    const source = this.resolve(access, selection);
    return source === null
      ? null
      : this.excerpt(source, selection.target, selection.start, selection.end);
  }

  public window(access: SearchAccess, input: SearchSourceReadInput): SearchSourceWindow | null {
    const { selection } = input;
    if (input.cursor !== undefined && input.textOffset !== undefined) return null;
    const source = this.resolve(access, selection);
    if (source === null) return null;
    const before = input.before ?? 2;
    const after = input.after ?? 2;
    bounded(before, 0, 4);
    bounded(after, 0, 4);
    const metadata = checked(
      MetadataSchema,
      this.sqlite
        .prepare(
          'SELECT archived,active_branch_id AS active FROM search_facts WHERE source_id=? AND owner_user_id=?',
        )
        .get(source.source.id, access.ownerUserId),
    );
    const window: SearchSourceWindow = {
      selection,
      title: source.title.slice(0, 500),
      workspaceId: source.workspaceId,
      archived: metadata.archived === 1,
      historicalBranch:
        selection.target.kind === 'message' && selection.target.branchId !== metadata.active,
      items: [],
      previous: null,
      next: null,
    };
    if (input.textOffset !== undefined) {
      const offset = input.textOffset;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.text.length) return null;
      let start = offset;
      if (!boundary(source.text, start)) start -= 1;
      let end = Math.min(source.text.length, start + MAX_EXCERPT);
      if (!boundary(source.text, end)) end -= 1;
      window.items = [this.excerpt(source, selection.target, start, end)];
      return window;
    }
    if (selection.target.kind === 'memory') {
      if (input.cursor !== undefined) return null;
      window.items = [this.around(source, selection.target, selection)];
      return window;
    }
    const target = selection.target;
    const member = source.memberships.find(
      (item) => item.branchId === target.branchId && item.taskId === (target.taskId ?? null),
    );
    if (member === undefined) return null;
    const narrow: SearchAccess = {
      ...access,
      scope: {
        ...access.scope,
        branchId: target.branchId,
        includeTasks: target.taskId !== undefined,
      },
    };
    if (target.taskId !== undefined) narrow.scope.taskId = target.taskId;
    else delete narrow.scope.taskId;
    let members: Member[];
    if (input.cursor === undefined) {
      const left = this.members(narrow, target, 'before', member.ordinal, before).reverse();
      const right = this.members(narrow, target, 'after', member.ordinal, after);
      members = [
        ...left,
        { sourceId: source.source.id, messageId: target.messageId, ordinal: member.ordinal },
        ...right,
      ];
    } else {
      const cursor = this.cursorMember(narrow, target, input.cursor.messageId);
      if (cursor === null) return null;
      members = this.members(
        narrow,
        target,
        input.cursor.direction,
        cursor.ordinal,
        before + after + 1,
      );
      if (input.cursor.direction === 'before') members.reverse();
    }
    for (const item of members) {
      const value =
        item.sourceId === source.source.id
          ? source
          : this.sources.readScoped(narrow, item.sourceId);
      if (value === null) return null;
      const location: SearchSourceTarget = { ...target, messageId: item.messageId };
      window.items.push(
        this.around(value, location, item.sourceId === source.source.id ? selection : undefined),
      );
    }
    const first = members.at(0);
    const last = members.at(-1);
    if (first && this.members(narrow, target, 'before', first.ordinal, 1).length > 0)
      window.previous = { direction: 'before', messageId: first.messageId };
    if (last && this.members(narrow, target, 'after', last.ordinal, 1).length > 0)
      window.next = { direction: 'after', messageId: last.messageId };
    return window;
  }

  private resolve(
    access: SearchAccess,
    selection: SearchSourceSelection,
  ): SearchSourceSnapshot | null {
    const value = this.sources.resolveTarget(access, selection.source, selection.target);
    if (value === null || !validRange(value.text, selection.start, selection.end)) return null;
    return value;
  }

  private excerpt(
    source: SearchSourceSnapshot,
    target: SearchSourceTarget,
    start: number,
    end: number,
  ): SearchSourceExcerpt {
    const result: SearchSourceExcerpt = {
      source: source.source,
      target,
      start,
      end,
      text: source.text.slice(start, end),
      totalLength: source.text.length,
      origin: source.origin,
      status: source.status,
      createdAt: source.createdAt,
    };
    if (source.messageId !== null) {
      const row = this.sqlite
        .prepare(
          "SELECT json_extract(data,'$.role') AS role FROM messages WHERE id=? AND session_id=?",
        )
        .get(source.messageId, source.sessionId);
      result.role = checked(RoleSchema, row).role;
    }
    return result;
  }

  private around(
    source: SearchSourceSnapshot,
    target: SearchSourceTarget,
    selection?: SearchSourceSelection,
  ): SearchSourceExcerpt {
    let start = selection === undefined ? 0 : Math.max(0, selection.start - 500);
    let end = Math.min(
      source.text.length,
      selection === undefined ? NEIGHBOR_EXCERPT : Math.max(selection.end, start + 4000),
    );
    if (end - start > MAX_EXCERPT) start = end - MAX_EXCERPT;
    if (!boundary(source.text, start)) start += 1;
    if (!boundary(source.text, end)) end -= 1;
    return this.excerpt(source, target, start, end);
  }

  private cursorMember(
    access: SearchAccess,
    target: Extract<SearchSourceTarget, { kind: 'message' }>,
    messageId: string,
  ): Member | null {
    const filter = sourcePredicate(access);
    const row = this.sqlite
      .prepare(
        `SELECT f.source_id AS sourceId,f.message_id AS messageId,sm.ordinal FROM search_facts f JOIN search_memberships sm ON sm.source_id=f.source_id
      WHERE ${filter.sql} AND f.kind='message' AND f.session_id=? AND f.message_id=? AND sm.branch_id=? AND sm.task_id IS ?`,
      )
      .get(...filter.params, target.sessionId, messageId, target.branchId, target.taskId ?? null);
    return row === undefined ? null : checked(MemberSchema, row);
  }

  private members(
    access: SearchAccess,
    target: Extract<SearchSourceTarget, { kind: 'message' }>,
    direction: SearchWindowCursor['direction'],
    ordinal: number,
    limit: number,
  ): Member[] {
    if (limit === 0) return [];
    const filter = sourcePredicate(access);
    const comparison = direction === 'before' ? '<' : '>';
    const order = direction === 'before' ? 'DESC' : 'ASC';
    return this.sqlite
      .prepare(
        `SELECT f.source_id AS sourceId,f.message_id AS messageId,sm.ordinal FROM search_facts f JOIN search_memberships sm ON sm.source_id=f.source_id
      WHERE ${filter.sql} AND f.kind='message' AND f.session_id=? AND sm.branch_id=? AND sm.task_id IS ? AND sm.ordinal ${comparison} ? ORDER BY sm.ordinal ${order} LIMIT ?`,
      )
      .all(
        ...filter.params,
        target.sessionId,
        target.branchId,
        target.taskId ?? null,
        ordinal,
        limit,
      )
      .map((row) => checked(MemberSchema, row));
  }
}

function validRange(text: string, start: number, end: number): boolean {
  return (
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    end > start &&
    end <= text.length &&
    end - start <= MAX_EXCERPT &&
    boundary(text, start) &&
    boundary(text, end)
  );
}
function boundary(text: string, offset: number): boolean {
  if (offset === 0 || offset === text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}
function bounded(value: number, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new StorageError('INVALID_RECORD', 'Source window exceeds its allocation limit');
}
