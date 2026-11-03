import { Type } from 'typebox';
import type { RunToolDefinition } from '../tools/toolset.js';
import { MAX_TOOL_SEARCH_RESULTS } from './search.js';

const object = { additionalProperties: false } as const;

/** Discovery activates accepted tools; execution permission remains with the tool policy. */
export const DISCOVERY_TOOL_DEFINITIONS: readonly RunToolDefinition[] = [
  {
    name: 'tool_search',
    description:
      'Find tools by service, exact tool name or task in this Run catalog. Matching tools load automatically for the next model request and remain available for this Run. Already available matches are identified. Default 8 results, maximum 10. Discovery does not grant execution permission.',
    parameters: Type.Object(
      {
        query: Type.String({ minLength: 1, maxLength: 200 }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TOOL_SEARCH_RESULTS })),
      },
      object,
    ),
  },
];

/** Skill instructions and supporting resources are separate from executable tool authorization. */
export const SKILL_TOOL_DEFINITIONS: readonly RunToolDefinition[] = [
  {
    name: 'load_skill',
    description:
      'Load a Skill from the available directory by id. The host selects its accepted content and plugin binding. Instructions become available in the next request and do not grant tool permissions.',
    parameters: Type.Object({ id: Type.String({ minLength: 1, maxLength: 160 }) }, object),
  },
  {
    name: 'read_skill_resource',
    description:
      'Read a supporting text or image resource from an active Skill by its id and resource-relative path. Only resources in the accepted snapshot can be read; arbitrary filesystem paths and URLs are not accepted.',
    parameters: Type.Object(
      {
        skillId: Type.String({ minLength: 1, maxLength: 160 }),
        path: Type.String({ minLength: 1, maxLength: 1024 }),
      },
      object,
    ),
  },
];
