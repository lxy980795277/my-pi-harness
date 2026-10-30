import { BUILTIN_PLUGIN_APPS, PluginError } from '@my-pi-harness/integrations';
import type {
  ConnectionServiceId,
  PluginManifest,
  RemoteMcpTransport,
} from '@my-pi-harness/protocol';

interface PluginAppConfiguration {
  id: string;
  serviceId: ConnectionServiceId;
  endpoint: string;
  transport: RemoteMcpTransport;
  credentialSource: NonNullable<PluginManifest['apps'][number]['credentialSource']>;
}

/** Exact component IDs connect plugin switches to validated resource declarations. */
const apps: readonly PluginAppConfiguration[] = BUILTIN_PLUGIN_APPS.map((app) => ({
  id: app.id,
  serviceId: app.provider,
  endpoint: app.endpoint,
  transport: app.transport,
  credentialSource: app.credentialSource,
}));

export function pluginAppConfiguration(id: string): PluginAppConfiguration {
  const app = apps.find((entry) => entry.id === id);
  if (app === undefined)
    throw new PluginError('PLUGIN_APP_UNKNOWN', 'Plugin App endpoint is not registered');
  return app;
}

/** Normalization permits only the official endpoint's optional trailing slash. */
export function pluginEndpointMatches(endpoint: string, expectedEndpoint: string): boolean {
  const actual = new URL(endpoint);
  const expected = new URL(expectedEndpoint);
  return (
    actual.origin === expected.origin &&
    actual.username === '' &&
    actual.password === '' &&
    actual.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '') &&
    actual.search === '' &&
    actual.hash === ''
  );
}

export function pluginEndpointComponent(serviceId: ConnectionServiceId, endpoint: string): string {
  const app = apps.find(
    (entry) => entry.serviceId === serviceId && pluginEndpointMatches(endpoint, entry.endpoint),
  );
  if (app === undefined)
    throw new PluginError('CONNECTION_ORIGIN_FORBIDDEN', '连接凭据只能用于对应服务的预置MCP地址。');
  return app.id;
}
