import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { ModelGateway, SessionRuntime, ToolRuntime } from '@my-pi-harness/agent-runtime';
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

/** Resources have one daemon owner and close in dependency order. */
export interface ApplicationServices {
  store: ProfileStore;
  gateway: ModelGateway;
  runtime: SessionRuntime;
  auth: LocalAuth;
  workspaces: WorkspaceService;
  tools: ToolRuntime;
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
  const store = await openProfileStore(config.profileDirectory);
  let gateway: ModelGateway | undefined;
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
    const tools = new ToolRuntime({
      profileDirectory: config.profileDirectory,
      resolveWorkspace: (id) => workspaces.requireAvailable(id),
    });
    const runtime = new SessionRuntime({
      store,
      gateway,
      onError: options.onError ?? (() => undefined),
      tools,
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
    const ownedGateway = gateway;
    return {
      store,
      gateway: ownedGateway,
      runtime,
      auth,
      workspaces,
      tools,
      ...(github ? { github } : {}),
      close(): Promise<void> {
        closing ??= (async () => {
          const failures: unknown[] = [];
          for (const dispose of [
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
      await gateway?.close();
    } finally {
      store.close();
    }
    throw error;
  }
}
