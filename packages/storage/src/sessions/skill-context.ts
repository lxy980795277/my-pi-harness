import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { Type } from 'typebox';
import { FrozenSkillSchema, MessageViewSchema, type FrozenSkill } from '@my-pi-harness/protocol';
import { StorageError } from '../shared/errors.js';
import { checked } from '../shared/validation.js';
import * as schema from '../sqlite/schema.js';

const Anchor = Type.Pick(MessageViewSchema, ['id', 'role', 'status', 'stopReason']);
const Payload = Type.Object({
  skills: Type.Optional(Type.Array(FrozenSkillSchema, { maxItems: 16 })),
});

function instructions(data: string | null): readonly FrozenSkill[] {
  if (data === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch (cause) {
    throw new StorageError('INVALID_RECORD', 'Skill activation is not valid JSON', { cause });
  }
  return checked(Payload, value).skills ?? [];
}

/** Private activation facts follow visible message anchors, including inherited branch prefixes. */
export class SkillContextQuery {
  public constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

  private *events(sessionId: string) {
    let cursor = 0;
    while (true) {
      const batch = this.db
        .select({
          seq: schema.events.seq,
          type: schema.events.type,
          runId: schema.events.runId,
          messageId: sql<unknown>`CASE WHEN ${schema.events.type} = 'message.started' THEN json_extract(${schema.events.data}, '$.id') END`,
          role: sql<unknown>`CASE WHEN ${schema.events.type} = 'message.started' THEN json_extract(${schema.events.data}, '$.role') END`,
          privateData: sql<string | null>`CASE
          WHEN ${schema.events.type} = 'message.started' OR ${schema.events.privateData} IS NULL THEN NULL
          WHEN json_valid(${schema.events.privateData}) THEN
            CASE WHEN json_type(${schema.events.privateData}) != 'object' THEN ${schema.events.privateData}
            WHEN json_type(${schema.events.privateData}, '$.skills') IS NULL THEN '{}'
            ELSE json_object('skills', json_extract(${schema.events.privateData}, '$.skills')) END
          ELSE ${schema.events.privateData} END`,
        })
        .from(schema.events)
        .where(
          and(
            eq(schema.events.sessionId, sessionId),
            gt(schema.events.seq, cursor),
            inArray(schema.events.type, ['run.accepted', 'run.tools_loaded', 'message.started']),
          ),
        )
        .orderBy(asc(schema.events.seq))
        .limit(16)
        .all();
      for (const event of batch) {
        cursor = event.seq;
        yield event;
      }
      if (batch.length < 16) return;
    }
  }

  public read(
    sessionId: string,
    branchId: string,
    messageIds?: readonly string[],
  ): readonly FrozenSkill[] {
    const branch = this.db
      .select()
      .from(schema.branches)
      .innerJoin(schema.sessions, eq(schema.sessions.id, schema.branches.sessionId))
      .where(
        and(
          eq(schema.branches.id, branchId),
          eq(schema.branches.sessionId, sessionId),
          eq(schema.sessions.archived, false),
        ),
      )
      .get();
    if (branch === undefined)
      throw new StorageError(
        'INVALID_RECORD',
        'Skill context branch does not belong to an active session',
      );
    const rows = this.db
      .select({
        id: schema.messages.id,
        role: sql<unknown>`json_extract(${schema.messages.data}, '$.role')`,
        status: sql<unknown>`json_extract(${schema.messages.data}, '$.status')`,
        stopReason: sql<unknown>`json_extract(${schema.messages.data}, '$.stopReason')`,
      })
      .from(schema.branchMessages)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.branchMessages.messageId))
      .where(eq(schema.branchMessages.branchId, branchId))
      .orderBy(asc(schema.branchMessages.ordinal))
      .all()
      .map((row) => checked(Anchor, row));
    const selected =
      messageIds === undefined ? new Set(rows.map((row) => row.id)) : new Set(messageIds);
    if (rows.filter((row) => selected.has(row.id)).length !== selected.size)
      throw new StorageError(
        'INVALID_RECORD',
        'Skill context messages must belong to the selected branch',
      );
    const visible = new Set(
      rows
        .filter(
          (row) =>
            selected.has(row.id) &&
            row.status === 'complete' &&
            (row.role === 'user' ||
              row.stopReason === 'stop' ||
              row.stopReason === 'length' ||
              row.stopReason === 'toolUse'),
        )
        .map((row) => row.id),
    );
    const events = this.events(sessionId);
    let accepted: { runId: string; data: string | null } | undefined;
    let anchor: string | undefined;
    const activated = new Map<string, FrozenSkill>();
    const activate = (data: string | null): void => {
      for (const skill of instructions(data)) {
        activated.delete(skill.selection.id);
        activated.set(skill.selection.id, skill);
        if (activated.size > 16) {
          const first = activated.keys().next().value;
          if (first !== undefined) activated.delete(first);
        }
      }
    };
    for (const event of events) {
      if (event.runId === null) continue;
      if (event.type === 'run.accepted') {
        accepted = { runId: event.runId, data: event.privateData };
        anchor = undefined;
      }
      if (event.runId !== accepted?.runId) continue;
      if (event.type === 'message.started') {
        if (typeof event.messageId !== 'string')
          throw new StorageError(
            'INVALID_RECORD',
            'Skill activation is missing its message anchor',
          );
        anchor = event.messageId;
        if (event.role === 'user' && visible.has(anchor)) activate(accepted.data);
      }
      if (event.type === 'run.tools_loaded' && anchor !== undefined && visible.has(anchor))
        activate(event.privateData);
    }
    return [...activated.values()];
  }
}
