import { Type, type Static } from 'typebox';
import { QuestionItemSchema } from '@my-pi-harness/protocol';
import {
  completeToolRegistration,
  strictObjectSchema,
  type ToolInvocation,
} from '../lib/tool-registry.js';
import { textResult } from '../lib/tool-result.js';

import { requireWorkHandlers } from '../lib/tool-context.js';

export type AskUserHandler = (
  questions: Static<typeof AskUserParameters>['questions'],
  invocation: ToolInvocation,
) => Promise<string>;

const AskUserParameters = strictObjectSchema({
  questions: Type.Array(QuestionItemSchema, { minItems: 1, maxItems: 12 }),
});

export const askUserTool = completeToolRegistration({
  name: 'ask_user',
  description:
    'Ask one or more structured questions and wait for the user. Use stable question and option IDs, descriptions, explicit single/multiple selection, and custom-input permission.',
  parameters: AskUserParameters,
  scope: 'session',
  loading: 'default',
  readOnly: true,
  available: (input) => input.work,
  execute: async (ports, args, invocation) =>
    textResult(await requireWorkHandlers(ports).ask(args.questions, invocation)),
});
