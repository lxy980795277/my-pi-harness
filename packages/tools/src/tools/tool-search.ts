import { Type } from 'typebox';
import { MAX_TOOL_SEARCH_RESULTS } from '../utils/tool-search';
import {
  completeToolRegistration,
  strictObjectSchema,
  type ToolContent,
} from '../lib/tool-registry';

import { requireCapabilityHandlers } from '../lib/tool-context';

export type ToolSearchHandler = (
  query: string,
  limit: number,
  signal: AbortSignal,
) => Promise<ToolContent[]>;

const ToolSearchParameters = strictObjectSchema({
  query: Type.String({ minLength: 1, maxLength: 200 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TOOL_SEARCH_RESULTS })),
});

export const toolSearchTool = completeToolRegistration({
  name: 'tool_search',
  description:
    'Find tools by service, exact tool name or task in this Run catalog. Matching tools load automatically for the next model request and remain available for this Run. Already available matches are identified. Default 8 results, maximum 10. Discovery does not grant execution permission.',
  parameters: ToolSearchParameters,
  scope: 'session',
  loading: 'default',
  readOnly: true,
  execute: async (ports, args, invocation) => ({
    summary: '工具目录',
    content: await requireCapabilityHandlers(ports).search(
      args.query,
      args.limit ?? 8,
      invocation.signal,
    ),
  }),
});
