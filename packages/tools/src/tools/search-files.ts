import { stat } from 'node:fs/promises';
import { Type } from 'typebox';
import {
  checkCancelled,
  readStableFile,
  toWorkspaceRelativePath,
  workspacePath,
} from '@my-pi-harness/sandbox';
import { decodeText, MAXIMUM_TEXT_BYTES, walkWorkspace } from '../lib/filesystem.js';
import { ToolError, completeToolRegistration, strictObjectSchema } from '../lib/tool-registry.js';

const parameters = strictObjectSchema({
  path: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  query: Type.String({ minLength: 1, maxLength: 500 }),
  caseSensitive: Type.Optional(Type.Boolean()),
  maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

/** Search literal text with bounded traversal, byte reads and returned matches. */
export const searchFilesTool = completeToolRegistration({
  name: 'search_files',
  description:
    'Search literal text in bounded regular workspace files without following symbolic links.',
  parameters,
  scope: 'workspace',
  loading: 'default',
  readOnly: true,
  async execute(ports, args, invocation) {
    const context = await ports.workspace(invocation.signal);
    const root = context.workspaceRoot;
    const path = await workspacePath(root, args.path ?? '.');
    const info = await stat(path);
    const listed = info.isDirectory()
      ? await walkWorkspace(root, path, true, context.signal, 1000)
      : {
          entries: [{ path: toWorkspaceRelativePath(root, path), directory: false }],
          truncated: false,
        };
    const maximum = args.maxResults ?? 50;
    const sensitive = args.caseSensitive === true;
    const query = sensitive ? args.query : args.query.toLowerCase();
    const matches: string[] = [];
    let truncated = listed.truncated;
    let bytesRead = 0;
    for (const entry of listed.entries) {
      checkCancelled(context.signal);
      if (entry.directory) continue;
      const target = await workspacePath(root, entry.path);
      if ((await stat(target)).size > MAXIMUM_TEXT_BYTES) continue;
      let content: string;
      try {
        const bytes = await readStableFile(target, context.signal, MAXIMUM_TEXT_BYTES);
        bytesRead += bytes.length;
        if (bytesRead > 10_000_000) {
          truncated = true;
          break;
        }
        content = decodeText(bytes);
      } catch (error) {
        if (error instanceof ToolError && error.code === 'BINARY_FILE') continue;
        throw error;
      }
      for (const [index, line] of content.split('\n').entries()) {
        if ((sensitive ? line : line.toLowerCase()).includes(query)) {
          matches.push(`${entry.path}:${index + 1}: ${line.slice(0, 1000)}`);
          if (matches.length >= maximum) {
            truncated = true;
            break;
          }
        }
      }
      if (matches.length >= maximum) break;
    }
    return {
      summary: `Found ${matches.length} matches`,
      content: [
        { type: 'text', text: `${matches.join('\n')}${truncated ? '\n[Search truncated]' : ''}` },
      ],
    };
  },
});
