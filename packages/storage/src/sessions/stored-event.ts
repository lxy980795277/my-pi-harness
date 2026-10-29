import { HarnessEventSchema, type HarnessEvent } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { checked } from '../shared/validation.js';
import { EVENT_DATA_SCHEMAS } from './event-validation.js';
import { assertPersistentEvent } from './event-persistence.js';

/**
 * Select current public fields on a codec-owned clone, without defaults or type conversion.
 * @param event A decoded event detached from the parsed disk record and private codec baselines.
 * @returns The projected envelope; payload requirements and relationships remain projection-owned.
 */
export function projectStoredEvent(event: HarnessEvent): HarnessEvent {
  assertPersistentEvent(event.type);
  Value.Clean(HarnessEventSchema, event);
  const schema = EVENT_DATA_SCHEMAS.get(event.type);
  if (schema !== undefined)
    event.data = checked(HarnessEventSchema.properties.data, Value.Clean(schema, event.data));
  return event;
}
