import { randomUUID } from 'node:crypto';
import { Value } from 'typebox/value';
import { Type } from 'typebox';
import { RuntimeError } from '@my-pi-harness/agent-runtime';
import {
  CONNECTION_PROVIDERS,
  connectionProvider,
  beginConnectionOAuth,
  refreshConnectionOAuth,
  parseConnectionCredential,
  connectionFetch,
  type ConnectionCredential,
  type ConnectionOAuthFlow,
} from '@my-pi-harness/integrations';
import type {
  ConnectionControl,
  ConnectionInput,
  ConnectionUpdate,
  ConnectionView,
  ConnectionSecretInput,
  ConnectionProviderView,
} from '@my-pi-harness/protocol';
import type {
  ProfileStore,
  CredentialStore,
  ConnectionRepository,
  StoredConnection,
} from '@my-pi-harness/storage';
import { pluginEndpointComponent } from '../plugins/app-catalog.js';

interface PendingFlow {
  connectionId: string;
  revision: number;
  accessEpoch: number;
  ownerId: string;
  identityEpoch: number;
  expiresAt: number;
  timer: NodeJS.Timeout;
  driver: ConnectionOAuthFlow;
  controller: AbortController;
  consumed: boolean;
}
export interface ConnectionServiceOptions {
  store: ProfileStore;
  repository: ConnectionRepository;
  credentials: CredentialStore;
  onInvalidated?: (connectionId: string) => Promise<void>;
  fixtureOrigin?: string;
}
function fail(code: string, message: string): never {
  throw new RuntimeError(code, message);
}
function profileIdentity(value: unknown, service: string): { id: string; name: string } {
  const object = Type.Record(Type.String(), Type.Unknown());
  if (!Value.Check(object, value)) fail('CONNECTION_ACCOUNT_INVALID', '供应商未返回可核实的账户。');
  let record = value;
  if (service === 'vercel') {
    if (!Value.Check(object, value['user']))
      fail('CONNECTION_ACCOUNT_INVALID', 'Vercel账户信息无效。');
    record = value['user'];
  }
  let id: unknown = record['id'];
  if (service === 'google') id = record['sub'];
  if (typeof id !== 'string' && typeof id !== 'number')
    fail('CONNECTION_ACCOUNT_INVALID', '供应商账户缺少稳定ID。');
  let name: unknown = record['name'] ?? record['login'] ?? record['username'] ?? record['email'];
  if (typeof name !== 'string') name = String(id);
  if (
    String(id).length === 0 ||
    String(id).length > 160 ||
    (typeof id === 'number' && !Number.isSafeInteger(id))
  )
    fail('CONNECTION_ACCOUNT_INVALID', '供应商账户ID超出支持范围。');
  return { id: String(id), name: String(name).slice(0, 200) };
}

/** Advanced account configuration and OS credentials remain separate from plugin authorization. */
export class ConnectionService {
  private readonly flows = new Map<string, PendingFlow>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly mutations = new Set<string>();
  private closed = false;
  public constructor(private readonly options: ConnectionServiceOptions) {}
  private identity() {
    if (this.closed) fail('CONNECTION_CLOSED', '外部连接服务正在关闭。');
    const owner = this.options.store.auth.profileOwner();
    if (owner === undefined) fail('CONNECTION_IDENTITY_REQUIRED', '请先登录后管理外部连接。');
    return this.options.store.mcp.identity(owner.id);
  }
  private require(id: string): StoredConnection {
    const identity = this.identity();
    const record = this.options.repository.get(id);
    if (record === undefined || record.ownerId !== identity.ownerId)
      fail('CONNECTION_NOT_FOUND', '外部连接不存在。');
    return record;
  }
  private expected(record: StoredConnection, input: ConnectionControl): void {
    if (
      record.revision !== input.expectedRevision ||
      record.accessEpoch !== input.expectedAccessEpoch
    )
      fail('CONNECTION_CONFLICT', '连接配置或授权已改变，请刷新后重试。');
  }
  private validate(input: ConnectionInput): ConnectionInput {
    const provider = connectionProvider(input.serviceId);
    const name = input.name.trim();
    if (name.length === 0 || input.scopes.some((scope) => !provider.allowedScopes.includes(scope)))
      fail('CONNECTION_CONFIGURATION_INVALID', '连接名称或权限范围无效。');
    if (input.authMode === 'oauth' && input.clientId.trim().length === 0)
      fail('CONNECTION_CLIENT_REQUIRED', '请填写单独注册的OAuth Client ID。');
    return {
      serviceId: input.serviceId,
      authMode: input.authMode,
      name,
      clientId: input.clientId.trim(),
      scopes: [...input.scopes],
    };
  }
  private view(record: StoredConnection): ConnectionView {
    const identity = this.identity();
    return {
      id: record.id,
      serviceId: record.serviceId,
      name: record.name,
      authMode: record.authMode,
      clientId: record.clientId,
      scopes: [...record.scopes],
      revision: record.revision,
      accessEpoch: record.accessEpoch,
      connected: record.connected && record.identityEpoch === identity.epoch,
      clientSecretConfigured: record.clientSecretConfigured,
      accountId: record.accountId,
      accountName: record.accountName,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
  public providers(): ConnectionProviderView[] {
    this.identity();
    return CONNECTION_PROVIDERS.map((provider) => ({
      serviceId: provider.serviceId,
      name: provider.name,
      defaultScopes: [...provider.defaultScopes],
      mcpEndpoints: [...provider.mcpEndpoints],
      apps: [...provider.apps],
    }));
  }
  public list(): ConnectionView[] {
    const identity = this.identity();
    return this.options.repository.list(identity.ownerId).map((record) => this.view(record));
  }
  public get(id: string): ConnectionView {
    return this.view(this.require(id));
  }
  public create(input: ConnectionInput): ConnectionView {
    const identity = this.identity();
    const configuration = this.validate(input);
    const now = Date.now();
    return this.view(
      this.options.repository.save(
        {
          ...configuration,
          id: randomUUID(),
          revision: 1,
          accessEpoch: 1,
          ownerId: identity.ownerId,
          identityEpoch: identity.epoch,
          connected: false,
          clientSecretConfigured: false,
          accountId: null,
          accountName: null,
          credentialRef: null,
          createdAt: now,
          updatedAt: now,
        },
        null,
      ),
    );
  }
  private async track<T>(task: Promise<T>): Promise<T> {
    this.pending.add(task);
    try {
      return await task;
    } finally {
      this.pending.delete(task);
    }
  }
  private async mutate<T>(id: string, operation: () => Promise<T>): Promise<T> {
    if (this.mutations.has(id)) fail('CONNECTION_BUSY', '连接正在更新，请稍后重试。');
    this.mutations.add(id);
    try {
      return await this.track(operation());
    } finally {
      this.mutations.delete(id);
    }
  }
  private invalidate(id: string): void {
    for (const [state, flow] of this.flows)
      if (flow.connectionId === id) {
        this.flows.delete(state);
        clearTimeout(flow.timer);
        flow.controller.abort();
      }
  }
  private async notifyInvalidated(id: string): Promise<void> {
    this.invalidate(id);
    await this.options.onInvalidated?.(id);
  }
  public async update(id: string, input: ConnectionUpdate): Promise<ConnectionView> {
    return await this.mutate(id, async () => {
      const record = this.require(id);
      if (record.revision !== input.expectedRevision)
        fail('CONNECTION_CONFLICT', '连接配置已改变。');
      if (input.serviceId !== record.serviceId)
        fail('CONNECTION_CONFIGURATION_INVALID', '更换供应商需要创建新连接。');
      const configuration = this.validate(input);
      const saved = this.options.repository.save(
        {
          ...record,
          ...configuration,
          revision: record.revision + 1,
          accessEpoch: record.accessEpoch + 1,
          connected: false,
          clientSecretConfigured: false,
          credentialRef: null,
          accountId: null,
          accountName: null,
          updatedAt: Date.now(),
        },
        record.revision,
        record.accessEpoch,
      );
      await this.notifyInvalidated(id);
      if (record.credentialRef !== null)
        await this.options.credentials.delete(record.credentialRef);
      return this.view(saved);
    });
  }
  public async disconnect(id: string, input: ConnectionControl): Promise<ConnectionView> {
    return await this.track(this.disconnectOwned(id, input));
  }
  private async disconnectOwned(id: string, input: ConnectionControl): Promise<ConnectionView> {
    const record = this.require(id);
    this.expected(record, input);
    const saved = this.options.repository.save(
      {
        ...record,
        accessEpoch: record.accessEpoch + 1,
        connected: false,
        credentialRef: null,
        clientSecretConfigured: false,
        accountId: null,
        accountName: null,
        updatedAt: Date.now(),
      },
      record.revision,
      record.accessEpoch,
    );
    await this.notifyInvalidated(id);
    if (record.credentialRef !== null) await this.options.credentials.delete(record.credentialRef);
    return this.view(saved);
  }
  public async remove(id: string, input: ConnectionControl): Promise<void> {
    await this.track(this.removeOwned(id, input));
  }
  private async removeOwned(id: string, input: ConnectionControl): Promise<void> {
    const record = this.require(id);
    this.expected(record, input);
    this.options.repository.remove(id, record.revision, record.accessEpoch);
    await this.notifyInvalidated(id);
    if (record.credentialRef !== null) await this.options.credentials.delete(record.credentialRef);
  }
  private async saveCredential(
    record: StoredConnection,
    credential: ConnectionCredential,
    update: Partial<StoredConnection>,
    beforeCommit?: () => void,
  ): Promise<StoredConnection> {
    const reference = `connection:${record.id}:${randomUUID()}`;
    let saved: StoredConnection;
    try {
      await this.options.credentials.write(reference, JSON.stringify(credential));
      beforeCommit?.();
      const current = this.require(record.id);
      this.expected(current, {
        expectedRevision: record.revision,
        expectedAccessEpoch: record.accessEpoch,
      });
      const identity = this.identity();
      saved = this.options.repository.save(
        {
          ...current,
          ...update,
          identityEpoch: identity.epoch,
          credentialRef: reference,
          accessEpoch: current.accessEpoch + 1,
          updatedAt: Date.now(),
        },
        current.revision,
        current.accessEpoch,
      );
    } catch (error) {
      await this.options.credentials.delete(reference);
      throw error;
    }
    await this.notifyInvalidated(record.id);
    if (record.credentialRef !== null) await this.options.credentials.delete(record.credentialRef);
    return saved;
  }

  public async writeClientSecret(
    id: string,
    input: ConnectionSecretInput,
  ): Promise<ConnectionView> {
    return await this.mutate(id, async () => {
      const record = this.require(id);
      this.expected(record, input);
      if (record.authMode !== 'oauth')
        fail('CONNECTION_CONFIGURATION_INVALID', '静态Token连接不使用Client Secret。');
      const saved = await this.saveCredential(
        record,
        { version: 1, clientSecret: input.value },
        { connected: false, clientSecretConfigured: true, accountId: null, accountName: null },
      );
      return this.view(saved);
    });
  }
  private headers(serviceId: string, token: string): Headers {
    const headers = new Headers({ authorization: `Bearer ${token}`, accept: 'application/json' });
    if (serviceId === 'github') {
      headers.set('X-GitHub-Api-Version', '2022-11-28');
      headers.set('User-Agent', 'My-Pi-Harness');
    }
    if (serviceId === 'notion') headers.set('Notion-Version', '2026-03-11');
    return headers;
  }
  private async account(
    record: StoredConnection,
    token: string,
    signal: AbortSignal,
  ): Promise<{ id: string; name: string }> {
    const provider = connectionProvider(record.serviceId);
    const response = await connectionFetch(provider, this.options.fixtureOrigin)(
      provider.profileEndpoint,
      { method: 'GET', headers: this.headers(record.serviceId, token), signal },
    );
    if (!response.ok) {
      await response.body?.cancel();
      fail('CONNECTION_ACCOUNT_FAILED', '无法验证供应商账户，请检查Token及权限。');
    }
    const value: unknown = await response.json();
    return profileIdentity(value, record.serviceId);
  }
  public async writeToken(
    id: string,
    input: ConnectionSecretInput,
    signal: AbortSignal,
  ): Promise<ConnectionView> {
    return await this.mutate(id, async () => {
      const record = this.require(id);
      this.expected(record, input);
      if (record.authMode !== 'token')
        fail('CONNECTION_CONFIGURATION_INVALID', 'OAuth连接请通过授权流程连接。');
      if (/[\r\n\0]/.test(input.value))
        fail('CONNECTION_CREDENTIAL_INVALID', 'Token包含无效控制字符。');
      const account = await this.account(record, input.value, signal);
      const saved = await this.saveCredential(
        record,
        { version: 1, accessToken: input.value },
        { connected: true, accountId: account.id, accountName: account.name },
      );
      return this.view(saved);
    });
  }
  public async beginOAuth(
    id: string,
    input: ConnectionControl,
    redirectUrl: string,
    signal: AbortSignal,
  ): Promise<{ url: string; expiresAt: number }> {
    const record = this.require(id);
    this.expected(record, input);
    if (record.authMode !== 'oauth')
      fail('CONNECTION_CONFIGURATION_INVALID', '此连接不使用OAuth。');
    const identity = this.identity();
    const credential = parseConnectionCredential(
      record.credentialRef === null
        ? undefined
        : await this.options.credentials.read(record.credentialRef),
    );
    const provider = connectionProvider(record.serviceId);
    const driver = await beginConnectionOAuth(provider, {
      clientId: record.clientId,
      redirectUrl,
      scopes: record.scopes,
      ...(credential.clientSecret === undefined ? {} : { clientSecret: credential.clientSecret }),
      ...(this.options.fixtureOrigin === undefined
        ? {}
        : { fixtureOrigin: this.options.fixtureOrigin }),
    });
    signal.throwIfAborted();
    this.expected(this.require(id), input);
    for (const [state, flow] of this.flows)
      if (flow.connectionId === id) {
        this.flows.delete(state);
        clearTimeout(flow.timer);
        flow.controller.abort();
      }
    const expiresAt = Date.now() + 300_000;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      this.flows.delete(driver.state);
      controller.abort();
    }, 300_000);
    timer.unref();
    this.flows.set(driver.state, {
      connectionId: id,
      revision: record.revision,
      accessEpoch: record.accessEpoch,
      ownerId: identity.ownerId,
      identityEpoch: identity.epoch,
      expiresAt,
      timer,
      driver,
      controller,
      consumed: false,
    });
    return { url: driver.url, expiresAt };
  }
  public cancelOAuth(id: string, input: ConnectionControl): void {
    this.expected(this.require(id), input);
    for (const [state, flow] of this.flows)
      if (flow.connectionId === id) {
        this.flows.delete(state);
        clearTimeout(flow.timer);
        flow.controller.abort();
      }
  }
  public async completeOAuth(
    serviceId: string,
    params: URLSearchParams,
    signal: AbortSignal,
  ): Promise<void> {
    const state = params.get('state');
    if (state === null) fail('CONNECTION_OAUTH_STATE', '授权回调缺少state。');
    const flow = this.flows.get(state);
    if (flow === undefined || flow.consumed || flow.expiresAt < Date.now())
      fail('CONNECTION_OAUTH_EXPIRED', '授权流程已过期或已经使用。');
    flow.consumed = true;
    try {
      const record = this.require(flow.connectionId);
      this.expected(record, {
        expectedRevision: flow.revision,
        expectedAccessEpoch: flow.accessEpoch,
      });
      const identity = this.identity();
      if (
        serviceId !== record.serviceId ||
        identity.ownerId !== flow.ownerId ||
        identity.epoch !== flow.identityEpoch
      )
        fail('CONNECTION_OAUTH_STATE', '授权回调与原账户或供应商不匹配。');
      await this.mutate(record.id, async () => {
        const linked = AbortSignal.any([signal, flow.controller.signal]);
        let credential: ConnectionCredential;
        try {
          credential = await flow.driver.complete(params, linked);
        } catch {
          fail('CONNECTION_OAUTH_FAILED', '供应商授权失败、取消或回调校验未通过，请重新连接。');
        }
        if (credential.accessToken === undefined)
          fail('CONNECTION_CREDENTIAL_INVALID', '授权没有返回访问Token。');
        const account = await this.account(record, credential.accessToken, linked);
        linked.throwIfAborted();
        await this.saveCredential(
          record,
          credential,
          {
            connected: true,
            clientSecretConfigured: credential.clientSecret !== undefined,
            accountId: account.id,
            accountName: account.name,
          },
          () => {
            linked.throwIfAborted();
          },
        );
      });
    } finally {
      if (this.flows.get(state) === flow) this.flows.delete(state);
      clearTimeout(flow.timer);
    }
  }
  private assertConnected(record: StoredConnection): void {
    const identity = this.identity();
    if (
      !record.connected ||
      record.credentialRef === null ||
      record.accountId === null ||
      record.identityEpoch !== identity.epoch ||
      this.mutations.has(record.id)
    )
      fail('CONNECTION_REQUIRED', '外部账户未连接或授权已失效，请重新连接。');
  }
  private appEnabled(serviceId: string, componentId: string): boolean {
    const plugin = this.options.store.extensions.plugins().find((item) => item.id === serviceId);
    return (
      plugin?.enabled === true &&
      plugin.components.some(
        (item) => item.kind === 'app' && item.id === componentId && item.enabled,
      )
    );
  }
  public authority(
    connectionId: string,
    endpoint: string,
  ): { connectionId: string; accessEpoch: number; ownerId: string; identityEpoch: number } {
    const record = this.require(connectionId);
    this.assertConnected(record);
    const componentId = pluginEndpointComponent(record.serviceId, endpoint);
    if (!this.appEnabled(record.serviceId, componentId))
      fail('CONNECTION_APP_DISABLED', '此MCP所属的服务应用已停用。');
    return {
      connectionId,
      accessEpoch: record.accessEpoch,
      ownerId: record.ownerId,
      identityEpoch: record.identityEpoch,
    };
  }
  public async read(connectionId: string, endpoint: string, signal: AbortSignal): Promise<string> {
    this.authority(connectionId, endpoint);
    const token = await this.accessToken(this.require(connectionId), signal);
    this.authority(connectionId, endpoint);
    return token;
  }
  private async accessToken(record: StoredConnection, signal: AbortSignal): Promise<string> {
    this.assertConnected(record);
    const reference = record.credentialRef;
    if (reference === null) fail('CONNECTION_REQUIRED', '连接凭据不可用。');
    let refreshStarted = false;
    try {
      return await this.options.credentials.modify(reference, async (encoded) => {
        signal.throwIfAborted();
        this.assertConnected(this.require(record.id));
        let credential = parseConnectionCredential(encoded);
        if (credential.accessToken === undefined) fail('CONNECTION_REQUIRED', '连接Token不存在。');
        if (credential.expiresAt !== undefined && credential.expiresAt <= Date.now() + 30_000) {
          const provider = connectionProvider(record.serviceId);
          refreshStarted = true;
          credential = await refreshConnectionOAuth(
            provider,
            {
              clientId: record.clientId,
              redirectUrl: '',
              scopes: record.scopes,
              ...(credential.clientSecret === undefined
                ? {}
                : { clientSecret: credential.clientSecret }),
              ...(this.options.fixtureOrigin === undefined
                ? {}
                : { fixtureOrigin: this.options.fixtureOrigin }),
            },
            credential,
            signal,
          );
          if (credential.accessToken === undefined)
            fail('CONNECTION_REQUIRED', '刷新未返回Token。');
          const account = await this.account(record, credential.accessToken, signal);
          if (account.id !== record.accountId)
            fail('CONNECTION_ACCOUNT_MISMATCH', '刷新后的账号与原连接不匹配。');
        }
        const current = this.require(record.id);
        this.assertConnected(current);
        if (
          current.accessEpoch !== record.accessEpoch ||
          current.credentialRef !== reference ||
          current.accountId !== record.accountId
        )
          fail('CONNECTION_REVOKED', '原连接授权已撤销。');
        signal.throwIfAborted();
        return { value: JSON.stringify(credential), result: credential.accessToken };
      });
    } catch (error) {
      if (signal.aborted && !refreshStarted) throw error;
      const current = this.options.repository.get(record.id);
      if (current?.connected && current.accessEpoch === record.accessEpoch) {
        this.options.repository.save(
          {
            ...current,
            connected: false,
            accessEpoch: current.accessEpoch + 1,
            updatedAt: Date.now(),
          },
          current.revision,
          current.accessEpoch,
        );
        await this.notifyInvalidated(record.id);
      }
      throw error;
    }
  }
  public stopAccepting(): void {
    this.closed = true;
    for (const flow of this.flows.values()) {
      clearTimeout(flow.timer);
      flow.controller.abort();
    }
    this.flows.clear();
  }
  public async close(): Promise<void> {
    this.stopAccepting();
    await Promise.allSettled([...this.pending]);
  }
}
