import { specTypeSchemas } from '@modelcontextprotocol/client';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { discovered } from './catalog.js';
import { deepFreeze } from './fingerprint.js';
import { McpError } from './errors.js';
import type { McpCatalog } from './types.js';

const Snapshot = Type.Object(
  {
    tools: Type.Array(Type.Unknown(), { maxItems: 512 }),
    resources: Type.Array(Type.Unknown(), { maxItems: 512 }),
    prompts: Type.Array(Type.Unknown(), { maxItems: 512 }),
  },
  { additionalProperties: false },
);

/** Only protocol definitions are persisted; executable TypeBox metadata is rebuilt on read. */
export function encodeMcpCatalog(catalog: McpCatalog): string {
  const data = JSON.stringify({
    tools: catalog.tools.map((tool) => tool.definition),
    resources: catalog.resources ?? [],
    prompts: catalog.prompts ?? [],
  });
  if (Buffer.byteLength(data) > 8 * 1024 * 1024)
    throw new McpError('CATALOG_LIMIT', 'MCP catalog snapshot exceeded its limit');
  return data;
}

/** Revalidate durable JSON with the official SDK before restoring selectable tools or metadata. */
export function decodeMcpCatalog(data: string): McpCatalog {
  if (Buffer.byteLength(data) > 8 * 1024 * 1024)
    throw new McpError('INVALID_CATALOG', 'Stored MCP catalog is invalid');
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new McpError('INVALID_CATALOG', 'Stored MCP catalog is invalid');
  }
  if (!Value.Check(Snapshot, value))
    throw new McpError('INVALID_CATALOG', 'Stored MCP catalog is invalid');
  const tools = specTypeSchemas.ListToolsResult['~standard'].validate({ tools: value.tools });
  const resources = specTypeSchemas.ListResourcesResult['~standard'].validate({
    resources: value.resources,
  });
  const prompts = specTypeSchemas.ListPromptsResult['~standard'].validate({
    prompts: value.prompts,
  });
  if (tools.issues || resources.issues || prompts.issues)
    throw new McpError('INVALID_CATALOG', 'Stored MCP catalog is invalid');
  if (
    new Set(tools.value.tools.map((tool) => tool.name)).size !== tools.value.tools.length ||
    tools.value.tools.some((tool) => tool.name.length === 0 || tool.name.length > 128) ||
    new Set(resources.value.resources.map((resource) => resource.uri)).size !==
      resources.value.resources.length ||
    new Set(prompts.value.prompts.map((prompt) => prompt.name)).size !==
      prompts.value.prompts.length
  )
    throw new McpError(
      'INVALID_CATALOG',
      'Stored MCP catalog contains duplicate or invalid entries',
    );
  return deepFreeze({
    tools: tools.value.tools.map((tool) => discovered(tool, [])),
    resources: resources.value.resources,
    prompts: prompts.value.prompts,
  });
}
