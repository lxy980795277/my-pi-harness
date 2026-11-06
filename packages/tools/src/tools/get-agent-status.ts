import { Type } from 'typebox';

import { completeToolRegistration, strictObjectSchema } from '../lib/tool-registry.js';
import { textResult } from '../lib/tool-result.js';

import { requireAgentHandlers } from '../lib/tool-context.js';

export type GetAgentStatusHandler = (taskId: string) => Promise<unknown>;

const GetAgentStatusParameters = strictObjectSchema({
  taskId: Type.String({ minLength: 1, maxLength: 160 }),
});

export const getAgentStatusTool = completeToolRegistration({
  name: 'get_agent_status',
  description:
    'Read a task status and bounded output from its selected Run. Check status, error and partial: partial text may be unfinished or shortened and is not proof of completion.',
  parameters: GetAgentStatusParameters,
  scope: 'session',
  loading: 'on-demand',
  readOnly: true,
  available: (input) => input.agents,
  execute: async (ports, args) =>
    textResult(JSON.stringify(await requireAgentHandlers(ports).status(args.taskId))),
});
