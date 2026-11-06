import { Type } from 'typebox';

import { completeToolRegistration, strictObjectSchema } from '../lib/tool-registry.js';
import { textResult } from '../lib/tool-result.js';

import { requireWorkHandlers } from '../lib/tool-context.js';

export type SessionHistorySearchHandler = (query: string, limit: number) => string;

const SearchSessionHistoryParameters = strictObjectSchema({
  query: Type.String({ minLength: 2, maxLength: 200 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
});

export const searchSessionHistoryTool = completeToolRegistration({
  name: 'search_session_history',
  description:
    'Search bounded original messages and retained tool text in this session selected branch, including compacted history. Tool matches provide a record id and offset for read_tool_result. This does not search other sessions or long-term memory.',
  parameters: SearchSessionHistoryParameters,
  scope: 'session',
  loading: 'on-demand',
  readOnly: true,
  available: (input) => input.work,
  execute: (ports, args) =>
    textResult(requireWorkHandlers(ports).searchHistory(args.query, args.limit ?? 10)),
});
