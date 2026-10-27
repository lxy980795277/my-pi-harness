import { and, asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { MessageViewSchema } from '@my-pi-harness/protocol';
import { StorageError } from '../shared/errors.js';
import { ToolProjection } from './projections/tools.js';
import { checked } from '../shared/validation.js';
import * as schema from '../sqlite/schema.js';

/** Read-only assembly of branch codecs and their atomically committed tool outcomes. */
export class ModelContextQuery {
  private readonly tools: ToolProjection;
  public constructor(private readonly db: BetterSQLite3Database<typeof schema>) {
    this.tools = new ToolProjection(db);
  }
  public read(
    sessionId: string,
    branchId: string,
    messageIds?: readonly string[],
  ): Record<string, unknown>[] {
    const branch = this.db
      .select()
      .from(schema.branches)
      .where(and(eq(schema.branches.id, branchId), eq(schema.branches.sessionId, sessionId)))
      .get();
    if (!branch)
      throw new StorageError('INVALID_RECORD', 'Context branch does not belong to this session');
    const rows = this.db
      .select({ data: schema.messages.data, privateData: schema.messages.privateData })
      .from(schema.branchMessages)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.branchMessages.messageId))
      .where(eq(schema.branchMessages.branchId, branchId))
      .orderBy(asc(schema.branchMessages.ordinal))
      .all()
      .map((row) => ({
        message: checked(MessageViewSchema, row.data),
        privateData: row.privateData,
      }));
    const selected = messageIds === undefined ? undefined : new Set(messageIds);
    const contexts = this.tools.contexts(sessionId);
    if (
      selected !== undefined &&
      rows.filter((row) => selected.has(row.message.id)).length !== selected.size
    )
      throw new StorageError(
        'INVALID_RECORD',
        'Context messages must belong to the selected branch',
      );
    return rows.flatMap((row) => {
      const message = row.message;
      if (selected !== undefined && !selected.has(message.id)) return [];
      const replayable =
        message.status === 'complete' &&
        (message.role === 'user' ||
          message.stopReason === 'stop' ||
          message.stopReason === 'length' ||
          message.stopReason === 'toolUse');
      if (replayable && row.privateData === null)
        throw new StorageError(
          'INVALID_RECORD',
          'Replayable message is missing its provider codec',
        );
      if (!replayable || row.privateData === null) return [];
      const toolContexts = contexts.get(message.id);
      if (toolContexts === undefined) return [row.privateData];
      return [row.privateData, ...toolContexts];
    });
  }
}
