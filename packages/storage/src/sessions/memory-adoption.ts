import type { MemoryRequestSnapshot } from '@my-pi-harness/protocol/internal';
import { decodeMemoryBlock } from '@my-pi-harness/memory/snapshot';
import { StorageError } from '../shared/errors';
import type { PreparedPrivateContext } from './event-validation';

/** Restore adopted bodies from the final recorded prompt, independently of current memory facts. */
export function preparedMemory(context: PreparedPrivateContext): MemoryRequestSnapshot | null {
  if (!context.memoryRange) return null;
  const leading = context.messages[0]?.['message'];
  if (
    leading === null ||
    typeof leading !== 'object' ||
    Array.isArray(leading) ||
    !('role' in leading) ||
    leading.role !== 'system' ||
    !('content' in leading) ||
    leading.content !== context.systemPrompt
  )
    throw new StorageError(
      'INVALID_RECORD',
      'Adopted memory must match the actual leading system message',
    );
  try {
    return decodeMemoryBlock(context.systemPrompt, context.memoryRange);
  } catch (cause) {
    throw new StorageError('INVALID_RECORD', 'Prepared memory range or snapshot is invalid', {
      cause,
    });
  }
}
