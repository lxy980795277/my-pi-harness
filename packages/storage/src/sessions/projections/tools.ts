import { and, asc, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  MessageViewSchema,
  StoredToolResultSchema,
  RunViewSchema,
  ToolCallRecordSchema,
  ToolCallViewSchema,
  type HarnessEvent,
  type ToolCallView,
} from '@my-pi-harness/protocol';
import { Type } from 'typebox';
import { StorageError } from '../../shared/errors.js';
import * as schema from '../../sqlite/schema.js';
import { checked } from '../../shared/validation.js';
import { activeTool } from './tool-batch.js';
import {
  assistantToolIntents,
  storedToolCallId,
  isRetainableToolArguments,
} from './tool-intents.js';
import { recoverToolEvents } from './tool-recovery.js';
import type { EventInput } from '../types.js';

const ToolEventSchema = Type.Object(
  { tool: ToolCallRecordSchema, afterMessageId: Type.Optional(Type.String()) },
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

  public recovery(sessionId: string, runId: string, at: number): EventInput[] {
    const messages = this.db
      .select({ data: schema.messages.data, privateData: schema.messages.privateData })
      .from(schema.messages)
      .where(eq(schema.messages.sessionId, sessionId))
      .all()
      .map((row) => ({
        message: checked(MessageViewSchema, row.data),
        privateData: row.privateData,
      }))
      .filter(({ message }) => message.runId === runId);
    const tools = this.db
      .select()
      .from(schema.toolCalls)
      .where(and(eq(schema.toolCalls.sessionId, sessionId), eq(schema.toolCalls.runId, runId)))
      .all()
      .map((row) => checked(ToolCallRecordSchema, row.data));
    return recoverToolEvents(messages, tools, at);
  }

  public contexts(sessionId: string): Map<string, Record<string, unknown>[]> {
    const output = new Map<string, Record<string, unknown>[]>();
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
      let previous = output.get(row.anchor);
      if (previous === undefined) {
        previous = [];
        output.set(row.anchor, previous);
      }
      previous.push(row.value);
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
    const { tool, afterMessageId } = checked(ToolEventSchema, event.data);
    const run = this.run(event);
    if (
      tool.sessionId !== event.sessionId ||
      tool.runId !== run.id ||
      tool.branchId !== run.branchId
    )
      throw new StorageError('INVALID_EVENT', 'Tool identity does not match its run');
    const external = tool.binding.kind === 'accepted' && tool.binding.source.kind === 'mcp';
    if (
      (external && tool.dispatch.state === 'not_applicable') ||
      (!external && tool.dispatch.state !== 'not_applicable')
    )
      throw new StorageError(
        'INVALID_EVENT',
        'Tool dispatch tracking must match its frozen source',
      );
    if (
      tool.status === 'unknown' &&
      (tool.dispatch.state !== 'may_have_started' || tool.dispatch.confirmedNotWritten === true)
    )
      throw new StorageError(
        'INVALID_EVENT',
        'Unknown tool outcomes require an unresolved dispatch barrier',
      );
    if (
      external &&
      tool.status === 'completed' &&
      (tool.dispatch.state !== 'may_have_started' || tool.dispatch.confirmedNotWritten === true)
    )
      throw new StorageError(
        'INVALID_EVENT',
        'Completed external tools require a dispatch barrier',
      );
    if (
      tool.binding.kind === 'rejected' &&
      (activeTool(tool.status) || tool.status === 'completed')
    )
      throw new StorageError('INVALID_EVENT', 'Rejected calls cannot enter execution');
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
        JSON.stringify(before.arguments) !== JSON.stringify(tool.arguments) ||
        JSON.stringify(before.binding) !== JSON.stringify(tool.binding)
      )
        throw new StorageError('INVALID_EVENT', 'Tool updates cannot replace its accepted request');
      if (!activeTool(before.status))
        throw new StorageError('CONFLICT', 'Completed tool history cannot be rewritten');
      if (before.dispatch.state === 'may_have_started') {
        if (
          tool.dispatch.state !== 'may_have_started' ||
          tool.dispatch.attemptId !== before.dispatch.attemptId ||
          tool.dispatch.at !== before.dispatch.at ||
          (before.dispatch.confirmedNotWritten === true &&
            tool.dispatch.confirmedNotWritten !== true)
        )
          throw new StorageError(
            'INVALID_EVENT',
            'A tool dispatch barrier cannot be removed or replaced',
          );
      } else if (
        before.dispatch.state === 'not_applicable' &&
        tool.dispatch.state !== 'not_applicable'
      )
        throw new StorageError(
          'INVALID_EVENT',
          'Internal tools cannot gain an external dispatch barrier',
        );
      else if (before.dispatch.state === 'not_started' && tool.dispatch.state === 'not_applicable')
        throw new StorageError('INVALID_EVENT', 'External tools cannot remove dispatch tracking');
      this.db
        .update(schema.toolCalls)
        .set({ data: tool })
        .where(eq(schema.toolCalls.id, tool.id))
        .run();
      return;
    }
    if (previous) throw new StorageError('CONFLICT', 'Tool request already exists');
    if (external && tool.dispatch.state !== 'not_started')
      throw new StorageError(
        'INVALID_EVENT',
        'New external requests must precede their dispatch barrier',
      );
    const recovery =
      afterMessageId !== undefined &&
      tool.binding.kind === 'rejected' &&
      tool.status === 'interrupted';
    if (run.status !== 'running' && !recovery)
      throw new StorageError(
        'CONFLICT',
        'Tool request requires an active run or an interrupted recovery intent',
      );
    const row = this.db
      .select({ data: schema.messages.data, privateData: schema.messages.privateData })
      .from(schema.branchMessages)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.branchMessages.messageId))
      .where(
        and(
          eq(schema.branchMessages.branchId, tool.branchId),
          eq(schema.messages.sessionId, tool.sessionId),
          ...(afterMessageId === undefined ? [] : [eq(schema.messages.id, afterMessageId)]),
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
    if (row.privateData === null)
      throw new StorageError(
        'INVALID_RECORD',
        'Assistant tool calls require their durable intents',
      );
    const intent = assistantToolIntents(row.privateData).find(
      (call) => storedToolCallId(run.id, anchor.id, call.id) === tool.id,
    );
    if (intent === undefined)
      throw new StorageError(
        'INVALID_EVENT',
        'Tool request must match its persisted assistant intent',
      );
    const accepted = tool.binding.kind === 'accepted';
    const expectedName = accepted ? intent.name : intent.name.slice(0, 100);
    const expectedArguments = isRetainableToolArguments(intent.arguments) ? intent.arguments : {};
    if (
      (accepted && !isRetainableToolArguments(intent.arguments)) ||
      expectedName !== tool.name ||
      JSON.stringify(expectedArguments) !== JSON.stringify(tool.arguments)
    )
      throw new StorageError(
        'INVALID_EVENT',
        'Tool request must match its persisted assistant intent',
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

  public context(event: HarnessEvent, privateData: Record<string, unknown> | undefined): void {
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
    const record = checked(ToolCallRecordSchema, tool.data);
    if (activeTool(record.status))
      throw new StorageError('INVALID_EVENT', 'Tool context requires a terminal outcome');
    const result = checked(StoredToolResultSchema, privateData);
    if (
      storedToolCallId(run.id, tool.anchorMessageId, result.providerCallId) !== tool.id ||
      (record.binding.kind === 'accepted'
        ? result.toolName !== record.name
        : result.toolName.slice(0, 100) !== record.name) ||
      result.outcome !== record.status ||
      result.isError !== (record.status !== 'completed')
    )
      throw new StorageError('INVALID_EVENT', 'Tool result does not match its terminal call');
    if (record.binding.kind === 'rejected') {
      const assistant = this.db
        .select({ privateData: schema.messages.privateData })
        .from(schema.messages)
        .where(eq(schema.messages.id, tool.anchorMessageId))
        .get();
      if (
        assistant?.privateData === undefined ||
        assistant.privateData === null ||
        !assistantToolIntents(assistant.privateData).some(
          (intent) => intent.id === result.providerCallId && intent.name === result.toolName,
        )
      )
        throw new StorageError(
          'INVALID_EVENT',
          'Rejected result must retain its full assistant call name',
        );
    }
    const external = record.binding.kind === 'accepted' && record.binding.source.kind === 'mcp';
    if (
      result.origin === 'server' &&
      (!external ||
        record.dispatch.state !== 'may_have_started' ||
        record.dispatch.confirmedNotWritten === true ||
        (record.status !== 'completed' && record.status !== 'failed'))
    )
      throw new StorageError('INVALID_EVENT', 'Server results require a dispatched external call');
    if (external && result.origin === 'tool')
      throw new StorageError('INVALID_EVENT', 'External outcomes require a server or host origin');
    if (external && record.status === 'completed' && result.origin !== 'server')
      throw new StorageError(
        'INVALID_EVENT',
        'Completed external tools require an explicit server result',
      );
    if (
      external &&
      record.dispatch.state === 'may_have_started' &&
      record.dispatch.confirmedNotWritten !== true &&
      record.status !== 'unknown' &&
      result.origin !== 'server'
    )
      throw new StorageError(
        'INVALID_EVENT',
        'Dispatched external tools without a server result must remain unknown',
      );
    if (record.status === 'unknown' && result.origin !== 'host')
      throw new StorageError('INVALID_EVENT', 'Unknown results must be authored by the host');
    if (
      this.db
        .select()
        .from(schema.toolContexts)
        .where(eq(schema.toolContexts.toolCallId, tool.id))
        .get() !== undefined
    )
      throw new StorageError('CONFLICT', 'Tool result is already committed');
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
