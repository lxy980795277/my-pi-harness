import {
  ToolCallRecordSchema,
  type MessageView,
  type ToolCallRecord,
  type StoredToolResult,
} from '@my-pi-harness/protocol';
import type { EventInput } from '../types.js';
import {
  assistantToolIntents,
  storedToolCallId,
  isRetainableToolArguments,
} from './tool-intents.js';
import { activeTool } from './tool-batch.js';
import { checked } from '../../shared/validation.js';
import { StorageError } from '../../shared/errors.js';

export interface RecoveryAssistant {
  message: MessageView;
  privateData: Record<string, unknown> | null;
}

/** Pairs every durable assistant call without opening a Server or replaying a side effect. */
export function recoverToolEvents(
  messages: readonly RecoveryAssistant[],
  tools: readonly ToolCallRecord[],
  at: number,
): EventInput[] {
  const output: EventInput[] = [];
  const existing = new Map(tools.map((tool) => [tool.id, tool]));
  const paired = new Set<string>();
  for (const { message, privateData } of messages) {
    if (
      message.role !== 'assistant' ||
      message.status !== 'complete' ||
      (message.stopReason !== 'toolUse' && message.stopReason !== 'length')
    )
      continue;
    if (privateData === null)
      throw new StorageError('INVALID_RECORD', 'Durable assistant call intents are missing');
    if (message.runId === null)
      throw new StorageError('INVALID_RECORD', 'Assistant tool calls require a Run');
    for (const intent of assistantToolIntents(privateData)) {
      const id = storedToolCallId(message.runId, message.id, intent.id);
      paired.add(id);
      const before = existing.get(id);
      if (before !== undefined && !activeTool(before.status)) continue;
      const unknown =
        before?.dispatch.state === 'may_have_started' &&
        before.dispatch.confirmedNotWritten !== true;
      const status = unknown ? 'unknown' : 'interrupted';
      const explanation = unknown
        ? 'Host recovery: tool result is unknown. The operation may have taken effect; verify its outcome before a new request.'
        : 'Host recovery: daemon stopped before the tool completed. This call was not replayed.';
      const record = checked(
        ToolCallRecordSchema,
        before === undefined
          ? {
              id,
              sessionId: message.sessionId,
              runId: message.runId,
              branchId: message.branchId,
              name: intent.name.slice(0, 100),
              arguments: isRetainableToolArguments(intent.arguments) ? intent.arguments : {},
              binding: {
                kind: 'rejected',
                reason: 'Daemon stopped before accepting the tool call',
              },
              dispatch: { state: 'not_applicable' },
              status,
              summary: explanation,
              result: explanation,
              diff: null,
              createdAt: at,
              updatedAt: at,
            }
          : { ...before, status, summary: explanation, result: explanation, updatedAt: at },
      );
      output.push({
        type: before === undefined ? 'tool.requested' : 'tool.updated',
        runId: message.runId,
        at,
        data: { tool: record, ...(before === undefined ? { afterMessageId: message.id } : {}) },
      });
      const result: StoredToolResult = {
        toolResultVersion: 1,
        providerCallId: intent.id,
        toolName: intent.name,
        content: [{ type: 'text', text: explanation }],
        isError: true,
        at,
        origin: 'host',
        outcome: status,
      };
      output.push({
        type: 'tool.context',
        runId: message.runId,
        at,
        data: { branchId: message.branchId, afterMessageId: message.id, toolCallId: id },
        privateData: result,
      });
    }
  }
  if (tools.some((tool) => activeTool(tool.status) && !paired.has(tool.id)))
    throw new StorageError(
      'INVALID_RECORD',
      'An unfinished tool has no matching durable assistant intent',
    );
  return output;
}
