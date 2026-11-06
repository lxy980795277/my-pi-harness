import { Type } from 'typebox';

import {
  completeToolRegistration,
  strictObjectSchema,
  type ToolContent,
} from '../lib/tool-registry';

import { requireCapabilityHandlers } from '../lib/tool-context';

export type LoadSkillHandler = (id: string, signal: AbortSignal) => Promise<ToolContent[]>;

const LoadSkillParameters = strictObjectSchema({
  id: Type.String({ minLength: 1, maxLength: 160 }),
});

export const loadSkillTool = completeToolRegistration({
  name: 'load_skill',
  description:
    'Load a Skill from the available directory by id. The host selects its accepted content and plugin binding. Instructions become available in the next request and do not grant tool permissions.',
  parameters: LoadSkillParameters,
  scope: 'session',
  loading: 'default',
  readOnly: true,
  available: (input) => input.skills && input.skillDirectory,
  execute: async (ports, args, invocation) => ({
    summary: '加载 Skill',
    content: await requireCapabilityHandlers(ports).loadSkill(args.id, invocation.signal),
  }),
});
