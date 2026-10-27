import { randomUUID } from 'node:crypto';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import type {
  CredentialStore,
  McpIdentity,
  StoredPlugin,
  StoredRemoteMcpServer,
} from '@my-pi-harness/storage';
import { pluginAppConfiguration, pluginEndpointMatches } from '../plugins/app-catalog.js';

export interface ServiceCredentialAuthority {
  accessEpoch: number;
  ownerId: string;
  identityEpoch: number;
}
export interface PluginTokenPort {
  authority(id: string): ServiceCredentialAuthority;
  read(id: string, signal: AbortSignal): Promise<string>;
}
export interface ConnectionTokenPort {
  authority(id: string, endpoint: string): ServiceCredentialAuthority & { connectionId: string };
  read(id: string, endpoint: string, signal: AbortSignal): Promise<string>;
}

/** A plugin token is usable only by the exact provider and App endpoint declared by its owner. */
export function pluginCredentialId(server: StoredRemoteMcpServer): string | undefined {
  const owner = server.pluginOwner;
  if (owner === undefined) return undefined;
  const configuration = pluginAppConfiguration(owner.componentId);
  if (
    configuration.serviceId !== owner.pluginId ||
    !pluginEndpointMatches(server.endpoint, configuration.endpoint)
  )
    throw new RuntimeError('MCP_PLUGIN_TARGET', '插件应用只能使用声明的服务地址。');
  if (configuration.credentialSource !== 'plugin-oauth') return undefined;
  return owner.pluginId;
}

export function pluginAppAvailable(
  server: StoredRemoteMcpServer,
  plugins: readonly StoredPlugin[],
): boolean {
  const owner = server.pluginOwner;
  if (owner === undefined) return true;
  const plugin = plugins.find((entry) => entry.id === owner.pluginId);
  return (
    plugin?.enabled === true &&
    plugin.components.some(
      (entry) =>
        entry.id === owner.componentId &&
        entry.kind === 'app' &&
        entry.enabled &&
        entry.referenceId === server.id,
    )
  );
}

/** Public authority snapshots contain an epoch and account identifier, never credential material. */
export function connectionAuthority(
  server: StoredRemoteMcpServer,
  identity: McpIdentity,
  plugins: PluginTokenPort | undefined,
  connections: ConnectionTokenPort | undefined,
): ServiceCredentialAuthority & { connectionId: string } {
  const pluginId = pluginCredentialId(server);
  let authority: ServiceCredentialAuthority & { connectionId: string };
  if (pluginId !== undefined) {
    if (plugins === undefined)
      throw new RuntimeError('MCP_CONNECTION_UNAVAILABLE', '插件授权服务不可用。');
    authority = { ...plugins.authority(pluginId), connectionId: `plugin:${pluginId}` };
  } else {
    if (server.connectionId === undefined || connections === undefined)
      throw new RuntimeError('MCP_CONNECTION_UNAVAILABLE', '服务连接不可用。');
    authority = connections.authority(server.connectionId, server.endpoint);
  }
  if (authority.ownerId !== identity.ownerId || authority.identityEpoch !== identity.epoch)
    throw new RuntimeError('MCP_IDENTITY_REQUIRED', '服务连接身份不匹配。');
  return authority;
}

/** Refresh before binding; endpoint and ownership checks happen before any credential read. */
export async function serviceToken(
  server: StoredRemoteMcpServer,
  identity: McpIdentity,
  plugins: PluginTokenPort | undefined,
  connections: ConnectionTokenPort | undefined,
  signal: AbortSignal,
): Promise<string | undefined> {
  const pluginId = pluginCredentialId(server);
  if (pluginId !== undefined && plugins !== undefined) {
    connectionAuthority(server, identity, plugins, connections);
    return await plugins.read(pluginId, signal);
  }
  if (server.connectionId !== undefined && connections !== undefined) {
    connectionAuthority(server, identity, plugins, connections);
    return await connections.read(server.connectionId, server.endpoint, signal);
  }
  if (pluginId !== undefined || server.connectionId !== undefined)
    throw new RuntimeError('MCP_CONNECTION_UNAVAILABLE', '服务连接不可用。');
  return undefined;
}

/** The explicit App switch grants startup trust to its fixed installed target. */
export function pluginStartupGrant(
  server: StoredRemoteMcpServer,
  pluginId: string,
  componentId: string,
  identity: McpIdentity,
  fingerprint: string,
): NonNullable<StoredRemoteMcpServer['grant']> {
  const configuration = pluginAppConfiguration(componentId);
  if (
    configuration.serviceId !== pluginId ||
    !pluginEndpointMatches(server.endpoint, configuration.endpoint)
  )
    throw new RuntimeError('MCP_PLUGIN_TARGET', '插件应用地址已改变。');
  return {
    id: randomUUID(),
    ownerId: identity.ownerId,
    identityEpoch: identity.epoch,
    fingerprint,
  };
}

/** Collect configured secret headers and redaction values without exposing credential references. */
export async function readMcpHeaders(
  server: StoredRemoteMcpServer,
  credentials: Pick<CredentialStore, 'read'>,
): Promise<{ headers: Record<string, string>; secrets: string[] }> {
  const headers = { ...server.publicHeaders };
  const secrets: string[] = [];
  for (const slot of server.secretBindings) {
    if (slot.credentialRef === null)
      throw new RuntimeError('MCP_CREDENTIAL_REQUIRED', '请先配置所有秘密请求头。');
    const value = await credentials.read(slot.credentialRef);
    if (value === undefined)
      throw new RuntimeError('MCP_CREDENTIAL_REQUIRED', '系统凭据不存在，请重新配置。');
    headers[slot.headerName] = value;
    secrets.push(value);
    if (slot.headerName.toLowerCase() === 'authorization') {
      const token = /^(?:Bearer|Basic)\s+(.+)$/i.exec(value)?.[1];
      if (token !== undefined) secrets.push(token);
    }
  }
  return { headers, secrets };
}
