import { and, asc, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  MessageViewSchema,
  RunViewSchema,
  ToolCallRecordSchema,
  ToolCallViewSchema,
  type HarnessEvent,
  type ToolCallRecord,
  type ToolCallView,
} from '@my-pi-harness/protocol';
import { Type } from 'typebox';
import { StorageError } from './errors.js';
import * as schema from './schema.js';
import { checked } from './validation.js';

const ToolEventSchema = Type.Object(
  { tool: ToolCallRecordSchema },
  { additionalProperties: false },
);
const ContextEventSchema = Type.Object(
  {
    branchId: Type.String({ minLength: 1, maxLength: 160 }),
    afterMessageId: Type.String({ minLength: 1, maxLength: 160 }),
    toolCallId: Type.String({ minLength: 1, maxLength: 160 }),
  },
  { additionalProperties: false },
);

function active(status: ToolCallRecord['status']): boolean {
  return status === 'running' || status === 'awaiting_approval';
}

/** Tool cards and private results are projected within their session event transaction. */
export class ToolProjection {
  public constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

  public list(sessionId: string, branchId: string): ToolCallView[] {
    const requestedSeqs = new Map(
      this.db
        .select({ seq: schema.events.seq, data: schema.events.data })
        .from(schema.events)
        .where(
          and(eq(schema.events.sessionId, sessionId), eq(schema.events.type, 'tool.requested')),
        )
        .all()
        .map((row) => [checked(ToolEventSchema, row.data).tool.id, row.seq]),
    );
    return this.db
      .select({
        data: schema.toolCalls.data,
        ordinal: schema.branchMessages.ordinal,
        anchor: schema.toolCalls.anchorMessageId,
      })
      .from(schema.toolCalls)
      .innerJoin(
        schema.branchMessages,
        eq(schema.branchMessages.messageId, schema.toolCalls.anchorMessageId),
      )
      .where(
        and(
          eq(schema.toolCalls.sessionId, sessionId),
          eq(schema.branchMessages.branchId, branchId),
        ),
      )
      .all()
      .map((row) => {
        const record = checked(ToolCallRecordSchema, row.data);
        const tool = checked(ToolCallViewSchema, { ...record, afterMessageId: row.anchor });
        const seq = requestedSeqs.get(tool.id);
        if (seq === undefined)
          throw new StorageError('INVALID_RECORD', 'Tool projection is missing its request event');
        return { tool, ordinal: row.ordinal, seq };
      })
      .sort((left, right) => left.ordinal - right.ordinal || left.seq - right.seq)
      .map((row) => row.tool);
  }

  public unfinished(sessionId: string, runId: string): ToolCallRecord[] {
    return this.db
      .select()
      .from(schema.toolCalls)
      .where(and(eq(schema.toolCalls.sessionId, sessionId), eq(schema.toolCalls.runId, runId)))
      .all()
      .map((row) => checked(ToolCallRecordSchema, row.data))
      .filter((tool) => active(tool.status));
  }

  public contexts(sessionId: string): Map<string, string[]> {
    const output = new Map<string, string[]>();
    const rows = this.db
      .select({
        value: schema.toolContexts.privateData,
        anchor: schema.toolContexts.afterMessageId,
      })
      .from(schema.toolContexts)
      .where(eq(schema.toolContexts.sessionId, sessionId))
      .orderBy(asc(schema.toolContexts.seq))
      .all();
    for (const row of rows) {
      const previous = output.get(row.anchor) ?? [];
      previous.push(row.value);
      output.set(row.anchor, previous);
    }
    return output;
  }

  private run(event: HarnessEvent): ReturnType<typeof checked<typeof RunViewSchema>> {
    if (event.runId === null) throw new StorageError('INVALID_EVENT', 'Tool event requires a run');
    const row = this.db.select().from(schema.runs).where(eq(schema.runs.id, event.runId)).get();
    if (!row || row.sessionId !== event.sessionId)
      throw new StorageError('INVALID_EVENT', 'Tool run does not belong to the session');
    return checked(RunViewSchema, row.data);
  }

  public apply(event: HarnessEvent): void {
    const { tool } = checked(ToolEventSchema, event.data);
    const run = this.run(event);
    if (
      tool.sessionId !== event.sessionId ||
      tool.runId !== run.id ||
      tool.branchId !== run.branchId
    )
      throw new StorageError('INVALID_EVENT', 'Tool identity does not match its run');
    const previous = this.db
      .select()
      .from(schema.toolCalls)
      .where(eq(schema.toolCalls.id, tool.id))
      .get();
    if (event.type === 'tool.updated') {
      if (!previous)
        throw new StorageError('INVALID_EVENT', 'Tool update requires a requested tool');
      const before = checked(ToolCallRecordSchema, previous.data);
      if (
        before.sessionId !== tool.sessionId ||
        before.runId !== tool.runId ||
        before.branchId !== tool.branchId ||
        before.name !== tool.name ||
        before.createdAt !== tool.createdAt ||
        JSON.stringify(before.arguments) !== JSON.stringify(tool.arguments)
      )
        throw new StorageError('INVALID_EVENT', 'Tool updates cannot replace its accepted request');
      if (!active(before.status))
        throw new StorageError('CONFLICT', 'Completed tool history cannot be rewritten');
      this.db
        .update(schema.toolCalls)
        .set({ data: tool })
        .where(eq(schema.toolCalls.id, tool.id))
        .run();
      return;
    }
    if (previous) throw new StorageError('CONFLICT', 'Tool request already exists');
    if (run.status !== 'running')
      throw new StorageError('CONFLICT', 'Tool request requires an active run');
    const row = this.db
      .select({ data: schema.messages.data })
      .from(schema.branchMessages)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.branchMessages.messageId))
      .where(
        and(
          eq(schema.branchMessages.branchId, tool.branchId),
          eq(schema.messages.sessionId, tool.sessionId),
        ),
      )
      .orderBy(desc(schema.branchMessages.ordinal))
      .limit(1)
      .get();
    if (!row)
      throw new StorageError('INVALID_EVENT', 'Tool request requires its assistant message');
    const anchor = checked(MessageViewSchema, row.data);
    if (
      anchor.role !== 'assistant' ||
      anchor.runId !== run.id ||
      anchor.status !== 'complete' ||
      (anchor.stopReason !== 'toolUse' && anchor.stopReason !== 'length')
    )
      throw new StorageError(
        'INVALID_EVENT',
        'Tool request must follow a completed tool-use assistant',
      );
    this.db
      .insert(schema.toolCalls)
      .values({
        id: tool.id,
        sessionId: tool.sessionId,
        branchId: tool.branchId,
        runId: tool.runId,
        anchorMessageId: anchor.id,
        data: tool,
      })
      .run();
  }

  public context(event: HarnessEvent, privateData: string | undefined): void {
    const input = checked(ContextEventSchema, event.data);
    const run = this.run(event);
    const tool = this.db
      .select()
      .from(schema.toolCalls)
      .where(eq(schema.toolCalls.id, input.toolCallId))
      .get();
    if (
      privateData === undefined ||
      tool === undefined ||
      tool.sessionId !== event.sessionId ||
      tool.runId !== run.id ||
      tool.branchId !== input.branchId ||
      run.branchId !== input.branchId ||
      tool.anchorMessageId !== input.afterMessageId
    )
      throw new StorageError(
        'INVALID_EVENT',
        'Tool context requires its accepted call and assistant anchor',
      );
    this.db
      .insert(schema.toolContexts)
      .values({
        toolCallId: input.toolCallId,
        sessionId: event.sessionId,
        runId: run.id,
        afterMessageId: input.afterMessageId,
        seq: event.seq,
        privateData,
      })
      .run();
  }
}
