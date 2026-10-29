import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { StorageError } from '../shared/errors.js';
import { checked } from '../shared/validation.js';
import * as schema from '../sqlite/schema.js';
import type { EventInput } from './types.js';
import { TaskMessageConsumedSchema, TaskMessageQueuedSchema } from './event-validation.js';

/** A consumed communication and the exact model-visible input commit in one journal batch. */
export function validateAgentBatch(
  db: BetterSQLite3Database<typeof schema>,
  sessionId: string,
  inputs: readonly EventInput[],
): void {
  for (const input of inputs) {
    if (input.type !== 'task.message_consumed') continue;
    const consumed = checked(TaskMessageConsumedSchema, input.data);
    const queued = inputs.find(
      (candidate) =>
        candidate.type === 'task.message_queued' &&
        candidate.data['message'] !== undefined &&
        checked(TaskMessageQueuedSchema, candidate.data).message.id === consumed.messageId,
    );
    const message =
      queued === undefined
        ? db
            .select()
            .from(schema.agentMessages)
            .where(
              and(
                eq(schema.agentMessages.id, consumed.messageId),
                eq(schema.agentMessages.sessionId, sessionId),
              ),
            )
            .get()?.data
        : checked(TaskMessageQueuedSchema, queued.data).message;
    if (
      message === undefined ||
      inputs.filter(
        (candidate) =>
          candidate.type === 'message.started' &&
          candidate.runId === consumed.consumedRunId &&
          candidate.data['role'] === 'user' &&
          candidate.data['agentMessageId'] === consumed.messageId &&
          candidate.data['text'] === message.text,
      ).length !== 1
    )
      throw new StorageError(
        'INVALID_EVENT',
        'Agent message consumption must commit its exact model input',
      );
  }
  for (const input of inputs) {
    if (input.type !== 'message.started' || input.data['agentMessageId'] === undefined) continue;
    if (
      input.data['role'] !== 'user' ||
      inputs.filter(
        (candidate) =>
          candidate.type === 'task.message_consumed' &&
          candidate.runId === input.runId &&
          checked(TaskMessageConsumedSchema, candidate.data).messageId ===
            input.data['agentMessageId'],
      ).length !== 1
    )
      throw new StorageError(
        'INVALID_EVENT',
        'Agent input requires exactly one matching communication consumption',
      );
  }
}
