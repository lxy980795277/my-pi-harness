import {
  MemoryAgentUpdateInputSchema,
  type MemoryAgentUpdateInput,
  type MemoryMutationResult,
} from '@my-pi-harness/protocol';
import { completeToolRegistration, ToolError, type ToolInvocation } from '../lib/tool-registry';
import { requireMemoryHandlers } from '../lib/tool-context';
import { textResult } from '../lib/tool-result';

export type UpdateMemoryHandler = (
  input: MemoryAgentUpdateInput,
  invocation: ToolInvocation,
) => Promise<MemoryMutationResult>;

/** Host-bound source identity and revision checks authorize this mutation. */
export const updateMemoryTool = completeToolRegistration({
  name: 'update_memory',
  description:
    'Update an existing long-term memory identified by search_memories using its expected revision. Apply explicit user corrections directly; never overwrite a newer revision.',
  parameters: MemoryAgentUpdateInputSchema,
  scope: 'session',
  loading: 'default',
  readOnly: false,
  available: (input) => input.memoryMutations === true,
  policy: () => ({ summary: 'update_memory', approvalRequired: false, mutating: true }),
  execute: async (ports, input, invocation) => {
    const handler = requireMemoryHandlers(ports).update;
    if (!handler)
      throw new ToolError('MEMORY_UNAVAILABLE', 'Memory mutation handler is unavailable');
    return textResult(JSON.stringify((await handler(input, invocation)).receipt));
  },
});
