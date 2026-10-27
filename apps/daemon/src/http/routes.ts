import { registerRequestAccess } from './access.js';
import { registerRequestErrors } from './errors.js';
import type { FastifyInstance } from 'fastify';
import type { ApplicationServices } from '../application/services.js';
import { registerAuthRoutes } from '../auth/routes.js';
import { registerModelRoutes } from '../models/routes.js';
import { registerSessionRoutes } from '../sessions/routes.js';
import { registerSessionLogRoute } from '../sessions/log-route.js';
import { registerOfficeArtifactRoute } from '../sessions/artifact-route.js';
import { registerWorkspaceRoutes } from '../workspaces/routes.js';
import { registerToolRoutes } from '../tools/routes.js';
import { registerWorkRoutes } from '../work/routes.js';
import { registerAttachmentRoutes } from '../attachments/routes.js';
import { registerMcpRoutes } from '../mcp/routes.js';
import { registerSkillRoutes } from '../skills/routes.js';
import { registerPluginRoutes } from '../plugins/routes.js';
import { registerRemoteMcpRoutes } from '../mcp/remote-routes.js';
import { registerMcpOAuthLaunchRoutes } from '../mcp/oauth-launch-routes.js';
import { registerMcpDirectoryRoutes } from '../mcp/directory-routes.js';
import { registerMcpConfigurationRoutes } from '../mcp/configuration-routes.js';
import { registerConnectionRoutes } from '../connections/routes.js';
import { registerPluginConnectionRoutes } from '../plugin-connections/routes.js';

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
  registerOfficeArtifactRoute(server, runtime, services.workspaces);
  registerWorkspaceRoutes(server, services.workspaces);
  registerToolRoutes(server, services.tools);
  registerWorkRoutes(server, services.work);
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
