import {
  SkillError,
  beginPluginOAuth,
  pluginConnectionDefinition,
  pluginOAuthFetch,
  refreshPluginOAuth,
  type PluginConnectionDefinition,
  type PluginOAuthClients,
  type PluginOAuthClient,
  type PluginOAuthFetch,
  type PluginOAuthFlow,
} from '@my-pi-harness/integrations';
import type { SkillConnectionStatus, SkillOAuthStart } from '@my-pi-harness/protocol';
import type { PluginCredentialStore, PluginOAuthCredential } from '@my-pi-harness/storage';

interface Installation {
  generation: string;
  revision: number;
  enabled: boolean;
}
interface Identity {
  ownerId: string;
  epoch: number;
}
interface Ownership {
  installation: Installation;
  identity: Identity;
  epoch: number;
}
interface Pending {
  pluginId: string;
  ownership: Ownership;
  flow: PluginOAuthFlow;
  expiresAt: number;
  controller: AbortController;
  timer: NodeJS.Timeout;
}
export interface PluginConnectionServiceOptions {
  credentials: PluginCredentialStore;
  clients: PluginOAuthClients;
  installed(id: string): Installation | undefined;
  identity(): Identity;
  origin(): string;
  onChanged?(id: string): Promise<void>;
  fixtureOrigin?: string;
  request?: PluginOAuthFetch;
}

/** One plugin authorization supplies both its HTTP gateway and independently enabled MCP Apps. */
export class PluginConnectionService {
  private readonly pending = new Map<string, Pending>();
  private readonly authorizing = new Map<string, Pending>();
  private readonly epochs = new Map<string, number>();
  private readonly refreshing = new Map<string, Promise<PluginOAuthCredential>>();
  private readonly operations = new Set<Promise<unknown>>();
  private readonly controllers = new Map<string, Set<AbortController>>();
  private readonly shutdown = new AbortController();
  private readonly request: PluginOAuthFetch;
  private closed = false;
  public constructor(private readonly options: PluginConnectionServiceOptions) {
    this.request = options.request ?? pluginOAuthFetch(options.fixtureOrigin);
  }

  private installed(id: string, requireEnabled: boolean): Installation {
    if (this.closed) throw new SkillError('SKILL_CONNECTION_CLOSED', '插件授权服务正在关闭。');
    pluginConnectionDefinition(id);
    const installation = this.options.installed(id);
    if (installation === undefined)
      throw new SkillError('SKILL_COLLECTION_NOT_INSTALLED', '请先安装此插件。');
    if (requireEnabled && !installation.enabled)
      throw new SkillError('SKILL_COLLECTION_DISABLED', '请先开启此插件。');
    return installation;
  }
  public definition(id: string): PluginConnectionDefinition {
    this.installed(id, true);
    return pluginConnectionDefinition(id);
  }
  /** Installed plugins may be authorized before their tool contributions are enabled. */
  public authorizationDefinition(id: string): PluginConnectionDefinition {
    this.installed(id, false);
    return pluginConnectionDefinition(id);
  }
  private ownership(id: string, requireEnabled = false): Ownership {
    return {
      installation: this.installed(id, requireEnabled),
      identity: this.options.identity(),
      epoch: this.epochs.get(id) ?? 0,
    };
  }
  private assertCurrent(
    id: string,
    ownership: Ownership,
    signal: AbortSignal,
    requireEnabled = false,
  ): void {
    signal.throwIfAborted();
    const current = this.ownership(id, requireEnabled);
    if (
      current.installation.generation !== ownership.installation.generation ||
      current.identity.ownerId !== ownership.identity.ownerId ||
      current.identity.epoch !== ownership.identity.epoch ||
      current.epoch !== ownership.epoch
    )
      throw new SkillError('SKILL_OAUTH_STATE_INVALID', '插件或当前身份已改变，请重新授权。');
  }
  private client(definition: PluginConnectionDefinition): PluginOAuthClient {
    const override = this.options.clients[definition.id];
    const clientId = override?.clientId ?? definition.oauth.clientId;
    const clientSecret = override?.clientSecret ?? definition.oauth.clientSecret;
    const callbackUrl =
      override?.callbackUrl ??
      definition.oauth.callbackUrl ??
      `${this.options.origin()}/api/skill-connections/${definition.id}/oauth/callback`;
    if (!clientId || !clientSecret)
      throw new SkillError('SKILL_OAUTH_FAILED', `${definition.name} OAuth 客户端未配置。`);
    return { clientId, clientSecret, callbackUrl };
  }
  private read(id: string, ownership: Ownership): PluginOAuthCredential | undefined {
    const credential = this.options.credentials.read(id);
    if (
      credential === undefined ||
      credential.ownerId !== ownership.identity.ownerId ||
      credential.identityEpoch !== ownership.identity.epoch ||
      credential.pluginGeneration !== ownership.installation.generation ||
      credential.apiUrl !== pluginConnectionDefinition(id).apiUrl
    )
      return undefined;
    return credential;
  }
  /** No token bytes leave this method; MCP uses the epoch to reject previous authorization snapshots. */
  public authority(id: string): { ownerId: string; identityEpoch: number; accessEpoch: number } {
    const ownership = this.ownership(id, true);
    const credential = this.read(id, ownership);
    if (credential === undefined)
      throw new SkillError('SKILL_CONNECTION_REQUIRED', '请先在插件市场授权。');
    return {
      ownerId: credential.ownerId,
      identityEpoch: credential.identityEpoch,
      accessEpoch: credential.connectedAt,
    };
  }
  private async track<T>(
    id: string,
    caller: AbortSignal,
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.closed) throw new SkillError('SKILL_CONNECTION_CLOSED', '插件授权服务正在关闭。');
    const controller = new AbortController();
    const controllers = this.controllers.get(id) ?? new Set<AbortController>();
    this.controllers.set(id, controllers);
    controllers.add(controller);
    const task = action(AbortSignal.any([caller, controller.signal, this.shutdown.signal]));
    this.operations.add(task);
    try {
      return await task;
    } finally {
      controllers.delete(controller);
      if (controllers.size === 0) this.controllers.delete(id);
      this.operations.delete(task);
    }
  }
  private cancelPending(id: string): void {
    const active = this.authorizing.get(id);
    if (active !== undefined) {
      active.controller.abort();
      clearTimeout(active.timer);
      this.authorizing.delete(id);
    }
    for (const [state, pending] of this.pending) {
      if (pending.pluginId !== id) continue;
      clearTimeout(pending.timer);
      pending.controller.abort();
      this.pending.delete(state);
    }
  }
  public async startOAuth(
    id: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<SkillOAuthStart> {
    return await this.track(id, signal, async (owned) => {
      this.installed(id, false);
      this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
      const ownership = this.ownership(id);
      const definition = pluginConnectionDefinition(id);
      const client = this.client(definition);
      this.cancelPending(id);
      const flow = await beginPluginOAuth(definition, client, this.request);
      this.assertCurrent(id, ownership, owned);
      const expiresAt = Date.now() + 10 * 60_000;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
        this.pending.delete(flow.state);
      }, 10 * 60_000);
      timer.unref();
      const pending = { pluginId: id, ownership, flow, expiresAt, controller, timer };
      this.pending.set(flow.state, pending);
      this.authorizing.set(id, pending);
      return { authorizationUrl: flow.authorizationUrl };
    });
  }
  public async completeOAuth(
    id: string,
    params: URLSearchParams,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<void> {
    const state = params.get('state');
    const pending = state === null ? undefined : this.pending.get(state);
    if (pending === undefined || pending.pluginId !== id || pending.expiresAt <= Date.now())
      throw new SkillError('SKILL_OAUTH_STATE_INVALID', '授权请求已过期、取消或使用。');
    this.pending.delete(pending.flow.state);
    clearTimeout(pending.timer);
    try {
      await this.track(id, signal, async (owned) => {
        const linked = AbortSignal.any([owned, pending.controller.signal]);
        const assert = (): void => this.assertCurrent(id, pending.ownership, linked);
        assert();
        const received = await pending.flow.complete(params, linked);
        assert();
        const prior = this.options.credentials.read(id);
        const connectedAt = Math.max(
          Date.now(),
          (prior?.connectedAt ?? 0) + 1,
          (this.epochs.get(id) ?? 0) + 1,
        );
        const credential: PluginOAuthCredential = {
          ...received,
          apiUrl: pluginConnectionDefinition(id).apiUrl,
          connectedAt,
          ownerId: pending.ownership.identity.ownerId,
          identityEpoch: pending.ownership.identity.epoch,
          pluginGeneration: pending.ownership.installation.generation,
        };
        await this.options.credentials.set(id, credential, assert);
        assert();
        await this.options.onChanged?.(id);
      });
    } finally {
      if (this.authorizing.get(id) === pending) this.authorizing.delete(id);
    }
  }
  private async currentCredential(
    id: string,
    signal: AbortSignal,
    requireEnabled: boolean,
  ): Promise<PluginOAuthCredential> {
    const ownership = this.ownership(id, requireEnabled);
    const credential = this.read(id, ownership);
    if (credential === undefined)
      throw new SkillError('SKILL_CONNECTION_REQUIRED', '请先在插件市场授权。');
    if (credential.expiresAt === undefined || credential.expiresAt > Date.now() + 60_000)
      return credential;
    const existing = this.refreshing.get(id);
    if (existing !== undefined) return await existing;
    const task = this.track(id, signal, async (owned) => {
      const assert = (): void => this.assertCurrent(id, ownership, owned, requireEnabled);
      const assertBase = (): void => {
        assert();
        const current = this.options.credentials.read(id);
        if (
          current?.connectedAt !== credential.connectedAt ||
          current.accessToken !== credential.accessToken
        )
          throw new SkillError('SKILL_OAUTH_STATE_INVALID', '服务授权已经更新，请重新发起请求。');
      };
      const definition = pluginConnectionDefinition(id);
      let refreshed;
      try {
        refreshed = await refreshPluginOAuth(
          definition,
          this.client(definition),
          credential,
          owned,
          this.request,
        );
      } catch (error: unknown) {
        assertBase();
        if (error instanceof SkillError && error.code === 'SKILL_CONNECTION_REQUIRED') {
          await this.options.credentials.delete(id, assertBase);
          await this.options.onChanged?.(id);
        }
        throw error;
      }
      assertBase();
      const next: PluginOAuthCredential = { ...credential, ...refreshed };
      if (refreshed.expiresAt === undefined) delete next.expiresAt;
      await this.options.credentials.set(id, next, assertBase);
      assert();
      await this.options.onChanged?.(id);
      return next;
    });
    this.refreshing.set(id, task);
    try {
      return await task;
    } finally {
      if (this.refreshing.get(id) === task) this.refreshing.delete(id);
    }
  }
  public async requireCredential(
    id: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<PluginOAuthCredential> {
    const credential = await this.currentCredential(id, signal, true);
    signal.throwIfAborted();
    const authority = this.authority(id);
    if (authority.accessEpoch !== credential.connectedAt)
      throw new SkillError('SKILL_OAUTH_STATE_INVALID', '服务授权已经更新，请重新发起请求。');
    return credential;
  }
  public async readToken(
    id: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<string> {
    return (await this.requireCredential(id, signal)).accessToken;
  }
  public async status(
    id: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<SkillConnectionStatus> {
    this.installed(id, false);
    let credential: PluginOAuthCredential | undefined;
    try {
      credential = await this.currentCredential(id, signal, false);
    } catch (error: unknown) {
      if (!(error instanceof SkillError) || error.code !== 'SKILL_CONNECTION_REQUIRED') throw error;
    }
    return {
      collectionId: id,
      isConnected: credential !== undefined,
      account: credential?.account ?? null,
    };
  }
  public async disconnect(id: string): Promise<void> {
    this.installed(id, false);
    const previous = this.options.credentials.read(id);
    this.epochs.set(id, Math.max(this.epochs.get(id) ?? 0, previous?.connectedAt ?? 0) + 1);
    this.cancelPending(id);
    for (const controller of this.controllers.get(id) ?? []) controller.abort();
    await this.options.credentials.delete(id);
    await this.options.onChanged?.(id);
  }
  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.shutdown.abort();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.controller.abort();
    }
    this.pending.clear();
    this.authorizing.clear();
    await Promise.allSettled(this.operations);
    await this.options.credentials.close();
  }
}
