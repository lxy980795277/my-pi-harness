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
    const context = await ports.workspace(invocation.signal);
    if (context.readOnly)
      throw new ToolError('READ_ONLY', 'File changes are disabled by the current policy');
    const path = await workspacePath(context.workspaceRoot, args.path, true);
    const current = await readCurrentContent(path, context.signal);
    assertPreimage(current, args.expectedHash);
    const before = current === null ? '' : decodeText(current);
    const result = fileChangeResult(args.path, before, args.content);
    await writeTextFileAtomic(path, args.content, current, context);
    return result;
  },
});
