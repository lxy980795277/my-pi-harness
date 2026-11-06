import { Type, type Static } from 'typebox';
import { PlanStepSchema } from '@my-pi-harness/protocol';
import {
  completeToolRegistration,
  strictObjectSchema,
  type ToolInvocation,
} from '../lib/tool-registry.js';
import { textResult } from '../lib/tool-result.js';

import { requireWorkHandlers } from '../lib/tool-context.js';

export type UpdatePlanHandler = (
  input: Static<typeof UpdatePlanParameters>,
  invocation: ToolInvocation,
) => Promise<string>;

const UpdatePlanParameters = strictObjectSchema({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  content: Type.String({ minLength: 1, maxLength: 32_000 }),
  steps: Type.Array(PlanStepSchema, { minItems: 1, maxItems: 100 }),
});

export const updatePlanTool = completeToolRegistration({
  name: 'update_plan',
  description:
    'Submit a structured plan for user review and suspend this tool. Approval continues the same Run in execution mode; feedback requires a revised submission. Tool permissions remain separate.',
  parameters: UpdatePlanParameters,
  scope: 'session',
  loading: 'on-demand',
  readOnly: true,
  available: (input) => input.work,
  execute: async (ports, args, invocation) =>
    textResult(await requireWorkHandlers(ports).proposePlan(args, invocation)),
});
