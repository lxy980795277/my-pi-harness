import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { StoredToolIntentSchema, type StoredToolIntent } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { StorageError } from './errors.js';
import { checked } from './validation.js';

const AssistantCallsSchema = Type.Object({
  codecVersion: Type.Literal(1),
  sdkVersion: Type.Literal('1.1.0'),
  message: Type.Object({
    role: Type.Literal('assistant'),
    content: Type.Array(Type.Unknown(), { maxItems: 1024 }),
  }),
});
const TagSchema = Type.Object({ type: Type.String() });

/** Rejected malformed or oversized arguments have no bounded public object representation. */
export function isRetainableToolArguments(value: unknown): value is Record<string, unknown> {
  return (
    Value.Check(Type.Record(Type.String(), Type.Unknown()), value) &&
    JSON.stringify(value).length <= 256_000
  );
}

/** Read only the durable call intent fields; full model codecs remain runtime-owned. */
export function assistantToolIntents(serialized: string): StoredToolIntent[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized);
  } catch (cause) {
    throw new StorageError('INVALID_RECORD', 'Assistant call intents are not valid JSON', {
      cause,
    });
  }
  const envelope = checked(AssistantCallsSchema, decoded);
  const calls: StoredToolIntent[] = [];
  const ids = new Set<string>();
  for (const block of envelope.message.content) {
    const tag = checked(TagSchema, block);
    if (tag.type !== 'toolCall') continue;
    const call = checked(StoredToolIntentSchema, block);
    if (ids.has(call.id))
      throw new StorageError(
        'INVALID_RECORD',
        'Assistant tool call IDs must be unique within one message',
      );
    ids.add(call.id);
    calls.push(call);
  }
  return calls;
}

/** The call identity is scoped to one accepted Run and one persisted assistant anchor. */
export function storedToolCallId(runId: string, anchorId: string, providerCallId: string): string {
  return createHash('sha256')
    .update(JSON.stringify([runId, anchorId, providerCallId]))
    .digest('hex');
}
