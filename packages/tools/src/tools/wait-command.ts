import { Type } from 'typebox';

import { completeToolRegistration, strictObjectSchema } from '../lib/tool-registry.js';
import { textResult } from '../lib/tool-result.js';

import { requireCommandHandlers } from '../lib/tool-context.js';

export type WaitCommandHandler = (
  commandId: string,
  timeoutMs: number,
  cursor: number,
  signal: AbortSignal,
) => Promise<unknown>;

const WaitCommandParameters = strictObjectSchema({
  commandId: Type.String({ minLength: 1, maxLength: 160 }),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 30000 })),
  cursor: Type.Optional(Type.Integer({ minimum: 0 })),
});

export const waitCommandTool = completeToolRegistration({
  name: 'wait_command',
  description:
    'Wait up to 30 seconds for a managed command and read bounded incremental stdout/stderr. Use the returned nextCursor for the next page. A timeout is not command failure.',
  parameters: WaitCommandParameters,
  scope: 'workspace',
  loading: 'default',
  readOnly: true,
  available: (input) => input.platform === 'darwin',
  execute: async (ports, args, invocation) =>
    textResult(
      JSON.stringify(
        await requireCommandHandlers(ports).wait(
          args.commandId,
          args.timeoutMs ?? 10000,
          args.cursor ?? 0,
          invocation.signal,
        ),
      ),
    ),
});
