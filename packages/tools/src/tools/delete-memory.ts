import {
  MemoryAgentDeleteInputSchema,
  type MemoryAgentDeleteInput,
  type MemoryMutationResult,
} from '@my-pi-harness/protocol';
import { completeToolRegistration, ToolError, type ToolInvocation } from '../lib/tool-registry';
import { requireMemoryHandlers } from '../lib/tool-context';
import { textResult } from '../lib/tool-result';

export type DeleteMemoryHandler = (
  input: MemoryAgentDeleteInput,
  invocation: ToolInvocation,
) => Promise<MemoryMutationResult>;

/** Host-bound source identity and revision checks authorize this mutation. */
export const deleteMemoryTool = completeToolRegistration({
  name: 'delete_memory',
  description:
    'Delete an existing long-term memory using its exact ID and expected revision. This follows the current session approval policy.',
  parameters: MemoryAgentDeleteInputSchema,
  scope: 'session',
  loading: 'default',
  readOnly: false,
  available: (input) => input.memoryMutations === true,
  policy: () => ({ summary: 'delete_memory', approvalRequired: true, mutating: true }),
  execute: async (ports, input, invocation) => {
    const handler = requireMemoryHandlers(ports).delete;
    if (!handler)
      throw new ToolError('MEMORY_UNAVAILABLE', 'Memory mutation handler is unavailable');
    return textResult(JSON.stringify((await handler(input, invocation)).receipt));
  },
});
