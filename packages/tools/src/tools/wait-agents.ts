import { Type, type Static } from 'typebox';

import { completeToolRegistration, strictObjectSchema } from '../lib/tool-registry.js';
import { textResult } from '../lib/tool-result.js';

import { requireAgentHandlers } from '../lib/tool-context.js';

export type WaitAgentsInput = Static<typeof WaitAgentsParameters>;
export type WaitAgentsHandler = (input: WaitAgentsInput, signal: AbortSignal) => Promise<unknown>;

const WaitAgentsParameters = strictObjectSchema({
  taskIds: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
    minItems: 1,
    maxItems: 64,
    uniqueItems: true,
  }),
  mode: Type.Optional(Type.Union([Type.Literal('all'), Type.Literal('any')])),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 60_000 })),
});

export const waitAgentsTool = completeToolRegistration({
  name: 'wait_agents',
  description:
    'Wait for the currently accepted execution of descendant tasks. Waiting releases model request capacity. A timeout does not stop the tasks. Check each returned status, error and partial flag before summarizing; unfinished or shortened text is not a completed report.',
  parameters: WaitAgentsParameters,
  scope: 'session',
  loading: 'default',
  readOnly: true,
  available: (input) => input.agents,
  execute: async (ports, args, invocation) =>
    textResult(JSON.stringify(await requireAgentHandlers(ports).wait(args, invocation.signal))),
});
