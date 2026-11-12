import { Type } from 'typebox';
import type { SearchSourceExcerpt } from '@my-pi-harness/protocol';
import { completeToolRegistration, strictObjectSchema } from '../lib/tool-registry';
import { requireSearchHandlers } from '../lib/tool-context';
import { textResult } from '../lib/tool-result';

export type ReadSearchSourceHandler = (
  sourceId: string,
  start: number,
  end: number,
  signal: AbortSignal,
) => Promise<SearchSourceExcerpt>;

const offset = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const parameters = strictObjectSchema({
  sourceId: Type.String({ minLength: 1, maxLength: 200 }),
  start: offset,
  end: offset,
});

/** Runtime-owned discovery and consumed exact quotations supply every source-read permission. */
export const readSearchSourceTool = completeToolRegistration({
  name: 'read_search_source',
  description:
    'Read at most 8000 UTF-16 characters from a source ID found by search_sessions in this Run or explicitly quoted by the user. start/end are exact half-open offsets. Quoted sources allow only the original selected range or a smaller range; they never grant neighboring messages, arbitrary branches or a whole workspace.',
  parameters,
  scope: 'session',
  loading: 'on-demand',
  readOnly: true,
  available: (input) => input.sessionSearch === true,
  execute: async (ports, input, invocation) =>
    textResult(
      JSON.stringify(
        await requireSearchHandlers(ports).read(
          input.sourceId,
          input.start,
          input.end,
          invocation.signal,
        ),
      ),
    ),
});
