import { Type, type Static } from 'typebox';

import {
  completeToolRegistration,
  strictObjectSchema,
  type ToolInvocation,
} from '../lib/tool-registry.js';
import { textResult } from '../lib/tool-result.js';

import { requireAgentHandlers } from '../lib/tool-context.js';

export type SendAgentInput = Static<typeof SendAgentMessageParameters>;
export type SendAgentMessageHandler = (
  input: SendAgentInput,
  invocation: ToolInvocation,
) => Promise<unknown>;

const SendAgentMessageParameters = strictObjectSchema({
  target: Type.Union([
    strictObjectSchema({ kind: Type.Literal('parent') }),
    strictObjectSchema({
      kind: Type.Literal('task'),
      taskId: Type.String({ minLength: 1, maxLength: 160 }),
    }),
  ]),
  text: Type.String({ minLength: 1, maxLength: 32_000 }),
  continue: Type.Optional(Type.Boolean()),
});

export const sendAgentMessageTool = completeToolRegistration({
  name: 'send_agent_message',
  description:
    'Send bounded information within this execution tree. A running target receives it at a safe input boundary. Set continue explicitly to start a new Run of a completed task while its direct parent is still active.',
  parameters: SendAgentMessageParameters,
  scope: 'session',
  loading: 'on-demand',
  readOnly: true,
  available: (input) => input.agents,
  execute: async (ports, args, invocation) =>
    textResult(JSON.stringify(await requireAgentHandlers(ports).send(args, invocation))),
});
