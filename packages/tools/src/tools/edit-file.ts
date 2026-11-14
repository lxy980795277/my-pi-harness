import { Type } from 'typebox';
import { decodeText, fileChangeResult } from '../lib/filesystem';
import { fileChangeInvocation } from '../lib/file-changes';
import { requireFileChangeHandlers } from '../lib/tool-context';
import { ToolError, completeToolRegistration, strictObjectSchema } from '../lib/tool-registry';

const parameters = strictObjectSchema({
  path: Type.String({ minLength: 1, maxLength: 2048 }),
  oldText: Type.String({ minLength: 1, maxLength: 250000 }),
  newText: Type.String({ maxLength: 250000 }),
  expectedHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  replaceAll: Type.Optional(Type.Boolean()),
});

/** Replace exact text in a matching preimage and return its bounded unified diff. */
export const editFileTool = completeToolRegistration({
  name: 'edit_file',
  description:
    'Replace exact text in a workspace file with its current SHA-256. Returns a unified diff.',
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
          if (current === null)
            throw new ToolError('FILE_MISSING', 'The file to edit does not exist');
          const before = decodeText(current);
          const parts = before.split(args.oldText);
          const count = parts.length - 1;
          if (count === 0 || (count > 1 && args.replaceAll !== true))
            throw new ToolError(
              'EDIT_AMBIGUOUS',
              'The old text must match exactly once unless replaceAll is enabled',
            );
          const after = parts.join(args.newText);
          const result = fileChangeResult(args.path, before, after);
          return { content: Buffer.from(after), result };
        },
      },
      fileChangeInvocation(invocation),
    );
  },
});
