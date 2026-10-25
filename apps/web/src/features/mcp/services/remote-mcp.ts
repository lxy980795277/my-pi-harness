import { Type } from 'typebox';
import {
  RemoteMcpViewSchema,
  McpImportPreviewSchema,
  RemoteMcpTrustPreviewSchema,
  RemoteMcpDraftTestResultSchema,
  McpToolCatalogSchema,
  McpMetadataSchema,
  McpImportDocumentSchema,
  McpReadOnlyGrantViewSchema,
  type RemoteMcpView,
  type McpImportPreview,
  type RemoteMcpTrustPreview,
  type RemoteMcpInput,
  type RemoteMcpUpdate,
  type RemoteMcpDraftTestInput,
  type RemoteMcpDraftTestResult,
  type McpControlInput,
  type McpToolCatalog,
  type McpMetadata,
  type McpScope,
  type McpImportDocument,
  type McpReadOnlyGrantView,
  type McpToolView,
} from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { getJson, requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';
import type { McpManagementTransport } from '@/features/mcp/types/mcp';
export const managementPath = (id: string, transport: McpManagementTransport): string => {
  let prefix = 'servers';
  if (transport === 'remote') {
    prefix = 'remote-servers';
  }
  return `/mcp/${prefix}/${encodeURIComponent(id)}`;
};
export const fetchRemoteMcpServers = async (signal: AbortSignal): Promise<RemoteMcpView[]> => {
  return parseResponse(
    Type.Array(RemoteMcpViewSchema),
    await getJson('/mcp/remote-servers', signal),
  );
};
export const createRemoteMcp = async (
  input: RemoteMcpInput,
  signal: AbortSignal,
): Promise<RemoteMcpView> => {
  return parseResponse(
    RemoteMcpViewSchema,
    await requestJson('/mcp/remote-servers', 'POST', input, signal),
  );
};
export const updateRemoteMcp = async (
  id: string,
  input: RemoteMcpUpdate,
  signal: AbortSignal,
): Promise<RemoteMcpView> => {
  return parseResponse(
    RemoteMcpViewSchema,
    await requestJson(managementPath(id, 'remote'), 'PUT', input, signal),
  );
};
export const remoteMcpAction = async (
  server: RemoteMcpView,
  action: string,
  signal: AbortSignal,
): Promise<unknown> => {
  const input: McpControlInput = {
    expectedRevision: server.revision,
    expectedAccessEpoch: server.accessEpoch,
  };
  return await requestJson(
    `${managementPath(server.id, 'remote')}/${action}`,
    'POST',
    input,
    signal,
    45000,
  );
};
export const previewRemoteMcpTrust = async (
  server: RemoteMcpView,
  signal: AbortSignal,
): Promise<RemoteMcpTrustPreview> => {
  return parseResponse(
    RemoteMcpTrustPreviewSchema,
    await remoteMcpAction(server, 'trust-preview', signal),
  );
};
export const trustRemoteMcp = async (
  server: RemoteMcpView,
  fingerprint: string,
  signal: AbortSignal,
): Promise<void> => {
  await requestJson(
    `${managementPath(server.id, 'remote')}/trust`,
    'POST',
    { expectedRevision: server.revision, expectedAccessEpoch: server.accessEpoch, fingerprint },
    signal,
  );
};
export const fetchManagedMcpTools = async (
  id: string,
  transport: McpManagementTransport,
  scope: McpScope,
  signal: AbortSignal,
): Promise<McpToolCatalog | null> => {
  let suffix = '';
  if (transport === 'stdio') {
    suffix = `?scope=${scope}`;
  }
  return parseResponse(
    Type.Union([McpToolCatalogSchema, Type.Null()]),
    await getJson(`${managementPath(id, transport)}/tools${suffix}`, signal),
  );
};
export const fetchMcpMetadata = async (
  id: string,
  transport: McpManagementTransport,
  scope: McpScope,
  signal: AbortSignal,
): Promise<McpMetadata | null> => {
  let suffix = '';
  if (transport === 'stdio') {
    suffix = `?scope=${scope}`;
  }
  return parseResponse(
    Type.Union([McpMetadataSchema, Type.Null()]),
    await getJson(`${managementPath(id, transport)}/metadata${suffix}`, signal),
  );
};
export const fetchReadOnlyGrants = async (
  id: string,
  transport: McpManagementTransport,
  signal: AbortSignal,
): Promise<McpReadOnlyGrantView[]> => {
  return parseResponse(
    Type.Array(McpReadOnlyGrantViewSchema),
    await getJson(`${managementPath(id, transport)}/readonly-grants`, signal),
  );
};
export const setManagedTool = async (
  id: string,
  transport: McpManagementTransport,
  revision: number,
  accessEpoch: number,
  tool: McpToolView,
  enabled: boolean,
  signal: AbortSignal,
): Promise<void> => {
  await requestJson(
    `${managementPath(id, transport)}/tool-control`,
    'POST',
    {
      expectedRevision: revision,
      expectedAccessEpoch: accessEpoch,
      remoteToolName: tool.remoteToolName,
      enabled,
    },
    signal,
  );
};
export const grantManagedReadOnly = async (
  id: string,
  transport: McpManagementTransport,
  accessEpoch: number,
  tool: McpToolView,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<void> => {
  await requestJson(
    `${managementPath(id, transport)}/readonly-grants`,
    'POST',
    {
      serverId: id,
      serverRevision: tool.serverRevision,
      remoteToolName: tool.remoteToolName,
      definitionFingerprint: tool.definitionFingerprint,
      expectedAccessEpoch: accessEpoch,
      arguments: args,
    },
    signal,
  );
};
export const revokeManagedReadOnly = async (
  id: string,
  transport: McpManagementTransport,
  grantId: string,
  signal: AbortSignal,
): Promise<void> => {
  await requestJson(
    `${managementPath(id, transport)}/readonly-grants/${encodeURIComponent(grantId)}`,
    'DELETE',
    {},
    signal,
  );
};
export const writeRemoteMcpSecret = async (
  server: RemoteMcpView,
  slotId: string,
  value: string,
  signal: AbortSignal,
): Promise<RemoteMcpView> => {
  let path = `${managementPath(server.id, 'remote')}/secrets/${encodeURIComponent(slotId)}`;
  if (slotId === '__oauth_client_secret__') {
    path = `${managementPath(server.id, 'remote')}/oauth/client-secret`;
  }
  return parseResponse(
    RemoteMcpViewSchema,
    await requestJson(path, 'POST', { expectedRevision: server.revision, value }, signal),
  );
};

/** Probe a draft without saving configuration or reusing a stored credential. */
export const testRemoteMcpDraft = async (
  input: RemoteMcpDraftTestInput,
  signal: AbortSignal,
): Promise<RemoteMcpDraftTestResult> => {
  return parseResponse(
    RemoteMcpDraftTestResultSchema,
    await requestJson('/mcp/remote-servers/test-draft', 'POST', input, signal, 35000),
  );
};

/** Explicitly test an already authorized saved configuration using its current revision. */
export const testSavedRemoteMcp = async (
  server: RemoteMcpView,
  signal: AbortSignal,
): Promise<McpToolCatalog> => {
  return parseResponse(McpToolCatalogSchema, await remoteMcpAction(server, 'test', signal));
};
export const removeRemoteMcp = async (
  server: RemoteMcpView,
  signal: AbortSignal,
): Promise<void> => {
  await requestJson(
    managementPath(server.id, 'remote'),
    'DELETE',
    { expectedRevision: server.revision },
    signal,
  );
};
export const fetchMcpConfiguration = async (signal: AbortSignal): Promise<McpImportDocument> => {
  return parseResponse(McpImportDocumentSchema, await getJson('/mcp/configuration/export', signal));
};
export const importMcpConfiguration = async (
  encoded: string,
  preview: boolean,
  signal: AbortSignal,
): Promise<McpImportPreview> => {
  const value: unknown = JSON.parse(encoded);
  if (!Value.Check(McpImportDocumentSchema, value)) {
    throw new Error('导入JSON字段无效。');
  }
  let action = 'import';
  if (preview) {
    action = 'preview';
  }
  return parseResponse(
    McpImportPreviewSchema,
    await requestJson(`/mcp/configuration/${action}`, 'POST', value, signal),
  );
};

export const deleteRemoteMcpSecret = async (
  server: RemoteMcpView,
  slotId: string,
  signal: AbortSignal,
): Promise<void> => {
  let path = `${managementPath(server.id, 'remote')}/secrets/${encodeURIComponent(slotId)}`;
  if (slotId === '__oauth_client_secret__') {
    path = `${managementPath(server.id, 'remote')}/oauth/client-secret`;
  }
  await requestJson(
    path,
    'DELETE',
    { expectedRevision: server.revision, expectedAccessEpoch: server.accessEpoch },
    signal,
  );
};
