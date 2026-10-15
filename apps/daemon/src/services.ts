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
import { LocalAuth } from './features/auth/local-auth.js';
import { GitHubAuth } from './features/auth/github-auth.js';
import { WorkspaceService } from './features/workspaces/service.js';
import { AttachmentService } from './features/attachments/service.js';

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
  github?: GitHubAuth;
  close(): Promise<void>;
}

/** Explicit test injection never alters production credential selection. */
export interface ServiceOptions {
  credentials?: CredentialStore;
  githubFetch?: typeof fetch;
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
  try {
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
    const ownedGateway = gateway;
    const sessionRuntime = (): SessionRuntime => {
      if (!runtimeRef.current) throw new Error('Session runtime has not been initialized');
      return runtimeRef.current;
    };
    work = new WorkRuntime({
      store,
      gateway: ownedGateway,
      profileDirectory: config.profileDirectory,
      resolveWorkspace: (id) => workspaces.requireAvailable(id),
      command: (id, operation, allowActive) =>
        sessionRuntime().workCommand(id, operation, allowActive),
      commit: (id, events) => sessionRuntime().record(id, events),
    });
    attachments = new AttachmentService(store, workspaces, config.profileDirectory);
    const tools = new ToolRuntime({
      profileDirectory: config.profileDirectory,
      resolveWorkspace: (id) => workspaces.requireAvailable(id),
      work,
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
            answeredQuestions: state.questions
              .filter((question) => question.status === 'answered')
              .map(({ prompt, answer }) => ({ prompt, answer })),
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
    });
    runtimeRef.current = runtime;
    const auth = new LocalAuth({
      githubConfigured: config.githubClientId !== null,
      ...(config.ownerSecret ? { ownerSecret: config.ownerSecret } : {}),
      ...(config.developmentOrigin ? { developmentOrigin: config.developmentOrigin } : {}),
    });
    const github = config.githubClientId
      ? new GitHubAuth({
          clientId: config.githubClientId,
          ...(config.githubClientSecret ? { clientSecret: config.githubClientSecret } : {}),
          ...(options.githubFetch ? { fetch: options.githubFetch } : {}),
          onIdentity: (identity) => auth.setIdentity(identity),
        })
      : undefined;
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
      ...(github ? { github } : {}),
      close(): Promise<void> {
        closing ??= (async () => {
          const failures: unknown[] = [];
          ownedWork.close();
          for (const dispose of [
            () => ownedAttachments.close(),
            () => runtime.close(),
            () => ownedGateway.close(),
            () => github?.close(),
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
      await gateway?.close();
    } finally {
      store.close();
    }
    throw error;
  }
}
