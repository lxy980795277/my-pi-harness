import { randomUUID } from 'node:crypto';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  createModels,
  getSupportedThinkingLevels,
  normalizeContext,
  type Api,
  type AuthContext,
  type AuthType,
  type Model,
  type MutableModels,
  type Provider,
} from '@earendil-works/pi-ai';
import type {
  AuthFlow,
  ModelInfo,
  AppSettings,
  AppSettingsInput,
  SessionCreateInput,
  ResolvedSessionCreateInput,
  DefaultModel,
  NativeProviderInfo,
  ProviderConfig,
  ProviderInput,
} from '@my-pi-harness/protocol';
import { AuthFlows } from './auth-flows.js';
import { createPiCredentialStore, type SecretStore } from './credential-adapter.js';
import { RuntimeError } from './errors.js';
import { BUILTIN_PROVIDER_IDS, loadBuiltinProvider } from './provider-loader.js';
import type { ProviderStore } from './runtime-ports.js';
import { createProviderInstance } from './provider-instance.js';
import { keylessStream } from './keyless-transport.js';

export interface ResolvedModel {
  model: Model<Api>;
  streamFn: StreamFn;
  release(): void;
}
export interface ModelGatewayOptions {
  store: ProviderStore;
  secrets: SecretStore;
  authContext?: AuthContext;
  loadProvider?: (id: string) => Promise<Provider>;
  isProviderActive?: (providerId: string) => boolean;
  deviceId?: string;
}

function modelView(model: Model<Api>): ModelInfo {
  return {
    id: model.id,
    name: model.name,
    api: model.api,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoning: model.reasoning,
    input: [...model.input],
    supportedThinkingLevels: getSupportedThinkingLevels(model),
  };
}

/** Owns account instances and model configuration; Pi owns protocol transport and auth. */
export class ModelGateway {
  private readonly models: MutableModels;
  private readonly auth: AuthFlows;
  private readonly credentials;
  private readonly loader: (id: string) => Promise<Provider>;
  private readonly mutations = new Set<string>();
  private readonly leases = new Map<string, number>();
  private readonly probes = new Map<AbortController, Promise<{ ok: boolean; message: string }>>();
  private closed = false;
  private stopPromise: Promise<void> | undefined;

  public constructor(private readonly options: ModelGatewayOptions) {
    this.credentials = createPiCredentialStore(
      options.secrets,
      (id) => this.requireConfig(id).credentialRef,
      () => options.store.listProviders().map(({ id }) => id),
    );
    this.models = createModels({
      credentials: this.credentials,
      authContext: options.authContext ?? {
        env: () => Promise.resolve(undefined),
        fileExists: () => Promise.resolve(false),
      },
    });
    this.loader = options.loadProvider ?? loadBuiltinProvider;
    this.auth = new AuthFlows(this.models, options.deviceId);
  }

  public async initialize(): Promise<void> {
    this.ensureOpen();
    for (const builtinId of BUILTIN_PROVIDER_IDS) {
      if (this.options.store.getBuiltinProviderId(builtinId)) continue;
      const existing = this.options.store
        .listProviders()
        .filter(
          (config) =>
            config.kind === 'builtin' &&
            config.builtinId === builtinId &&
            config.baseUrl === null &&
            config.models.length === 0,
        )
        .sort(
          (left, right) =>
            Number(right.enabled) - Number(left.enabled) ||
            Buffer.compare(Buffer.from(left.id), Buffer.from(right.id)),
        )[0];
      if (existing) {
        this.options.store.bindBuiltinProvider(builtinId, existing.id);
        continue;
      }
      const original = await this.loader(builtinId);
      this.ensureOpen();
      const config: ProviderConfig = {
        id: randomUUID(),
        name: original.name,
        kind: 'builtin',
        builtinId,
        api: null,
        baseUrl: null,
        models: [],
        enabled: true,
        requiresApiKey: true,
        credentialRef: randomUUID(),
        revision: 1,
        hasCredential: false,
        credentialType: null,
        legacy: false,
        configured: false,
        authSource: null,
        credentialPreview: null,
      };
      this.options.store.putProvider(config);
      this.options.store.bindBuiltinProvider(builtinId, config.id);
    }
    for (const config of this.options.store.listProviders()) {
      const provider = await createProviderInstance(config, this.loader);
      this.ensureOpen();
      this.models.setProvider(provider);
    }
    await this.models.refresh({ allowNetwork: false });
  }

  public async listBuiltinProviders(): Promise<NativeProviderInfo[]> {
    return Promise.all(
      BUILTIN_PROVIDER_IDS.map(async (id) => {
        const provider = await this.loader(id);
        const authKinds: ('api_key' | 'oauth')[] = [];
        if (provider.auth.apiKey) authKinds.push('api_key');
        if (provider.auth.oauth) authKinds.push('oauth');
        return { id, name: provider.name, authKinds };
      }),
    );
  }

  public async listProviders(): Promise<ProviderConfig[]> {
    const configs = this.options.store.listProviders();
    const native = BUILTIN_PROVIDER_IDS.flatMap((builtinId) => {
      const id = this.options.store.getBuiltinProviderId(builtinId);
      return configs.filter((config) => config.id === id);
    });
    return Promise.all(
      [...native, ...configs.filter((config) => config.kind === 'custom')].map((config) =>
        this.withCredentialStatus(config),
      ),
    );
  }

  public getProvider(id: string): Promise<ProviderConfig> {
    return this.withCredentialStatus(this.requireConfig(id));
  }

  public async saveProvider(input: ProviderInput): Promise<ProviderConfig> {
    this.ensureOpen();
    const id = input.id ?? randomUUID();
    this.ensureMutable(id);
    this.mutations.add(id);
    try {
      const previous = this.options.store.getProvider(id);
      if (input.kind !== 'custom' || previous?.kind === 'builtin')
        throw new RuntimeError(
          'PROVIDER_READ_ONLY',
          'Native provider metadata is owned by the Pi catalog',
        );
      if (previous && input.expectedRevision !== previous.revision)
        throw new RuntimeError('PROVIDER_CONFLICT', 'Provider configuration changed');
      if (!previous && input.expectedRevision !== undefined && input.expectedRevision !== 0)
        throw new RuntimeError('PROVIDER_CONFLICT', 'Provider configuration does not exist');
      const config: ProviderConfig = {
        id,
        name: input.name,
        kind: input.kind,
        builtinId: input.builtinId,
        api: input.api,
        baseUrl: input.baseUrl,
        models: structuredClone(input.models).map((model) => {
          const merged = {
            ...previous?.models.find((current) => current.id === model.id),
            ...model,
          };
          if (
            previous?.api !== input.api &&
            previous?.api !== null &&
            model.api === previous?.api &&
            input.api !== null
          )
            return { ...merged, api: input.api };
          return merged;
        }),
        enabled: input.enabled,
        requiresApiKey: input.requiresApiKey,
        credentialRef: previous?.credentialRef ?? randomUUID(),
        revision: (previous?.revision ?? 0) + 1,
        hasCredential: false,
        credentialType: null,
        legacy: false,
        configured: false,
        authSource: null,
        credentialPreview: null,
      };
      const provider = await createProviderInstance(config, this.loader);
      this.ensureOpen();
      this.options.store.putProvider(config, input.expectedRevision);
      this.models.setProvider(provider);
      return this.withCredentialStatus(config);
    } finally {
      this.mutations.delete(id);
    }
  }

  public async deleteProvider(id: string): Promise<void> {
    this.ensureMutable(id);
    if (this.requireConfig(id).kind !== 'custom')
      throw new RuntimeError('PROVIDER_READ_ONLY', 'Native providers cannot be deleted');
    this.mutations.add(id);
    try {
      await this.models.logout(id);
      this.ensureOpen();
      this.options.store.deleteProvider(id);
      this.models.deleteProvider(id);
    } finally {
      this.mutations.delete(id);
    }
  }

  public listModels(providerId: string): Promise<ModelInfo[]> {
    this.requireConfig(providerId);
    return Promise.resolve(this.models.getModels(providerId).map(modelView));
  }

  public async setEnabled(
    id: string,
    enabled: boolean,
    expectedRevision: number,
  ): Promise<ProviderConfig> {
    this.ensureMutable(id);
    this.mutations.add(id);
    try {
      const previous = this.requireConfig(id);
      const config = { ...previous, enabled, revision: previous.revision + 1 };
      this.options.store.putProvider(config, expectedRevision);
      return await this.withCredentialStatus(config);
    } finally {
      this.mutations.delete(id);
    }
  }

  public getSettings(): AppSettings {
    return this.options.store.getSettings();
  }

  public saveSettings(input: AppSettingsInput): AppSettings {
    this.ensureOpen();
    if (input.defaultModel !== null) this.validateSelection(input.defaultModel);
    return this.options.store.putSettings(input);
  }

  public async resolveSessionInput(input: SessionCreateInput): Promise<ResolvedSessionCreateInput> {
    this.ensureOpen();
    const explicit =
      input.providerId !== undefined ||
      input.modelId !== undefined ||
      input.thinkingLevel !== undefined;
    let selection: DefaultModel;
    if (explicit) {
      if (
        input.providerId === undefined ||
        input.modelId === undefined ||
        input.thinkingLevel === undefined
      )
        throw new RuntimeError(
          'MODEL_SELECTION_INVALID',
          'Explicit model selection requires a provider, model and thinking level',
        );
      selection = {
        providerId: input.providerId,
        modelId: input.modelId,
        thinkingLevel: input.thinkingLevel,
      };
    } else {
      const current = this.options.store.getSettings().defaultModel;
      if (current === null)
        throw new RuntimeError(
          'DEFAULT_MODEL_REQUIRED',
          'Configure a default model before creating a session',
        );
      selection = current;
    }
    this.validateSelection(selection);
    const resolved = await this.resolve(selection.providerId, selection.modelId);
    resolved.release();
    return {
      title: input.title,
      ...selection,
      workspaceId: input.workspaceId ?? null,
      approvalMode: input.approvalMode ?? 'ask',
    };
  }

  private validateSelection(selection: DefaultModel): void {
    const config = this.requireConfig(selection.providerId);
    if (!config.enabled)
      throw new RuntimeError('PROVIDER_DISABLED', 'Selected provider is disabled');
    const model = this.models.getModel(selection.providerId, selection.modelId);
    if (!model) throw new RuntimeError('MODEL_NOT_FOUND', 'Selected model is not configured');
    if (!getSupportedThinkingLevels(model).includes(selection.thinkingLevel))
      throw new RuntimeError(
        'THINKING_LEVEL_INVALID',
        'Thinking level is not supported by this model',
      );
  }

  public async setApiKey(providerId: string, key: string): Promise<ProviderConfig> {
    this.ensureMutable(providerId);
    const config = this.requireConfig(providerId);
    if (!this.models.getProvider(providerId)?.auth.apiKey)
      throw new RuntimeError('AUTH_KIND_UNAVAILABLE', 'This provider does not accept API keys');
    this.mutations.add(providerId);
    try {
      await this.credentials.modify(providerId, () => Promise.resolve({ type: 'api_key', key }));
      this.ensureOpen();
      return this.withCredentialStatus(config);
    } finally {
      this.mutations.delete(providerId);
    }
  }

  public async clearCredential(providerId: string): Promise<void> {
    await this.logout(providerId);
  }

  public async logout(providerId: string): Promise<void> {
    this.ensureMutable(providerId);
    this.requireConfig(providerId);
    this.mutations.add(providerId);
    try {
      await this.models.logout(providerId);
    } finally {
      this.mutations.delete(providerId);
    }
  }

  public startAuth(providerId: string, kind: AuthType): AuthFlow {
    this.ensureMutable(providerId);
    this.requireConfig(providerId);
    return this.auth.start(providerId, kind);
  }
  public getAuth(flowId: string): AuthFlow {
    return this.auth.get(flowId);
  }
  public listAuth(): AuthFlow[] {
    return this.auth.list();
  }
  public respondAuth(flowId: string, promptId: string, value: string): AuthFlow {
    return this.auth.respond(flowId, promptId, value);
  }
  public cancelAuth(flowId: string): AuthFlow {
    return this.auth.cancel(flowId);
  }

  public async resolve(
    providerId: string,
    modelId: string,
    signal?: AbortSignal,
  ): Promise<ResolvedModel> {
    this.ensureOpen();
    if (this.mutations.has(providerId) || this.auth.isActive(providerId))
      throw new RuntimeError('PROVIDER_BUSY', 'Provider authentication is changing');
    const config = this.requireConfig(providerId);
    if (!config.enabled) throw new RuntimeError('PROVIDER_DISABLED', 'Provider is disabled');
    const model = this.models.getModel(providerId, modelId);
    if (!model) throw new RuntimeError('MODEL_NOT_FOUND', 'Model is not configured');
    const provider = this.models.getProvider(providerId);
    if (!provider) throw new RuntimeError('PROVIDER_NOT_FOUND', 'Provider is not initialized');
    this.leases.set(providerId, (this.leases.get(providerId) ?? 0) + 1);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      const count = (this.leases.get(providerId) ?? 1) - 1;
      if (count === 0) this.leases.delete(providerId);
      else this.leases.set(providerId, count);
    };
    try {
      const keyless = config.kind === 'custom' && !config.requiresApiKey;
      if (!keyless && !(await this.models.checkAuth(providerId, signal ? { signal } : undefined)))
        throw new RuntimeError('AUTH_REQUIRED', 'Provider authentication is not configured');
      this.ensureOpen();
      signal?.throwIfAborted();
      return {
        model: structuredClone(model),
        streamFn: keyless ? keylessStream(provider) : this.models.streamSimple.bind(this.models),
        release,
      };
    } catch (error) {
      release();
      throw error;
    }
  }

  public testConnection(
    providerId: string,
    modelId: string,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; message: string }> {
    this.ensureOpen();
    const controller = new AbortController();
    const combined = signal
      ? AbortSignal.any([signal, controller.signal, AbortSignal.timeout(30_000)])
      : AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
    const task = this.runProbe(providerId, modelId, combined).finally(() => {
      this.probes.delete(controller);
    });
    this.probes.set(controller, task);
    return task;
  }

  private async runProbe(
    providerId: string,
    modelId: string,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; message: string }> {
    let resolved: ResolvedModel | undefined;
    try {
      resolved = await this.resolve(providerId, modelId, signal);
      const { model, streamFn } = resolved;
      const stream = await streamFn(
        model,
        normalizeContext({
          messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }],
        }),
        {
          signal,
          maxTokens: 16,
        },
      );
      const result = await stream.result();
      if (
        result.stopReason === 'error' ||
        result.stopReason === 'aborted' ||
        result.stopReason === 'deferred'
      ) {
        return {
          ok: false,
          message:
            'The provider request did not complete. Check authentication and model configuration.',
        };
      }
      return { ok: true, message: 'The model returned a response.' };
    } catch {
      return {
        ok: false,
        message: 'The provider request failed. Check authentication and model configuration.',
      };
    } finally {
      resolved?.release();
    }
  }

  public close(): Promise<void> {
    this.stopPromise ??= this.stop();
    return this.stopPromise;
  }

  private async stop(): Promise<void> {
    this.closed = true;
    for (const controller of this.probes.keys()) controller.abort();
    await Promise.all(this.probes.values());
    await this.auth.close();
    await this.credentials.waitForIdle();
    this.models.clearProviders();
  }

  private ensureOpen(): void {
    if (this.closed) throw new RuntimeError('RUNTIME_CLOSED', 'Runtime is closing');
  }
  private ensureMutable(id: string): void {
    this.ensureOpen();
    if (
      this.mutations.has(id) ||
      this.auth.isActive(id) ||
      this.leases.has(id) ||
      this.options.isProviderActive?.(id)
    ) {
      throw new RuntimeError('PROVIDER_BUSY', 'Provider is in use');
    }
  }
  private requireConfig(id: string): ProviderConfig {
    const config = this.options.store.getProvider(id);
    if (!config) throw new RuntimeError('PROVIDER_NOT_FOUND', 'Provider does not exist');
    return config;
  }
  private async withCredentialStatus(config: ProviderConfig): Promise<ProviderConfig> {
    const credential = await this.credentials.read(config.id);
    const keyless = config.kind === 'custom' && !config.requiresApiKey;
    const legacy =
      config.kind === 'builtin' &&
      config.builtinId !== null &&
      (!BUILTIN_PROVIDER_IDS.some((id) => id === config.builtinId) ||
        this.options.store.getBuiltinProviderId(config.builtinId) !== config.id);
    const preview =
      credential?.type === 'api_key' && credential.key
        ? credential.key.length > 4
          ? `••••${credential.key.slice(-4)}`
          : '••••'
        : null;
    return {
      ...config,
      name:
        config.kind === 'builtin' && !legacy && config.builtinId !== null
          ? (await this.loader(config.builtinId)).name
          : config.name,
      models:
        config.kind === 'builtin'
          ? this.models
              .getModels(config.id)
              .map(({ id, name, api, contextWindow, maxTokens, reasoning, input }) => ({
                id,
                name,
                api,
                contextWindow,
                maxTokens,
                reasoning,
                input: [...input],
              }))
          : config.models,
      hasCredential: credential !== undefined,
      credentialType: credential?.type ?? null,
      legacy,
      configured: keyless || credential !== undefined,
      authSource: keyless ? 'none' : (credential?.type ?? null),
      credentialPreview: preview,
    };
  }
}
