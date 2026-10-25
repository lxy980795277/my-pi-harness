import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import {
  ModelGateway,
  ModelApprovalReviewer,
  SessionRuntime,
  ToolRuntime,
  WorkRuntime,
} from '@my-pi-harness/agent-runtime';
import {
  createSystemCredentialStore,
  openProfileStore,
  type CredentialStore,
  type ProfileStore,
} from '@my-pi-harness/storage';
import type { DaemonConfig } from './config.js';
import type { Question } from '@my-pi-harness/protocol';
import { LocalAuth } from './features/auth/local-auth.js';
import { GitHubIdentityProvider } from './features/auth/github-provider.js';
import { LoginService } from './features/auth/login-service.js';
import { WorkspaceService } from './features/workspaces/service.js';
import { AttachmentService } from './features/attachments/service.js';
import { McpService } from './features/mcp/service.js';
import type { McpManager } from './features/mcp/types.js';
import { RemoteMcpService } from './features/mcp/remote-service.js';
import { createExternalToolPorts } from './features/mcp/external-tools.js';
import { SkillsService } from './features/skills/service.js';
import { PluginService } from './features/plugins/service.js';
import { createPluginAppPort } from './features/plugins/apps.js';
import { ConnectionService } from './features/connections/service.js';
import type { SkillsPort } from '@my-pi-harness/agent-runtime';

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
  githubCallbackUrl: string | null;
  close(): Promise<void>;
}

/** Explicit test injection never alters production credential selection. */
export interface ServiceOptions {
  credentials?: CredentialStore;
  githubFetch?: typeof fetch;
  mcpManager?: McpManager;
  remoteFixtureOrigin?: string;
  connectionFixtureOrigin?: string;
  onError?: (error: unknown) => void;
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
  try {
    const profileDirectory = await realpath(config.profileDirectory);
    const credentials =
      options.credentials ?? (await createSystemCredentialStore(config.profileDirectory));
    const runtimeRef: { current?: SessionRuntime } = {};
    gateway = new ModelGateway({
      store,
      secrets: credentials,
      deviceId: createHash('sha256')
        .update(await realpath(config.profileDirectory))
        .digest('hex'),
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
    });
    const ownedSkills = skills;
    const skillPort: SkillsPort = {
      list: (workspaceId, signal) => ownedSkills.list(workspaceId, signal),
      freezeSelections: (workspaceId, selections, signal) =>
        ownedSkills.freezeSelections(workspaceId, selections, signal),
      validateBindings: (frozen, signal) => ownedSkills.validateBindings(frozen, signal),
      assertBindingsCurrent: (frozen) => ownedSkills.assertBindingsCurrent(frozen),
      retainBindings: (frozen) => ownedSkills.retainBindings(frozen),
      async loadResource(skill, path, signal) {
        const content = await ownedSkills.loadResource(skill, path, signal);
        const identity = {
          type: 'text' as const,
          text: JSON.stringify({ skill: skill.selection, path: content.path, hash: content.hash }),
        };
        if (content.type === 'image')
          return [identity, { type: 'image', data: content.data, mimeType: content.mimeType }];
        return [identity, { type: 'text', text: content.text }];
      },
    };
    connections = new ConnectionService({
      store,
      repository: store.connections,
      credentials,
      skills: ownedSkills,
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
    });
    const ownedPlugins = plugins;
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
      connectionGateway: ownedConnections,
      reviewer: new ModelApprovalReviewer({
        gateway: ownedGateway,
        context: (id) => {
          const snapshot = store.getSnapshot(id);
          const state = store.getWorkState(id, snapshot.session.activeBranchId);
          return {
            userRequests: snapshot.messages
              .filter((message) => message.role === 'user')
              .map(({ id: messageId, text }) => ({ messageId, text })),
            projectInstructions: state.rules.map(({ path, content }) => ({ path, content })),
            savedPlan: state.plan,
            savedSummary: state.compaction?.summary ?? null,
            answeredQuestions: answeredQuestions(state.questions),
          };
        },
      }),
    });
    const runtime = new SessionRuntime({
      store,
      gateway,
      onError: options.onError ?? (() => undefined),
      tools,
      work,
      externalTools,
      discovery: externalTools,
      skills: skillPort,
      connectionGateway: ownedConnections,
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
      githubCallbackUrl: config.githubCallbackUrl,
      close(): Promise<void> {
        closing ??= (async () => {
          const failures: unknown[] = [];
          ownedMcp.stopAccepting();
          ownedRemoteMcp.stopAccepting();
          ownedPlugins.stopAccepting();
          ownedConnections.stopAccepting();
          ownedWork.close();
          for (const dispose of [
            () => login.close(),
            () => ownedAttachments.close(),
            () => runtime.close(),
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
    try {
      work?.close();
      await attachments?.close();
      await mcp?.close();
      await remoteMcp?.close();
      await plugins?.close();
      await skills?.close();
      await gateway?.close();
    } finally {
      store.close();
    }
    throw error;
  }
}

function answeredQuestions(questions: readonly Question[]) {
  return questions
    .filter((question) => question.status === 'answered')
    .flatMap((request) =>
      request.questions.map((question) => {
        const response = request.answers?.find((answer) => answer.questionId === question.id);
        if (response === undefined) return { prompt: question.prompt, answer: '' };
        const parts = question.options
          .filter((option) => response.optionIds.includes(option.id))
          .map((option) => option.label);
        if (response.text) parts.push(response.text);
        return { prompt: question.prompt, answer: parts.filter(Boolean).join('；') };
      }),
    );
}
