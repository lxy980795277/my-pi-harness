import type { Message } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { RuntimeError } from './errors.js';

const text = Type.Object({
  type: Type.Literal('text'),
  text: Type.String(),
  textSignature: Type.Optional(Type.String()),
});
const image = Type.Object({
  type: Type.Literal('image'),
  data: Type.String(),
  mimeType: Type.String(),
});
const thinking = Type.Object({
  type: Type.Literal('thinking'),
  thinking: Type.String(),
  thinkingSignature: Type.Optional(Type.String()),
  redacted: Type.Optional(Type.Boolean()),
});
const toolCall = Type.Object({
  type: Type.Literal('toolCall'),
  id: Type.String(),
  name: Type.String(),
  arguments: Type.Record(Type.String(), Type.Unknown()),
  thoughtSignature: Type.Optional(Type.String()),
  namespace: Type.Optional(Type.String()),
});
const usage = Type.Object({
  input: Type.Number(),
  output: Type.Number(),
  cacheRead: Type.Number(),
  cacheWrite: Type.Number(),
  totalTokens: Type.Number(),
  reasoning: Type.Optional(Type.Number()),
  cacheWrite1h: Type.Optional(Type.Number()),
  cost: Type.Object({
    input: Type.Number(),
    output: Type.Number(),
    cacheRead: Type.Number(),
    cacheWrite: Type.Number(),
    total: Type.Number(),
  }),
});
const message = Type.Union([
  Type.Object({
    role: Type.Literal('system'),
    content: Type.Union([Type.String(), Type.Array(text)]),
    timestamp: Type.Number(),
    sections: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()]))),
    toolsAdded: Type.Optional(
      Type.Array(
        Type.Object({
          name: Type.String(),
          description: Type.String(),
          parameters: Type.Record(Type.String(), Type.Unknown()),
        }),
      ),
    ),
    toolsRemoved: Type.Optional(Type.Array(Type.Object({ name: Type.String() }))),
  }),
  Type.Object({
    role: Type.Literal('user'),
    content: Type.Union([Type.String(), Type.Array(Type.Union([text, image]))]),
    timestamp: Type.Number(),
  }),
  Type.Object({
    role: Type.Literal('assistant'),
    content: Type.Array(Type.Union([text, thinking, toolCall])),
    api: Type.String(),
    provider: Type.String(),
    model: Type.String(),
    usage,
    timestamp: Type.Number(),
    stopReason: Type.Union(
      ['pending', 'stop', 'length', 'toolUse', 'error', 'aborted', 'deferred'].map((value) =>
        Type.Literal(value),
      ),
    ),
    responseId: Type.Optional(Type.String()),
    responseModel: Type.Optional(Type.String()),
    providerThinkingLevel: Type.Optional(Type.String()),
    errorMessage: Type.Optional(Type.String()),
    durationMs: Type.Optional(Type.Number()),
  }),
]);
const toolResult = Type.Object({
  role: Type.Literal('toolResult'),
  toolCallId: Type.String(),
  toolName: Type.String(),
  content: Type.Array(Type.Union([text, image])),
  isError: Type.Boolean(),
  timestamp: Type.Number(),
  details: Type.Optional(Type.Unknown()),
  structuredContent: Type.Optional(Type.Unknown()),
  usage: Type.Optional(usage),
});
const envelope = Type.Object({
  codecVersion: Type.Literal(1),
  sdkVersion: Type.Literal('1.1.0'),
  message: Type.Union([message, toolResult]),
});

/** Preserve final provider-native fields privately; this is not a client DTO. */
export function encodeContextMessage(input: Message): string {
  const serialized = JSON.stringify({ codecVersion: 1, sdkVersion: '1.1.0', message: input });
  decodeContextMessage(serialized);
  return serialized;
}

/** Read a supported durable generation without falling back to another format. */
export function decodeContextMessage(serialized: string): Message {
  let input: unknown;
  try {
    input = JSON.parse(serialized);
  } catch (cause) {
    throw new RuntimeError('CONTEXT_CORRUPT', 'Stored model context is not valid JSON', { cause });
  }
  if (!Value.Check(envelope, input)) {
    throw new RuntimeError('CONTEXT_CORRUPT', 'Stored model context has an unsupported format');
  }
  // JSON.parse guarantees JSON-only tool arguments; schema validates SDK-required fields.
  return input.message as Message;
}
