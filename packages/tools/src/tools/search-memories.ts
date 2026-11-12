import { Type } from 'typebox';
import type { MemorySearchResult } from '@my-pi-harness/protocol';
import { completeToolRegistration, strictObjectSchema } from '../lib/tool-registry';
import { requireMemoryHandlers } from '../lib/tool-context';
import { textResult } from '../lib/tool-result';

export type SearchMemoriesHandler = (
  query: string,
  limit: number,
  signal: AbortSignal,
) => Promise<MemorySearchResult>;

const SearchMemoriesParameters = strictObjectSchema({
  query: Type.String({ minLength: 1, maxLength: 500 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
});

/** Search reads current authorized facts and cannot save, change scope or assert human confirmation. */
export const searchMemoriesTool = completeToolRegistration({
  name: 'search_memories',
  description:
    'Search current stored long-term memories relevant to a query. The host limits results to this root or delegated task scope and current memory settings. Returns exact memory IDs for explicit task forwarding; this does not search conversations or save new facts.',
  parameters: SearchMemoriesParameters,
  scope: 'session',
  loading: 'default',
  readOnly: true,
  available: (input) => input.memory === true,
  execute: async (ports, args, invocation) =>
    textResult(
      JSON.stringify(
        await requireMemoryHandlers(ports).search(args.query, args.limit ?? 8, invocation.signal),
      ),
    ),
});
