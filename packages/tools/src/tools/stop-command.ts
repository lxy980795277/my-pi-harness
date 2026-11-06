import { Type } from 'typebox';

import { completeToolRegistration, strictObjectSchema } from '../lib/tool-registry';
import { textResult } from '../lib/tool-result';

import { requireCommandHandlers } from '../lib/tool-context';

export type StopCommandHandler = (commandId: string, signal: AbortSignal) => Promise<unknown>;

const StopCommandParameters = strictObjectSchema({
  commandId: Type.String({ minLength: 1, maxLength: 160 }),
});

export const stopCommandTool = completeToolRegistration({
  name: 'stop_command',
  description:
    'Stop a managed command owned by this task/session and wait for process-group cleanup.',
  parameters: StopCommandParameters,
  scope: 'workspace',
  loading: 'default',
  readOnly: true,
  available: (input) => input.platform === 'darwin',
  execute: async (ports, args, invocation) =>
    textResult(
      JSON.stringify(await requireCommandHandlers(ports).stop(args.commandId, invocation.signal)),
    ),
});
