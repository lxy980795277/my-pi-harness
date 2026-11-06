import { Type } from 'typebox';

import { completeToolRegistration, strictObjectSchema } from '../lib/tool-registry.js';
import { textResult } from '../lib/tool-result.js';

import { requireWorkHandlers } from '../lib/tool-context.js';

export type ToolResultReadHandler = (id: string, offset: number, maximum: number) => string;

const ReadToolResultParameters = strictObjectSchema({
  toolCallId: Type.String({ minLength: 1, maxLength: 160 }),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 128_000 })),
  maxCharacters: Type.Optional(Type.Integer({ minimum: 1, maximum: 6000 })),
});

export const readToolResultTool = completeToolRegistration({
  name: 'read_tool_result',
  description:
    'Read a bounded page of retained text from a finished tool in this selected branch or agent task, including failed results. Use the retained record id from a context reference or search_session_history, then follow the returned next-page call. This does not repeat the original tool or recover text omitted by its output limit.',
  parameters: ReadToolResultParameters,
  scope: 'session',
  loading: 'on-demand',
  readOnly: true,
  available: (input) => input.work,
  execute: (ports, args) =>
    textResult(
      requireWorkHandlers(ports).readToolResult(
        args.toolCallId,
        args.offset ?? 0,
        args.maxCharacters ?? 6000,
      ),
    ),
});
