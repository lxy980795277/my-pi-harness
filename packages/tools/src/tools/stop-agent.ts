import { Type } from 'typebox';

import { completeToolRegistration, strictObjectSchema } from '../lib/tool-registry';
import { textResult } from '../lib/tool-result';

import { requireAgentHandlers } from '../lib/tool-context';

export type StopAgentHandler = (taskId: string) => Promise<unknown>;

const StopAgentParameters = strictObjectSchema({
  taskId: Type.String({ minLength: 1, maxLength: 160 }),
});

export const stopAgentTool = completeToolRegistration({
  name: 'stop_agent',
  description:
    'Stop one descendant task and its subtree, and wait for owned model and tool work to settle.',
  parameters: StopAgentParameters,
  scope: 'session',
  loading: 'on-demand',
  readOnly: true,
  available: (input) => input.agents,
  execute: async (ports, args) =>
    textResult(JSON.stringify(await requireAgentHandlers(ports).stop(args.taskId))),
});
