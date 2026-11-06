import { Type, type Static } from 'typebox';
import { AgentLimitsSchema } from '@my-pi-harness/protocol';
import {
  completeToolRegistration,
  strictObjectSchema,
  type ToolInvocation,
} from '../lib/tool-registry';
import { textResult } from '../lib/tool-result';

import { requireAgentHandlers } from '../lib/tool-context';

export type SpawnAgentInput = Static<typeof SpawnAgentParameters>;
export type SpawnAgentHandler = (
  input: SpawnAgentInput,
  invocation: ToolInvocation,
) => Promise<unknown>;

const SpawnAgentParameters = strictObjectSchema({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  task: Type.String({ minLength: 1, maxLength: 32_000 }),
  roleId: Type.String({ minLength: 1, maxLength: 160 }),
  attachmentIds: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 8, uniqueItems: true }),
  ),
  limits: Type.Optional(Type.Partial(AgentLimitsSchema, { additionalProperties: false })),
});

export const spawnAgentTool = completeToolRegistration({
  name: 'spawn_agent',
  description:
    'Delegate a bounded task to an enabled role with independent context. Only explicitly supplied task text and attachment references are forwarded. Returns a task ID, not a completed result. Wait for results before your final answer.',
  parameters: SpawnAgentParameters,
  scope: 'session',
  loading: 'default',
  readOnly: true,
  available: (input) => input.agents && input.canSpawn,
  execute: async (ports, args, invocation) =>
    textResult(JSON.stringify(await requireAgentHandlers(ports).spawn(args, invocation))),
});
