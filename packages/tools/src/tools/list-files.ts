import { Type } from 'typebox';
import { workspacePath } from '@my-pi-harness/sandbox';
import { walkWorkspace } from '../lib/filesystem';
import { completeToolRegistration, strictObjectSchema } from '../lib/tool-registry';

const parameters = strictObjectSchema({
  path: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  recursive: Type.Optional(Type.Boolean()),
  maxEntries: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
});

/** List bounded workspace entries while retaining filesystem path protections. */
export const listFilesTool = completeToolRegistration({
  name: 'list_files',
  description: 'List bounded workspace entries without following symbolic links.',
  parameters,
  scope: 'workspace',
  loading: 'default',
  readOnly: true,
  async execute(ports, args, invocation) {
    const context = await ports.workspace(invocation.signal);
    const path = await workspacePath(context.workspaceRoot, args.path ?? '.');
    const result = await walkWorkspace(
      context.workspaceRoot,
      path,
      args.recursive === true,
      context.signal,
      args.maxEntries ?? 200,
    );
    return {
      summary: `Listed ${result.entries.length} entries`,
      content: [
        {
          type: 'text',
          text: `${result.entries.map((entry) => `${entry.path}${entry.directory ? '/' : ''}`).join('\n')}${result.truncated ? '\n[Listing truncated]' : ''}`,
        },
      ],
    };
  },
});
