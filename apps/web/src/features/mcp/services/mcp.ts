import { Type } from 'typebox';
import {
  McpServerViewSchema,
  McpToolCatalogSchema,
  McpTrustPreviewSchema,
  type McpControlInput,
  type McpScope,
  type McpScopeInput,
  type McpServerInput,
  type McpServerUpdate,
  type McpServerView,
  type McpToolCatalog,
  type McpTrustInput,
  type McpTrustPreview,
} from '@my-pi-harness/protocol';
import type { McpControlAction, McpDiscoveryAction } from '@/features/mcp/types/mcp';
import { getJson, requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

const serverPath = (id: string): string => {
  return `/mcp/servers/${encodeURIComponent(id)}`;
};

/** Reads safe configuration without starting an MCP process. */
export const fetchMcpServers = async (signal: AbortSignal): Promise<McpServerView[]> => {
  return parseResponse(Type.Array(McpServerViewSchema), await getJson('/mcp/servers', signal));
};

/** Creates a disabled server; startup always requires a separate trust action. */
export const createMcpServer = async (
  input: McpServerInput,
  signal: AbortSignal,
): Promise<McpServerView> => {
  return parseResponse(
    McpServerViewSchema,
    await requestJson('/mcp/servers', 'POST', input, signal),
  );
};

/** Saves the observed configuration revision without replacing secrets. */
export const updateMcpServer = async (
  id: string,
  input: McpServerUpdate,
  signal: AbortSignal,
): Promise<McpServerView> => {
  return parseResponse(
    McpServerViewSchema,
    await requestJson(serverPath(id), 'PUT', input, signal),
  );
};

/** Deletes only the explicitly confirmed configuration revision. */
export const deleteMcpServer = async (
  server: McpServerView,
  signal: AbortSignal,
): Promise<void> => {
  await requestJson(serverPath(server.id), 'DELETE', { expectedRevision: server.revision }, signal);
};

/** Resolves the exact startup scope without executing the configured program. */
export const previewMcpTrust = async (
  id: string,
  input: McpScopeInput,
  signal: AbortSignal,
): Promise<McpTrustPreview> => {
  return parseResponse(
    McpTrustPreviewSchema,
    await requestJson(`${serverPath(id)}/trust-preview`, 'POST', input, signal),
  );
};

/** Grants only the previewed startup fingerprint and isolation scope. */
export const trustMcpServer = async (
  id: string,
  input: McpTrustInput,
  signal: AbortSignal,
): Promise<McpServerView> => {
  return parseResponse(
    McpServerViewSchema,
    await requestJson(`${serverPath(id)}/trust`, 'POST', input, signal),
  );
};

/** Revocation is explicit and may stop active connections. */
export const controlMcpServer = async (
  id: string,
  action: McpControlAction,
  input: McpControlInput,
  signal: AbortSignal,
): Promise<McpServerView> => {
  return parseResponse(
    McpServerViewSchema,
    await requestJson(`${serverPath(id)}/${action}`, 'POST', input, signal),
  );
};

/** Discovery and diagnostics may start a trusted local program, only after a user action. */
export const discoverMcpTools = async (
  id: string,
  action: McpDiscoveryAction,
  input: McpScopeInput,
  signal: AbortSignal,
): Promise<McpToolCatalog> => {
  return parseResponse(
    McpToolCatalogSchema,
    await requestJson(`${serverPath(id)}/${action}`, 'POST', input, signal, 45_000),
  );
};

/** Reads a cached catalog; a missing catalog never triggers discovery. */
export const fetchMcpTools = async (
  id: string,
  scope: McpScope,
  signal: AbortSignal,
): Promise<McpToolCatalog | null> => {
  return parseResponse(
    Type.Union([McpToolCatalogSchema, Type.Null()]),
    await getJson(`${serverPath(id)}/tools?scope=${scope}`, signal),
  );
};

/** Writes a local-only secret directly, outside Query mutation variables and caches. */
export const writeMcpSecret = async (
  server: McpServerView,
  slotId: string,
  value: string,
  signal: AbortSignal,
): Promise<void> => {
  parseResponse(
    McpServerViewSchema,
    await requestJson(
      `${serverPath(server.id)}/secrets/${encodeURIComponent(slotId)}`,
      'POST',
      { expectedRevision: server.revision, value },
      signal,
    ),
  );
};

/** Deleting a credential also invalidates the corresponding active authorization. */
export const deleteMcpSecret = async (
  server: McpServerView,
  slotId: string,
  signal: AbortSignal,
): Promise<void> => {
  await requestJson(
    `${serverPath(server.id)}/secrets/${encodeURIComponent(slotId)}`,
    'DELETE',
    { expectedRevision: server.revision, expectedAccessEpoch: server.accessEpoch },
    signal,
  );
};
