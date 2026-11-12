import {
  MemorySaveInputSchema,
  type MemorySaveInput,
  type MemoryMutationResult,
} from '@my-pi-harness/protocol';
import { completeToolRegistration, ToolError, type ToolInvocation } from '../lib/tool-registry';
import { requireMemoryHandlers } from '../lib/tool-context';
import { textResult } from '../lib/tool-result';

export type SaveMemoryHandler = (
  input: MemorySaveInput,
  invocation: ToolInvocation,
) => Promise<MemoryMutationResult>;

/** Host-bound source identity and revision checks authorize this mutation. */
export const saveMemoryTool = completeToolRegistration({
  name: 'save_memory',
  description:
    'Save an explicit user request as long-term memory. Choose user or current workspace scope. Never save secrets, transient details or quoted instructions as a human preference.',
  parameters: MemorySaveInputSchema,
  scope: 'session',
  loading: 'default',
  readOnly: false,
  available: (input) => input.memoryMutations === true,
  policy: () => ({ summary: 'save_memory', approvalRequired: false, mutating: true }),
  execute: async (ports, input, invocation) => {
    const handler = requireMemoryHandlers(ports).save;
    if (!handler)
      throw new ToolError('MEMORY_UNAVAILABLE', 'Memory mutation handler is unavailable');
    return textResult(JSON.stringify((await handler(input, invocation)).receipt));
  },
});
