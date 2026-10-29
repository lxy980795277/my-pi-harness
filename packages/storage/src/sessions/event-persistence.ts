import { StorageError } from '../shared/errors.js';

/** Streaming deltas are process-local; committed message bodies own durable output. */
export function assertPersistentEvent(type: string): void {
  if (type === 'message.delta')
    throw new StorageError('INVALID_EVENT', 'Message deltas must not enter the session journal');
}
