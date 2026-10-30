import { Type, type Static } from 'typebox';
import { AgentLimitsSchema } from '@my-pi-harness/protocol';
import type { RunToolDefinition } from '../tools/toolset.js';

export type SpawnAgentInput = Static<typeof SpawnAgentInputSchema>;

const id = Type.String({ minLength: 1, maxLength: 160 });
const object = { additionalProperties: false } as const;

export const SpawnAgentInputSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 200 }),
    task: Type.String({ minLength: 1, maxLength: 32_000 }),
    roleId: id,
    attachmentIds: Type.Optional(Type.Array(id, { maxItems: 8, uniqueItems: true })),
    limits: Type.Optional(Type.Partial(AgentLimitsSchema, object)),
  },
  object,
);
export const WaitAgentsInputSchema = Type.Object(
  {
    taskIds: Type.Array(id, { minItems: 1, maxItems: 64, uniqueItems: true }),
    mode: Type.Optional(Type.Union([Type.Literal('all'), Type.Literal('any')])),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 60_000 })),
  },
  object,
);
export const SendAgentInputSchema = Type.Object(
  {
    target: Type.Union([
      Type.Object({ kind: Type.Literal('parent') }, object),
      Type.Object({ kind: Type.Literal('task'), taskId: id }, object),
    ]),
    text: Type.String({ minLength: 1, maxLength: 32_000 }),
    continue: Type.Optional(Type.Boolean()),
  },
  object,
);
export const AgentIdInputSchema = Type.Object({ taskId: id }, object);

/** Every delegated operation remains an ordinary audited tool call. */
export const AGENT_TOOL_DEFINITIONS: readonly RunToolDefinition[] = [
  {
    name: 'spawn_agent',
    description:
      'Delegate a bounded task to an enabled role with independent context. Only explicitly supplied task text and attachment references are forwarded. Returns a task ID, not a completed result. Wait for results before your final answer.',
    parameters: SpawnAgentInputSchema,
  },
  {
    name: 'get_agent_status',
    description: 'Read the status and bounded latest result of a task in this execution tree.',
    parameters: AgentIdInputSchema,
  },
  {
    name: 'wait_agents',
    description:
      'Wait for the currently accepted execution of descendant tasks. Waiting releases model request capacity. A timeout does not stop the tasks. Read the returned results before summarizing.',
    parameters: WaitAgentsInputSchema,
  },
  {
    name: 'send_agent_message',
    description:
      'Send bounded information within this execution tree. A running target receives it at a safe input boundary. Set continue explicitly to start a new Run of a completed task while its direct parent is still active.',
    parameters: SendAgentInputSchema,
  },
  {
    name: 'stop_agent',
    description:
      'Stop one descendant task and its subtree, and wait for owned model and tool work to settle.',
    parameters: AgentIdInputSchema,
  },
];

/** Names are selected from the same declarations used for model requests. */
export function isAgentTool(name: string): boolean {
  return AGENT_TOOL_DEFINITIONS.some((definition) => definition.name === name);
}
