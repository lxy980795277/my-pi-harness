import { registerSearchRoutes } from '../search/routes';
import { registerMemoryRoutes } from '../memory/routes';
import { registerRequestAccess } from './access';
import { registerRequestErrors } from './errors';
import type { FastifyInstance } from 'fastify';
import type { ApplicationServices } from '../application/services';
import { registerAuthRoutes } from '../auth/routes';
import { registerModelRoutes } from '../models/routes';
import { registerSessionRoutes } from '../sessions/routes';
import { registerSessionLogRoute } from '../sessions/log-route';
import { registerArtifactRoute } from '../sessions/artifact-route';
import { registerWorkspaceRoutes } from '../workspaces/routes';
import { registerToolRoutes } from '../tools/routes';
import { registerWorkRoutes } from '../work/routes';
import { registerAttachmentRoutes } from '../attachments/routes';
import { registerMcpRoutes } from '../mcp/routes';
import { registerSkillRoutes } from '../skills/routes';
import { registerPluginRoutes } from '../plugins/routes';
import { registerRemoteMcpRoutes } from '../mcp/remote-routes';
import { registerMcpOAuthLaunchRoutes } from '../mcp/oauth-launch-routes';
import { registerMcpDirectoryRoutes } from '../mcp/directory-routes';
import { registerMcpConfigurationRoutes } from '../mcp/configuration-routes';
import { registerConnectionRoutes } from '../connections/routes';
import { registerPluginConnectionRoutes } from '../plugin-connections/routes';
import { registerAgentRoutes } from '../agents/routes';

/** Install application routes; health and public process identity remain readable. */
export function registerApplicationRoutes(
  server: FastifyInstance,
  services: ApplicationServices,
): void {
  const { auth, login, gateway, runtime } = services;
  services.setOriginResolver(() => {
    const address = server.server.address();
    if (address === null || typeof address === 'string') throw new Error('Daemon is not listening');
    return `http://127.0.0.1:${address.port}`;
  });
  registerRequestAccess(server, services);
  registerRequestErrors(server);
  registerAuthRoutes(server, auth, login, services.githubCallbackUrl);
  registerModelRoutes(server, gateway);
  registerSessionRoutes(server, runtime, auth, gateway, services.workspaces);
  registerSessionLogRoute(server, services.store);
  registerArtifactRoute(server, runtime, services.store);
  registerWorkspaceRoutes(server, services.workspaces);
  registerToolRoutes(server, services.tools);
  registerWorkRoutes(server, services.work);
  registerAgentRoutes(server, services);
  registerMemoryRoutes(server, services.memory, services.store);
  registerSearchRoutes(server, services.search);
  registerAttachmentRoutes(server, services.attachments);
  registerMcpRoutes(server, services.mcp);
  registerRemoteMcpRoutes(server, services.remoteMcp, () => services.webOrigin());
  registerMcpOAuthLaunchRoutes(server, services);
  registerMcpDirectoryRoutes(server, services.mcp, services.remoteMcp);
  registerMcpConfigurationRoutes(server, services.mcp, services.remoteMcp);
  registerSkillRoutes(server, services.skills);
  registerPluginRoutes(server, services.plugins);
  registerPluginConnectionRoutes(server, services);
  registerConnectionRoutes(server, services.connections);
  server.addHook('preClose', async () => {
    await services.close();
  });
  server.addHook('onClose', async () => {
    await services.close();
  });
}
