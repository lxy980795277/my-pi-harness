import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  LiveMessageDeltaSchema,
  MessageViewSchema,
  type HarnessEvent,
  type LiveMessageDelta,
  type MessageView,
} from '@my-pi-harness/protocol';
import { StorageError } from '../shared/errors.js';
import { checked } from '../shared/validation.js';
import * as schema from '../sqlite/schema.js';

interface MessageText {
  runId: string;
  text: string;
  thinking: string;
}

interface SessionLiveMessages {
  revision: number;
  messages: Map<string, MessageText>;
}

/** Process-local message bodies never enter SQLite or model replay history. */
export class LiveMessages {
  private readonly sessions = new Map<string, SessionLiveMessages>();

  public constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

  public publish(sessionId: string, input: LiveMessageDelta): void {
    const delta = checked(LiveMessageDeltaSchema, input);
    const session = this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    if (!session || session.archived)
      throw new StorageError('SESSION_NOT_FOUND', 'Session does not exist or is archived');
    const run = this.db
      .select()
      .from(schema.runs)
      .where(and(eq(schema.runs.id, delta.runId), eq(schema.runs.sessionId, sessionId)))
      .get();
    const row = this.db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.id, delta.messageId), eq(schema.messages.sessionId, sessionId)))
      .get();
    if (
      !run ||
      run.data.status !== 'running' ||
      !row ||
      row.data.runId !== run.id ||
      row.data.branchId !== session.data.activeBranchId ||
      row.data.role !== 'assistant' ||
      row.data.status !== 'streaming'
    )
      throw new StorageError('CONFLICT', 'Message no longer accepts stream deltas');
    const state: SessionLiveMessages = this.sessions.get(sessionId) ?? {
      revision: 0,
      messages: new Map(),
    };
    const previous = state.messages.get(delta.messageId) ?? row.data;
    const message = checked(MessageViewSchema, {
      ...row.data,
      text: previous.text + (delta.text ?? ''),
      thinking: previous.thinking + (delta.thinking ?? ''),
    });
    state.messages.set(message.id, {
      runId: run.id,
      text: message.text,
      thinking: message.thinking,
    });
    state.revision += 1;
    this.sessions.set(sessionId, state);
  }

  public revision(sessionId: string): number {
    return this.sessions.get(sessionId)?.revision ?? 0;
  }

  public merge(sessionId: string, messages: readonly MessageView[]): MessageView[] {
    const state = this.sessions.get(sessionId);
    return messages.map((message) => {
      const partial = state?.messages.get(message.id);
      return partial && message.status === 'streaming'
        ? { ...message, text: partial.text, thinking: partial.thinking }
        : message;
    });
  }

  /** Publish cleanup only after the journal and SQLite transaction both commit. */
  public committed(events: readonly HarnessEvent[]): void {
    for (const event of events) {
      const state = this.sessions.get(event.sessionId);
      if (!state) continue;
      if (event.type === 'session.deleted') {
        this.sessions.delete(event.sessionId);
        continue;
      }
      if (event.type === 'message.completed') {
        const message = checked(MessageViewSchema, event.data['message']);
        state.messages.delete(message.id);
      }
      if (event.type === 'run.finished')
        for (const [id, message] of state.messages)
          if (message.runId === event.runId) state.messages.delete(id);
      state.revision = 0;
      if (state.messages.size === 0) this.sessions.delete(event.sessionId);
    }
  }

  public clear(): void {
    this.sessions.clear();
  }
}
