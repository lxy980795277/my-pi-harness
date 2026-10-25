import { SkillError } from '@my-pi-harness/integrations';
import type { RemoteMcpService } from '../mcp/remote-service.js';
import type { PluginAppPort } from './service.js';

/** Fixed official endpoints are configuration; installation does not connect, grant trust or send data. */
const endpoints: Readonly<Record<string, string>> = {
  github: 'https://api.githubcopilot.com/mcp/',
  'google-drive': 'https://drivemcp.googleapis.com/mcp/v1',
  'google-docs': 'https://docsmcp.googleapis.com/mcp/v1',
  'google-sheets': 'https://sheetsmcp.googleapis.com/mcp/v1',
  'google-slides': 'https://slidesmcp.googleapis.com/mcp/v1',
  'google-calendar': 'https://calendarmcp.googleapis.com/mcp/v1',
  vercel: 'https://mcp.vercel.com',
  notion: 'https://mcp.notion.com/mcp',
  supabase: 'https://mcp.supabase.com/mcp',
};

/** Persistent ownership is checked by IDs, including rollback before a plugin record exists. */
export function createPluginAppPort(remote: RemoteMcpService): PluginAppPort {
  const owned = (pluginId: string, componentId: string, referenceId: string) => {
    if (!remote.owns(referenceId)) return undefined;
    if (!remote.ownedBy(referenceId, pluginId, componentId))
      throw new SkillError('PLUGIN_APP_OWNER', 'Plugin does not own this MCP configuration');
    return remote.get(referenceId);
  };
  return {
    install(pluginId, app, signal) {
      signal.throwIfAborted();
      const endpoint = endpoints[app.id];
      if (endpoint === undefined)
        throw new SkillError('PLUGIN_APP_UNKNOWN', 'Plugin App endpoint is not registered');
      return Promise.resolve(
        remote.create(
          {
            name: app.name,
            transport: 'streamable-http',
            endpoint,
            publicHeaders: {},
            secretHeaders: [],
            oauth: true,
          },
          { pluginId, componentId: app.id },
        ).id,
      );
    },
    async setEnabled(pluginId, componentId, referenceId, enabled) {
      const server = owned(pluginId, componentId, referenceId);
      if (server === undefined || enabled) return;
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
