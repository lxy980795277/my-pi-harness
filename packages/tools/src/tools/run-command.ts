import { Type, type Static } from 'typebox';

import {
  completeToolRegistration,
  strictObjectSchema,
  type ToolInvocation,
} from '../lib/tool-registry';
import { textResult } from '../lib/tool-result';

import { requireCommandHandlers } from '../lib/tool-context';

export type CommandRunInput = Static<typeof RunCommandParameters>;
export type RunCommandHandler = (
  input: CommandRunInput,
  invocation: ToolInvocation,
) => Promise<unknown>;

const RunCommandParameters = strictObjectSchema({
  command: Type.String({ minLength: 1, maxLength: 20000 }),
  yieldTimeMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 30000 })),
  lifetimeMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 86400000 })),
});

export const runCommandTool = completeToolRegistration({
  name: 'run_command',
  description:
    'Start a workspace command. Returns output and a commandId after up to 10 seconds by default; use wait_command to read incremental output. Sandboxed commands have no network, a fresh HOME and workspace writes only (read-only roles cannot write workspace). Explicit full access uses the real host. Lifetime defaults to 4 hours, maximum 24 hours; stopping a wait does not terminate the command.',
  parameters: RunCommandParameters,
  scope: 'workspace',
  loading: 'default',
  readOnly: true,
  available: (input) => input.platform === 'darwin',
  policy: (args, readOnly) => ({
    summary: `run_command: ${args.command.slice(0, 300)}`,
    approvalRequired: true,
    mutating: !readOnly,
  }),
  execute: async (ports, args, invocation) =>
    textResult(JSON.stringify(await requireCommandHandlers(ports).run(args, invocation))),
});
