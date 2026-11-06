import { Type } from 'typebox';

import {
  completeToolRegistration,
  strictObjectSchema,
  type ToolContent,
} from '../lib/tool-registry.js';

import { requireCapabilityHandlers } from '../lib/tool-context.js';

export type ReadSkillResourceHandler = (
  id: string,
  path: string,
  signal: AbortSignal,
) => Promise<ToolContent[]>;

const ReadSkillResourceParameters = strictObjectSchema({
  skillId: Type.String({ minLength: 1, maxLength: 160 }),
  path: Type.String({ minLength: 1, maxLength: 1024 }),
});

export const readSkillResourceTool = completeToolRegistration({
  name: 'read_skill_resource',
  description:
    'Read a supporting text or image resource from an active Skill by its id and resource-relative path. Only resources in the accepted snapshot can be read; arbitrary filesystem paths and URLs are not accepted.',
  parameters: ReadSkillResourceParameters,
  scope: 'session',
  loading: 'on-demand',
  readOnly: true,
  available: (input) => input.skills,
  execute: async (ports, args, invocation) => ({
    summary: 'Skill 资源',
    content: await requireCapabilityHandlers(ports).readResource(
      args.skillId,
      args.path,
      invocation.signal,
    ),
  }),
});
