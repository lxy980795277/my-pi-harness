import { Type } from 'typebox';
import {
  ToolCallRecordSchema,
  StoredToolResultSchema,
  type ToolCallRecord,
} from '@my-pi-harness/protocol';
import { checked } from './validation.js';
import { StorageError } from './errors.js';

const ToolEventSchema = Type.Object({ tool: ToolCallRecordSchema });
const ContextSchema = Type.Object({ toolCallId: Type.String() });
interface BatchRecord {
  type: string;
  data: Record<string, unknown>;
  privateData?: string | null;
}
export function activeTool(status: ToolCallRecord['status']): boolean {
  return status === 'running' || status === 'reviewing' || status === 'awaiting_approval';
}

/** Terminal public outcomes and their canonical private results form one journal transaction. */
export function validateToolBatch(records: readonly BatchRecord[]): void {
  const terminals = new Set<string>();
  const contexts = new Set<string>();
  for (const record of records) {
    if (record.type === 'tool.updated' || record.type === 'tool.requested') {
      const { tool } = checked(ToolEventSchema, record.data);
      if (!activeTool(tool.status)) {
        if (terminals.has(tool.id))
          throw new StorageError(
            'INVALID_EVENT',
            'A tool can have only one terminal outcome in a batch',
          );
        terminals.add(tool.id);
      }
    }
    if (record.type !== 'tool.context') continue;
    const { toolCallId } = checked(ContextSchema, record.data);
    if (contexts.has(toolCallId))
      throw new StorageError('INVALID_EVENT', 'A tool result cannot be duplicated');
    contexts.add(toolCallId);
    if (record.privateData === undefined || record.privateData === null)
      throw new StorageError('INVALID_EVENT', 'Tool result requires canonical private content');
    let decoded: unknown;
    try {
      decoded = JSON.parse(record.privateData);
    } catch (cause) {
      throw new StorageError('INVALID_RECORD', 'Tool result is invalid JSON', { cause });
    }
    checked(StoredToolResultSchema, decoded);
  }
  for (const id of terminals)
    if (!contexts.has(id))
      throw new StorageError(
        'INVALID_EVENT',
        'Tool terminal outcome and private result must be committed together',
      );
  for (const id of contexts)
    if (!terminals.has(id))
      throw new StorageError(
        'INVALID_EVENT',
        'Tool result requires its terminal outcome in the same batch',
      );
}
