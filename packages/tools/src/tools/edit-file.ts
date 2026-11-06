import { Type } from 'typebox';
import { workspacePath } from '@my-pi-harness/sandbox';
import {
  assertPreimage,
  decodeText,
  fileChangeResult,
  readCurrentContent,
  writeTextFileAtomic,
} from '../lib/filesystem.js';
import { ToolError, completeToolRegistration, strictObjectSchema } from '../lib/tool-registry.js';

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
    const context = await ports.workspace(invocation.signal);
    if (context.readOnly)
      throw new ToolError('READ_ONLY', 'File changes are disabled by the current policy');
    const path = await workspacePath(context.workspaceRoot, args.path);
    const current = await readCurrentContent(path, context.signal);
    assertPreimage(current, args.expectedHash);
    if (current === null) throw new ToolError('FILE_MISSING', 'The file to edit does not exist');
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
    await writeTextFileAtomic(path, after, current, context);
    return result;
  },
});
