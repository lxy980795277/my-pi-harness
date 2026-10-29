import { createSkillsPort } from '../skills/runtime.js';
import { approvalContext } from '../tools/approval-context.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import {
  ModelGateway,
  ModelApprovalReviewer,
  SessionRuntime,
  ToolRuntime,
  WorkRuntime,
  type ToolSearchEmbedder,
} from '@my-pi-harness/agent-runtime';
import {
  createSystemCredentialStore,
  PluginCredentialStore,
  openProfileStore,
  type CredentialStore,
  type ProfileStore,
} from '@my-pi-harness/storage';
import type { DaemonConfig } from './config.js';
import { LocalAuth } from '../auth/local-auth.js';
import { GitHubIdentityProvider } from '../auth/github-provider.js';
import { LoginService } from '../auth/login-service.js';
import { WorkspaceService } from '../workspaces/service.js';
import { AttachmentService } from '../attachments/service.js';
import { McpService } from '../mcp/service.js';
import type { McpManager } from '../mcp/types.js';
import { RemoteMcpService } from '../mcp/remote-service.js';
import { createExternalToolPorts } from '../mcp/external-tools.js';
import { SkillsService } from '../skills/service.js';
import { PluginService } from '../plugins/service.js';
import { createPluginAppPort } from '../plugins/apps.js';
import { ConnectionService } from '../connections/service.js';
import { PluginConnectionService } from '../plugin-connections/service.js';
import { OAuthLaunchTickets } from '../http/oauth-launch-tickets.js';
import {
  PLUGIN_CONNECTION_DEFINITIONS,
  LocalToolSearchEmbedder,
  type RemoteMcpManager,
} from '@my-pi-harness/integrations';

/** Resources have one daemon owner and close in dependency order. */
export interface ApplicationServices {
  store: ProfileStore;
  gateway: ModelGateway;
  runtime: SessionRuntime;
  auth: LocalAuth;
  workspaces: WorkspaceService;
  tools: ToolRuntime;
  work: WorkRuntime;
  attachments: AttachmentService;
  login: LoginService;
  mcp: McpService;
  remoteMcp: RemoteMcpService;
  skills: SkillsService;
  plugins: PluginService;
  connections: ConnectionService;
  pluginConnections: PluginConnectionService;
  oauthLaunchTickets: OAuthLaunchTickets;
  pluginGatewayFetch: typeof fetch;
  authorizeSkillGateway(value: unknown): boolean;
  listenerOrigin(): string;
  webOrigin(): string;
  setOriginResolver(resolve: () => string): void;
  githubCallbackUrl: string | null;
  close(): Promise<void>;
}

/** Explicit test injection never alters production credential selection. */
export interface ServiceOptions {
  credentials?: CredentialStore;
  githubFetch?: typeof fetch;
  mcpManager?: McpManager;
  remoteFixtureOrigin?: string;
  remoteMcpManager?: RemoteMcpManager;
  connectionFixtureOrigin?: string;
  pluginGatewayFetch?: typeof fetch;
  onError?: (error: unknown) => void;
  toolSearchEmbedder?: ToolSearchEmbedder;
}

/** Acquire profile ownership before migrations, recovery or any possible model request. */
export async function createApplicationServices(
  config: DaemonConfig,
  options: ServiceOptions = {},
): Promise<ApplicationServices> {
  const store = await openProfileStore(config.profileDirectory, {
    sessionLogRoot: config.sessionLogRoot,
  });
  let gateway: ModelGateway | undefined;
  let attachments: AttachmentService | undefined;
  let work: WorkRuntime | undefined;
  let mcp: McpService | undefined;
  let remoteMcp: RemoteMcpService | undefined;
  let skills: SkillsService | undefined;
  let plugins: PluginService | undefined;
  let connections: ConnectionService | undefined;
  let pluginConnections: PluginConnectionService | undefined;
  let toolSearchEmbedder: LocalToolSearchEmbedder | undefined;
  let resolveOrigin = (): string => `http://127.0.0.1:${config.port}`;
  const listenerOrigin = (): string => resolveOrigin();
  const webOrigin = (): string => config.developmentOrigin ?? listenerOrigin();
  const gatewayToken = randomBytes(32).toString('base64url');
  let oauthLaunchTickets: OAuthLaunchTickets | undefined;
  try {
    const profileDirectory = await realpath(config.profileDirectory);
    const credentials =
      options.credentials ?? (await createSystemCredentialStore(config.profileDirectory));
    const runtimeRef: { current?: SessionRuntime } = {};
    gateway = new ModelGateway({
      store,
      secrets: credentials,
      deviceId: createHash('sha256').update(profileDirectory).digest('hex'),
      isProviderActive: (id) => runtimeRef.current?.isProviderActive(id) ?? false,
    });
    await gateway.initialize();
    const workspaces = new WorkspaceService(store, config.profileDirectory);
    mcp = new McpService({
      store,
      credentials,
      profileDirectory,
      resolveWorkspace: (id) => workspaces.requireAvailable(id),
      ...(options.mcpManager === undefined ? {} : { manager: options.mcpManager }),
    });
    const ownedMcp = mcp;
    remoteMcp = new RemoteMcpService({
      store,
      repository: store.remoteMcp,
      credentials,
      ...(options.remoteMcpManager === undefined ? {} : { manager: options.remoteMcpManager }),
      ...(options.onError === undefined
        ? {}
        : {
            onBackgroundError: (diagnostic) => {
              const error = new Error(`Plugin App discovery failed: ${diagnostic.serverId}`);
              error.name = diagnostic.code;
              options.onError?.(error);
            },
          }),
      pluginToken: {
        authority(id) {
          if (!pluginConnections) throw new Error('Plugin connections have not been initialized');
          return pluginConnections.authority(id);
        },
        async read(id, signal) {
          if (!pluginConnections) throw new Error('Plugin connections have not been initialized');
          return await pluginConnections.readToken(id, signal);
        },
      },
      connectionToken: {
        authority(id, endpoint) {
          if (!connections) throw new Error('Connections have not been initialized');
          return connections.authority(id, endpoint);
        },
        async read(id, endpoint, signal) {
          if (!connections) throw new Error('Connections have not been initialized');
          return await connections.read(id, endpoint, signal);
        },
      },
      ...(options.remoteFixtureOrigin ? { fixtureOrigin: options.remoteFixtureOrigin } : {}),
    });
    const ownedRemoteMcp = remoteMcp;
    const externalTools = createExternalToolPorts(ownedMcp, ownedRemoteMcp);
    skills = new SkillsService({
      repository: store.extensions,
      profileDirectory,
      resolveWorkspace: (id) => workspaces.requireAvailable(id),
      pluginGatewayUrl: (id) =>
        PLUGIN_CONNECTION_DEFINITIONS.some((entry) => entry.id === id)
          ? `${listenerOrigin()}/api/skill-gateway/${id}`
          : undefined,
    });
    const ownedSkills = skills;
    const skillPort = createSkillsPort(ownedSkills);
    connections = new ConnectionService({
      store,
      repository: store.connections,
      credentials,
      onInvalidated: (id) => ownedRemoteMcp.invalidateConnection(id),
      ...(options.connectionFixtureOrigin
        ? { fixtureOrigin: options.connectionFixtureOrigin }
        : {}),
    });
    const ownedConnections = connections;
    plugins = new PluginService({
      repository: store.extensions,
      profileDirectory,
      skills: ownedSkills,
      apps: createPluginAppPort(ownedRemoteMcp),
      onRemoved: async (id) => {
        if (PLUGIN_CONNECTION_DEFINITIONS.some((definition) => definition.id === id))
          await pluginConnections?.disconnect(id);
      },
    });
    const ownedPlugins = plugins;
    pluginConnections = new PluginConnectionService({
      credentials: await PluginCredentialStore.open(
        join(profileDirectory, 'skill-credentials.json'),
      ),
      clients: config.skillOAuthClients ?? {},
      installed: (id) => store.extensions.plugins().find((entry) => entry.id === id),
      identity: () => {
        const owner = store.auth.profileOwner();
        if (owner === undefined) throw new Error('Application identity is required');
        const identity = store.mcp.identity(owner.id);
        return { ownerId: identity.ownerId, epoch: identity.epoch };
      },
      origin: listenerOrigin,
      onChanged: (id) => ownedRemoteMcp.invalidatePlugin(id),
      ...(options.connectionFixtureOrigin === undefined
        ? {}
        : { fixtureOrigin: options.connectionFixtureOrigin }),
    });
    const ownedPluginConnections = pluginConnections;
    await ownedPlugins.synchronize(new AbortController().signal);
    ownedRemoteMcp.initializeCatalogs();
    toolSearchEmbedder = new LocalToolSearchEmbedder({
      cacheDirectory: join(profileDirectory, 'models'),
    });
    oauthLaunchTickets = new OAuthLaunchTickets((target, id) => {
      const owner = store.auth.profileOwner();
      if (owner === undefined) throw new Error('Application identity is required');
      const identity = store.mcp.identity(owner.id);
      if (target === 'mcp') {
        const server = ownedRemoteMcp.get(id);
        if (!server.enabled || !server.trusted || !server.oauth)
          throw new Error('MCP OAuth is unavailable');
        return JSON.stringify([identity, id, server.revision, server.accessEpoch]);
      }
      const installed = store.extensions.plugins().find((entry) => entry.id === id);
      if (installed === undefined) throw new Error('Plugin is not installed');
      return JSON.stringify([identity, id, installed.generation, installed.revision]);
    });
    const ownedLaunchTickets = oauthLaunchTickets;
    const ownedGateway = gateway;
    const sessionRuntime = (): SessionRuntime => {
      if (!runtimeRef.current) throw new Error('Session runtime has not been initialized');
      return runtimeRef.current;
    };
    work = new WorkRuntime({
      store,
      gateway: ownedGateway,
      profileDirectory,
      resolveWorkspace: (id) => workspaces.requireAvailable(id),
      command: (id, operation, allowActive) =>
        sessionRuntime().workCommand(id, operation, allowActive),
      commit: (id, events) => sessionRuntime().record(id, events),
    });
    attachments = new AttachmentService(store, workspaces, config.profileDirectory);
    const tools = new ToolRuntime({
      ...(config.officePythonPath ? { officePythonPath: config.officePythonPath } : {}),
      profileDirectory,
      resolveWorkspace: (id) => workspaces.requireAvailable(id),
      work,
      externalTools,
      skillGateway: {
        get origin() {
          return listenerOrigin();
        },
        token: gatewayToken,
      },
      reviewer: new ModelApprovalReviewer({
        gateway: ownedGateway,
        context: (id, taskId) => approvalContext(store, id, taskId),
      }),
    });
    const runtime = new SessionRuntime({
      store,
      agentStore: store,
      gateway,
      onError: options.onError ?? (() => undefined),
      tools,
      work,
      externalTools,
      discovery: externalTools,
      skills: skillPort,
      toolSearchEmbedder: options.toolSearchEmbedder ?? toolSearchEmbedder,
    });
    runtimeRef.current = runtime;
    const login = new LoginService([
      new GitHubIdentityProvider(
        config.githubClientId,
        options.githubFetch,
        config.githubClientSecret,
      ),
    ]);
    const auth = new LocalAuth({
      store: store.auth,
      providers: () => login.listProviders(),
      ...(config.ownerSecret ? { ownerSecret: config.ownerSecret } : {}),
      ...(config.developmentOrigin ? { developmentOrigin: config.developmentOrigin } : {}),
      ...(config.githubCallbackUrl
        ? { callbackOrigin: new URL(config.githubCallbackUrl).origin }
        : {}),
      pluginCallbackUrls: [
        ...Object.values(config.skillOAuthClients ?? {}).flatMap((client) =>
          client.callbackUrl === undefined ? [] : [client.callbackUrl],
        ),
        ...PLUGIN_CONNECTION_DEFINITIONS.flatMap((definition) =>
          definition.oauth.callbackUrl === undefined ? [] : [definition.oauth.callbackUrl],
        ),
      ],
    });
    let closing: Promise<void> | undefined;
    const ownedAttachments = attachments;
    const ownedWork = work;
    return {
      store,
      gateway: ownedGateway,
      runtime,
      auth,
      workspaces,
      tools,
      work: ownedWork,
      attachments: ownedAttachments,
      login,
      mcp: ownedMcp,
      remoteMcp: ownedRemoteMcp,
      skills: ownedSkills,
      plugins: ownedPlugins,
      connections: ownedConnections,
      pluginConnections: ownedPluginConnections,
      oauthLaunchTickets: ownedLaunchTickets,
      pluginGatewayFetch: options.pluginGatewayFetch ?? fetch,
      authorizeSkillGateway(value): boolean {
        if (typeof value !== 'string') return false;
        const expected = Buffer.from(gatewayToken);
        const actual = Buffer.from(value);
        return actual.length === expected.length && timingSafeEqual(actual, expected);
      },
      listenerOrigin,
      webOrigin,
      setOriginResolver(resolve): void {
        resolveOrigin = resolve;
      },
      githubCallbackUrl: config.githubCallbackUrl,
      close(): Promise<void> {
        closing ??= (async () => {
          const failures: unknown[] = [];
          ownedMcp.stopAccepting();
          ownedLaunchTickets.close();
          ownedRemoteMcp.stopAccepting();
          ownedPlugins.stopAccepting();
          ownedConnections.stopAccepting();
          ownedWork.close();
          for (const dispose of [
            () => login.close(),
            () => ownedPluginConnections.close(),
            () => ownedAttachments.close(),
            () => runtime.close(),
            async () => await toolSearchEmbedder?.close(),
            () => ownedMcp.close(),
            () => ownedRemoteMcp.close(),
            () => ownedConnections.close(),
            () => ownedPlugins.close(),
            () => ownedSkills.close(),
            () => ownedGateway.close(),
          ]) {
            try {
              await dispose();
            } catch (error: unknown) {
              failures.push(error);
            }
          }
          auth.close();
          try {
            store.close();
          } catch (error: unknown) {
            failures.push(error);
          }
          if (failures.length) throw new AggregateError(failures, 'Application shutdown failed');
        })();
        return closing;
      },
    };
  } catch (error: unknown) {
    const failures: unknown[] = [error];
    for (const dispose of [
      () => work?.close(),
      async () => await attachments?.close(),
      async () => await pluginConnections?.close(),
      async () => await toolSearchEmbedder?.close(),
      async () => await connections?.close(),
      async () => await mcp?.close(),
      async () => await remoteMcp?.close(),
      async () => await plugins?.close(),
      async () => await skills?.close(),
      async () => await gateway?.close(),
      () => store.close(),
    ]) {
      try {
        await dispose();
      } catch (cleanupError: unknown) {
        failures.push(cleanupError);
      }
    }
    if (failures.length > 1)
      throw new AggregateError(failures, 'Application startup and cleanup failed');
    throw error;
  }
}
