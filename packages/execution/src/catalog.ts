import { Type, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { ExecutionError } from './errors.js';
import type { ToolDescription } from './types.js';
import { OFFICE_TOOL_DEFINITIONS, describeOfficeTool } from './office/catalog.js';

const path = Type.String({ minLength: 1, maxLength: 2048 });
const digest = Type.String({ pattern: '^[a-f0-9]{64}$' });
const object = <T extends Record<string, TSchema>>(
  properties: T,
): ReturnType<typeof Type.Object<T>> => Type.Object(properties, { additionalProperties: false });

/** Public declarations consumed by Pi; arguments are validated again at execution entry. */
export const TOOL_DEFINITIONS: readonly {
  name: string;
  description: string;
  parameters: TSchema;
}[] = [
  {
    name: 'read_file',
    description:
      'Read a workspace-relative text file, image, or PDF. Text includes its SHA-256 for later edits. PDF extraction has no OCR.',
    parameters: object({
      path,
      startLine: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
      maxLines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    }),
  },
  {
    name: 'list_files',
    description:
      'List workspace-relative entries without following symbolic links. Results and traversal are bounded.',
    parameters: object({
      path: Type.Optional(path),
      recursive: Type.Optional(Type.Boolean()),
      maxEntries: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    }),
  },
  {
    name: 'search_files',
    description:
      'Search literal text in regular workspace text files without following symbolic links. Does not evaluate a regular expression.',
    parameters: object({
      path: Type.Optional(path),
      query: Type.String({ minLength: 1, maxLength: 500 }),
      caseSensitive: Type.Optional(Type.Boolean()),
      maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
  },
  {
    name: 'write_file',
    description:
      'Create or replace a UTF-8 workspace file. expectedHash:null permits creation only; replacing requires its current SHA-256. Parent directory must exist.',
    parameters: object({
      path,
      content: Type.String({ maxLength: 250_000 }),
      expectedHash: Type.Union([digest, Type.Null()]),
    }),
  },
  {
    name: 'edit_file',
    description:
      'Replace exact text in a workspace file, requiring its current SHA-256. By default the old text must occur exactly once. Returns a unified diff.',
    parameters: object({
      path,
      oldText: Type.String({ minLength: 1, maxLength: 250_000 }),
      newText: Type.String({ maxLength: 250_000 }),
      expectedHash: digest,
      replaceAll: Type.Optional(Type.Boolean()),
    }),
  },
  {
    name: 'shell',
    description:
      'Run a macOS command from the registered workspace under the policy frozen for this run. Sandboxed mode uses Seatbelt with workspace-only writes, no network and a fresh HOME. Explicit full access runs without OS isolation as the host user with the real HOME. Both use an environment allowlist, cancellation, time and output limits. Unavailable on other platforms.',
    parameters: object({
      command: Type.String({ minLength: 1, maxLength: 20_000 }),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 120_000 })),
    }),
  },
  {
    name: 'web_fetch',
    description:
      'Fetch a public HTTP(S) URL with GET or explicitly approved POST. Private addresses and unsafe redirects are denied. Returns bounded UTF-8 text without running scripts.',
    parameters: object({
      url: Type.String({ minLength: 1, maxLength: 4096 }),
      method: Type.Optional(Type.Union([Type.Literal('GET'), Type.Literal('POST')])),
      body: Type.Optional(Type.String({ maxLength: 250_000 })),
      contentType: Type.Optional(
        Type.Union([
          Type.Literal('application/json'),
          Type.Literal('text/plain'),
          Type.Literal('application/x-www-form-urlencoded'),
        ]),
      ),
    }),
  },
];

export function validateArguments(name: string, args: Record<string, unknown>): void {
  const definition = [...TOOL_DEFINITIONS, ...OFFICE_TOOL_DEFINITIONS].find(
    (entry) => entry.name === name,
  );
  if (!definition) throw new ExecutionError('UNKNOWN_TOOL', 'The requested tool is not available');
  if (!Value.Check(definition.parameters, args))
    throw new ExecutionError('INVALID_ARGUMENTS', `Invalid arguments for ${name}`);
  if (name === 'web_fetch' && args['method'] !== 'POST' && args['body'] !== undefined) {
    throw new ExecutionError('INVALID_ARGUMENTS', 'A request body requires POST');
  }
}

/** Read a schema-validated string; this helper is called only after validateArguments. */
export function stringArgument(args: Record<string, unknown>, key: string, fallback = ''): string {
  return (args[key] as string | undefined) ?? fallback;
}

/** Explain the exact requested operation without reading files or opening connections. */
export function describeTool(name: string, args: Record<string, unknown>): ToolDescription {
  validateArguments(name, args);
  if (OFFICE_TOOL_DEFINITIONS.some((tool) => tool.name === name))
    return describeOfficeTool(name, args);
  const mutating =
    name === 'write_file' ||
    name === 'edit_file' ||
    name === 'shell' ||
    (name === 'web_fetch' && args['method'] === 'POST');
  let target = stringArgument(args, 'path', '.');
  if (name === 'web_fetch') target = stringArgument(args, 'url');
  if (name === 'shell') target = stringArgument(args, 'command');
  return {
    summary: `${name}: ${target.slice(0, 300)}`,
    approvalRequired: mutating || name === 'web_fetch',
    mutating,
  };
}
