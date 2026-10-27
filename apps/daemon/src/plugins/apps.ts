import { PluginError } from '@my-pi-harness/integrations';
import type { RemoteMcpService } from '../mcp/remote-service.js';
import type { PluginAppPort } from './service.js';
import { pluginAppConfiguration } from './app-catalog.js';

/** Persistent ownership is checked by IDs, including rollback before a plugin record exists. */
export function createPluginAppPort(remote: RemoteMcpService): PluginAppPort {
  const owned = (pluginId: string, componentId: string, referenceId: string) => {
    if (!remote.owns(referenceId)) return undefined;
    if (!remote.ownedBy(referenceId, pluginId, componentId))
      throw new PluginError('PLUGIN_APP_OWNER', 'Plugin does not own this MCP configuration');
    return remote.get(referenceId);
  };
  const install = (
    pluginId: string,
    app: Parameters<PluginAppPort['install']>[1],
    signal: AbortSignal,
  ): string => {
    signal.throwIfAborted();
    const configuration = pluginAppConfiguration(app.id);
    return remote.create(
      {
        name: app.name,
        transport: configuration.transport,
        endpoint: configuration.endpoint,
        publicHeaders: {},
        secretHeaders: [],
        oauth: configuration.credentialSource === 'mcp-oauth',
      },
      { pluginId, componentId: app.id },
    ).id;
  };
  return {
    refresh(id) {
      remote.schedulePluginApp(id);
      return Promise.resolve();
    },
    install(pluginId, app, signal) {
      return Promise.resolve(install(pluginId, app, signal));
    },
    async reconcile(pluginId, app, referenceId, enabled, signal) {
      signal.throwIfAborted();
      let server;
      if (referenceId !== undefined) server = owned(pluginId, app.id, referenceId);
      const ownedServers = remote
        .list()
        .filter((candidate) => remote.ownedBy(candidate.id, pluginId, app.id));
      if (ownedServers.length > 1)
        throw new PluginError(
          'PLUGIN_APP_OWNER',
          'Plugin App has more than one owned configuration',
        );
      if (server === undefined) server = ownedServers[0];
      if (server === undefined) server = remote.get(install(pluginId, app, signal));
      const configuration = pluginAppConfiguration(app.id);
      const pluginOAuth = configuration.credentialSource === 'plugin-oauth';
      if (
        server.transport !== configuration.transport ||
        server.endpoint !== configuration.endpoint ||
        server.oauth !== (configuration.credentialSource === 'mcp-oauth') ||
        (pluginOAuth && (server.connectionId !== undefined || server.secretHeaders.length > 0))
      )
        server = await remote.update(server.id, {
          expectedRevision: server.revision,
          name: app.name,
          transport: configuration.transport,
          endpoint: configuration.endpoint,
          publicHeaders: {},
          secretHeaders: [],
          oauth: configuration.credentialSource === 'mcp-oauth',
        });
      // Startup reconciliation never replaces revoked identity or target trust with a new grant.
      if (!enabled && server.enabled)
        await remote.disable(server.id, {
          expectedRevision: server.revision,
          expectedAccessEpoch: server.accessEpoch,
        });
      return server.id;
    },
    async setEnabled(pluginId, componentId, referenceId, enabled) {
      const server = owned(pluginId, componentId, referenceId);
      if (server === undefined) return;
      if (enabled) {
        remote.enablePluginApp(referenceId, pluginId, componentId);
        return;
      }
      await remote.disable(referenceId, {
        expectedRevision: server.revision,
        expectedAccessEpoch: server.accessEpoch,
      });
    },
    async remove(pluginId, componentId, referenceId) {
      const server = owned(pluginId, componentId, referenceId);
      if (server === undefined) return;
      await remote.remove(referenceId, server.revision);
    },
  };
}
