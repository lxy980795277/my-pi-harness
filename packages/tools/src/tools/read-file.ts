import { Type } from 'typebox';
import { readStableFile, workspacePath } from '@my-pi-harness/sandbox';
import {
  decodeText,
  hashBytes,
  MAXIMUM_OUTPUT_CHARACTERS,
  MAXIMUM_TEXT_BYTES,
} from '../lib/filesystem.js';
import { ToolError, completeToolRegistration, strictObjectSchema } from '../lib/tool-registry.js';

const parameters = strictObjectSchema({
  path: Type.String({ minLength: 1, maxLength: 2048 }),
  startLine: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000000 })),
  maxLines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
});
const MAXIMUM_FILE_BYTES = 2 * 1024 * 1024;

/** Read bounded UTF-8 lines and the original byte hash for subsequent edits. */
export const readFileTool = completeToolRegistration({
  name: 'read_file',
  description:
    'Read a workspace UTF-8 text file with line numbers and SHA-256 for subsequent edits. Use read_document for documents or view_image for images.',
  parameters,
  scope: 'workspace',
  loading: 'default',
  readOnly: true,
  async execute(ports, args, invocation) {
    const context = await ports.workspace(invocation.signal);
    const path = await workspacePath(context.workspaceRoot, args.path);
    const data = await readStableFile(path, context.signal, MAXIMUM_FILE_BYTES);
    if (data.length > MAXIMUM_TEXT_BYTES)
      throw new ToolError('FILE_TOO_LARGE', 'Text file exceeds its 500000-byte limit');
    const lines = decodeText(data).split('\n');
    const startLine = args.startLine ?? 1;
    const maxLines = args.maxLines ?? 300;
    const selected = lines
      .slice(startLine - 1, startLine - 1 + maxLines)
      .map((line, index) => `${startLine + index}: ${line}`)
      .join('\n');
    const truncated =
      startLine - 1 + maxLines < lines.length || selected.length > MAXIMUM_OUTPUT_CHARACTERS;
    return {
      summary: `Read ${args.path}`,
      content: [
        {
          type: 'text',
          text: `SHA-256: ${hashBytes(data)}\nLines: ${lines.length}\n${selected.slice(0, MAXIMUM_OUTPUT_CHARACTERS)}${truncated ? '\n[Output truncated]' : ''}`,
        },
      ],
    };
  },
});
