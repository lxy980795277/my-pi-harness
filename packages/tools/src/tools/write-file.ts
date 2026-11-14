import { Type } from 'typebox';
import { decodeText, fileChangeResult } from '../lib/filesystem';
import { fileChangeInvocation } from '../lib/file-changes';
import { requireFileChangeHandlers } from '../lib/tool-context';
import { ToolError, completeToolRegistration, strictObjectSchema } from '../lib/tool-registry';

const parameters = strictObjectSchema({
  path: Type.String({ minLength: 1, maxLength: 2048 }),
  content: Type.String({ maxLength: 250000 }),
  expectedHash: Type.Union([Type.String({ pattern: '^[a-f0-9]{64}$' }), Type.Null()]),
});

/** Create or replace text only when the accepted preimage still matches. */
export const writeFileTool = completeToolRegistration({
  name: 'write_file',
  description:
    'Create or replace UTF-8 workspace text. expectedHash:null allows creation only; replacement requires the current SHA-256. Parent directory must exist.',
  parameters,
  scope: 'workspace',
  loading: 'default',
  readOnly: false,
  async execute(ports, args, invocation) {
    if (ports.readOnly)
      throw new ToolError('READ_ONLY', 'File changes are disabled by the current policy');
    return requireFileChangeHandlers(ports).modify(
      {
        path: args.path,
        expectedHash: args.expectedHash,
        prepare(current) {
          const before = current === null ? '' : decodeText(current);
          const result = fileChangeResult(args.path, before, args.content);
          return { content: Buffer.from(args.content), result };
        },
      },
      fileChangeInvocation(invocation),
    );
  },
});
