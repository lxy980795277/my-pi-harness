import { Type, type Static } from 'typebox';
import { PlanStepSchema } from '@my-pi-harness/protocol';
import { completeToolRegistration, strictObjectSchema } from '../lib/tool-registry.js';
import { textResult } from '../lib/tool-result.js';

import { requireWorkHandlers } from '../lib/tool-context.js';

export type UpdatePlanStepsHandler = (
  steps: Static<typeof UpdatePlanStepsParameters>['steps'],
) => string;

const UpdatePlanStepsParameters = strictObjectSchema({
  steps: Type.Array(Type.Pick(PlanStepSchema, ['id', 'status']), { minItems: 1, maxItems: 100 }),
});

export const updatePlanStepsTool = completeToolRegistration({
  name: 'update_plan_steps',
  description:
    'Update step statuses in an already approved plan. Preserve step IDs; at most one step may be in progress. This cannot change plan contents or approve a plan.',
  parameters: UpdatePlanStepsParameters,
  scope: 'session',
  loading: 'on-demand',
  readOnly: true,
  available: (input) => input.work,
  execute: (ports, args) => textResult(requireWorkHandlers(ports).updatePlanSteps(args.steps)),
});
