import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  HarnessEventSchema,
  QueueInputSchema,
  RunViewSchema,
  type HarnessEvent,
} from '@my-pi-harness/protocol';
import { StorageError } from '../shared/errors.js';
import { assertJson, checked } from '../shared/validation.js';
import * as schema from '../sqlite/schema.js';
import { validateAgentBatch } from './agent-batch.js';
import { InputIdSchema, QueueRequestSchema, RunAcceptedSchema } from './event-validation.js';
import type { ProjectionWriter } from './projections/projector.js';
import { validateToolBatch } from './projections/tool-batch.js';
import type { StoredSessionEvent } from './session-jsonl.js';
import type { EventInput, RequestAcceptance } from './types.js';

/** Validates one durable command and stages its journal records inside the profile transaction. */
export class SessionEventCommit {
  public constructor(
    private readonly db: BetterSQLite3Database<typeof schema>,
    private readonly projector: ProjectionWriter,
    private readonly stage: (record: StoredSessionEvent) => void,
  ) {}

  private duplicate(sessionId: string, inputs: readonly EventInput[]): boolean {
    if (inputs.length === 1 && inputs[0]?.type === 'run.finished') {
      const input = inputs[0];
      if (input.runId !== null) {
        const row = this.db
          .select()
          .from(schema.runs)
          .where(and(eq(schema.runs.id, input.runId), eq(schema.runs.sessionId, sessionId)))
          .get();
        if (row) {
          const run = checked(RunViewSchema, row.data);
          if (
            run.status !== 'running' &&
            run.status === input.data['status'] &&
            run.error === input.data['error']
          )
            return true;
        }
      }
    }
    for (const input of inputs) {
      let requestId: string | undefined;
      let incoming: RequestAcceptance | undefined;
      if (input.type === 'run.accepted') {
        const value = checked(RunAcceptedSchema, input.data);
        const run = value.run;
        requestId = value.requestId;
        incoming = { runId: run.id, inputId: null };
      } else if (input.type === 'queue.added' && input.privateData !== undefined) {
        const value = checked(QueueInputSchema, input.data);
        requestId = checked(QueueRequestSchema, input.privateData).requestId;
        incoming = { runId: null, inputId: value.id };
      }
      if (requestId === undefined || incoming === undefined) continue;
      const previous = this.db
        .select()
        .from(schema.requests)
        .where(
          and(eq(schema.requests.sessionId, sessionId), eq(schema.requests.requestId, requestId)),
        )
        .get();
      if (!previous) continue;
      if (previous.runId !== incoming.runId || previous.inputId !== incoming.inputId)
        throw new StorageError('CONFLICT', 'Request ID has already accepted another input');
      return true;
    }
    return false;
  }

  public append(sessionId: string, inputs: readonly EventInput[]): HarnessEvent[] {
    const current = this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    if (current?.archived) {
      if (inputs.length === 1 && inputs[0]?.type === 'session.deleted') return [];
      throw new StorageError('SESSION_NOT_FOUND', 'Session is archived');
    }
    const session = this.projector.session(sessionId);
    if (this.duplicate(sessionId, inputs)) return [];
    validateAgentBatch(this.db, sessionId, inputs);
    for (const input of inputs) {
      if (input.type !== 'queue.consumed') continue;
      const { inputId } = checked(InputIdSchema, input.data);
      const row = this.db
        .select()
        .from(schema.queue)
        .where(and(eq(schema.queue.id, inputId), eq(schema.queue.sessionId, sessionId)))
        .get();
      if (!row) throw new StorageError('CONFLICT', 'Queued input no longer exists');
      const queued = checked(QueueInputSchema, row.data);
      const message = inputs.find(
        (candidate) =>
          candidate.type === 'message.started' &&
          candidate.runId === input.runId &&
          candidate.data['role'] === 'user' &&
          candidate.data['text'] === queued.text,
      );
      if (!message)
        throw new StorageError(
          'INVALID_EVENT',
          'Queue consumption must atomically commit its user message',
        );
    }
    const accepted: HarnessEvent[] = [];
    for (const [index, input] of inputs.entries()) {
      assertJson(input.data);
      if (input.privateData !== undefined) assertJson(input.privateData);
      const privateData =
        input.privateData === undefined ? undefined : structuredClone(input.privateData);
      const data: unknown = JSON.parse(JSON.stringify(input.data));
      const event = checked(HarnessEventSchema, {
        version: 1,
        eventId: randomUUID(),
        sessionId,
        runId: input.runId,
        seq: session.snapshotSeq + index + 1,
        type: input.type,
        at: input.at,
        data,
      });
      this.projector.apply(event, privateData);
      this.db
        .insert(schema.events)
        .values({
          ...event,
          privateData: event.type === 'context.prepared' ? null : (privateData ?? null),
        })
        .run();
      this.stage({ event, privateData: privateData ?? null });
      accepted.push(event);
    }
    validateToolBatch(inputs);
    return accepted;
  }
}
