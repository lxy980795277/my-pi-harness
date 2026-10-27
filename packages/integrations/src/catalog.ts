import {
  specTypeSchemas,
  type Client,
  type Tool,
  type Resource,
  type Prompt,
} from '@modelcontextprotocol/client';
import { McpError } from './errors.js';
import { deepFreeze, fingerprint } from './fingerprint.js';
import { compileMcpInputSchema } from './schema.js';
import type { McpCatalog, McpDiscoveredTool } from './types.js';

export function containsSecret(value: unknown, secrets: readonly string[]): boolean {
  if (typeof value === 'string')
    return secrets.some((secret) => secret.length > 0 && value.includes(secret));
  if (Array.isArray(value)) return value.some((entry) => containsSecret(entry, secrets));
  if (typeof value === 'object' && value !== null)
    return Object.entries(value).some(
      ([key, entry]) => containsSecret(key, secrets) || containsSecret(entry, secrets),
    );
  return false;
}

/** Freeze validated definitions, rejecting credential echoes before exposing or persisting metadata. */
export function discovered(input: Tool, secrets: readonly string[]): McpDiscoveredTool {
  if (containsSecret(input, secrets))
    throw new McpError('SECRET_ECHO', 'The server returned credential-bearing tool metadata');
  const definition = deepFreeze(structuredClone(input));
  const definitionFingerprint = fingerprint(definition);
  let parameters = null;
  let unavailableReason: string | null = null;
  try {
    if (definition.execution?.taskSupport === 'required')
      throw new Error('Task-based tools are unsupported');
    if (definition.outputSchema !== undefined) compileMcpInputSchema(definition.outputSchema);
    parameters = compileMcpInputSchema(definition.inputSchema);
  } catch {
    unavailableReason = '此工具的输入 Schema 不属于当前支持的 draft-07 子集';
  }
  return deepFreeze({
    remoteToolName: definition.name,
    description: definition.description ?? definition.name,
    definitionFingerprint,
    definition,
    parameters,
    supported: parameters !== null,
    unavailableReason,
  });
}

/** Each tools/list page is checked before fetching another page; no SDK auto aggregation. */
export async function discoverCatalog(
  client: Client,
  signal: AbortSignal,
  secrets: readonly string[],
): Promise<McpCatalog> {
  if (client.getServerCapabilities()?.tools === undefined)
    return deepFreeze({ tools: [], ...(await discoverMetadata(client, signal, secrets)) });
  const tools: McpDiscoveredTool[] = [];
  const names = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let bytes = 0;
  for (let page = 0; page < 16; page += 1) {
    const params = cursor === undefined ? {} : { cursor };
    const result = await client.request(
      { method: 'tools/list', params },
      specTypeSchemas.ListToolsResult,
      { signal, timeout: 30000 },
    );
    bytes += Buffer.byteLength(JSON.stringify(result));
    if (bytes > 2 * 1024 * 1024 || tools.length + result.tools.length > 512)
      throw new McpError('CATALOG_LIMIT', 'The local tool catalog exceeded its limit');
    for (const tool of result.tools) {
      if (names.has(tool.name) || tool.name.length > 128 || tool.name.length === 0)
        throw new McpError(
          'INVALID_CATALOG',
          'The local catalog contains an invalid or duplicate tool name',
        );
      names.add(tool.name);
      tools.push(discovered(tool, secrets));
    }
    cursor = result.nextCursor;
    if (cursor === undefined) {
      const metadata = await discoverMetadata(client, signal, secrets);
      return deepFreeze({ tools, ...metadata });
    }
    if (cursors.has(cursor))
      throw new McpError('INVALID_CATALOG', 'The local tool catalog repeated a pagination cursor');
    cursors.add(cursor);
  }
  throw new McpError('CATALOG_LIMIT', 'The local tool catalog exceeded its page limit');
}

/** Metadata is displayed without reading resources or executing prompts. */
async function discoverMetadata(
  client: Client,
  signal: AbortSignal,
  secrets: readonly string[],
): Promise<{ resources: Resource[]; prompts: Prompt[] }> {
  const resources: Resource[] = [];
  const prompts: Prompt[] = [];
  const capabilities = client.getServerCapabilities();
  let bytes = 0;
  const inspect = (value: unknown): void => {
    bytes += Buffer.byteLength(JSON.stringify(value));
    if (bytes > 2 * 1024 * 1024 || containsSecret(value, secrets))
      throw new McpError(
        'METADATA_LIMIT',
        'MCP metadata exceeded its limit or contained credentials',
      );
  };
  if (capabilities?.resources !== undefined) {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const uris = new Set<string>();
    for (let page = 0; page < 16; page += 1) {
      const result = await client.request(
        { method: 'resources/list', params: cursor === undefined ? {} : { cursor } },
        specTypeSchemas.ListResourcesResult,
        { signal, timeout: 30000 },
      );
      inspect(result);
      for (const resource of result.resources) {
        if (uris.has(resource.uri) || resources.length >= 512)
          throw new McpError('INVALID_METADATA', 'MCP resource directory is invalid');
        uris.add(resource.uri);
        resources.push(resource);
      }
      cursor = result.nextCursor;
      if (cursor === undefined) break;
      if (page === 15 || cursors.has(cursor))
        throw new McpError('METADATA_LIMIT', 'MCP resource directory exceeded its page limit');
      cursors.add(cursor);
    }
  }
  if (capabilities?.prompts !== undefined) {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const names = new Set<string>();
    for (let page = 0; page < 16; page += 1) {
      const result = await client.request(
        { method: 'prompts/list', params: cursor === undefined ? {} : { cursor } },
        specTypeSchemas.ListPromptsResult,
        { signal, timeout: 30000 },
      );
      inspect(result);
      for (const prompt of result.prompts) {
        if (names.has(prompt.name) || prompts.length >= 512)
          throw new McpError('INVALID_METADATA', 'MCP prompt directory is invalid');
        names.add(prompt.name);
        prompts.push(prompt);
      }
      cursor = result.nextCursor;
      if (cursor === undefined) break;
      if (page === 15 || cursors.has(cursor))
        throw new McpError('METADATA_LIMIT', 'MCP prompt directory exceeded its page limit');
      cursors.add(cursor);
    }
  }
  return { resources, prompts };
}
