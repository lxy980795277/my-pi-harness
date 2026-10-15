import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProvider, envApiKeyAuth, type Model, type Provider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type { CustomProtocol, ProviderInput } from '@my-pi-harness/protocol';
import { createMemoryCredentialStore, openProfileStore } from '@my-pi-harness/storage';
import { describe, expect, it } from 'vitest';
import { ModelGateway } from '../src/model-gateway.js';
import { decodeCredential } from '../src/credential-adapter.js';
import { SessionRuntime } from '../src/session-runtime.js';

function sendEvent(response: ServerResponse, type: string, data: unknown): void {
  response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
function respond(response: ServerResponse, api: CustomProtocol): void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (api === 'openai-completions') {
    response.write(
      `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', model: 'requested-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'Fixture answer' }, finish_reason: null }] })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', model: 'requested-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } })}\n\ndata: [DONE]\n\n`,
    );
  } else if (api === 'openai-responses') {
    const item = {
      id: 'message-1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Fixture answer', annotations: [] }],
      status: 'completed',
    };
    sendEvent(response, 'response.created', {
      type: 'response.created',
      response: { id: 'response-1', model: 'requested-model', status: 'in_progress', output: [] },
    });
    sendEvent(response, 'response.output_item.added', {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...item, content: [], status: 'in_progress' },
    });
    sendEvent(response, 'response.content_part.added', {
      type: 'response.content_part.added',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    });
    sendEvent(response, 'response.output_text.delta', {
      type: 'response.output_text.delta',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: 'Fixture answer',
    });
    sendEvent(response, 'response.output_text.done', {
      type: 'response.output_text.done',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text: 'Fixture answer',
    });
    sendEvent(response, 'response.output_item.done', {
      type: 'response.output_item.done',
      output_index: 0,
      item,
    });
    sendEvent(response, 'response.completed', {
      type: 'response.completed',
      response: {
        id: 'response-1',
        model: 'requested-model',
        status: 'completed',
        output: [item],
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      },
    });
  } else {
    sendEvent(response, 'message_start', {
      type: 'message_start',
      message: {
        id: 'anthropic-1',
        type: 'message',
        role: 'assistant',
        model: 'requested-model',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    });
    sendEvent(response, 'content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    });
    sendEvent(response, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Fixture answer' },
    });
    sendEvent(response, 'content_block_stop', { type: 'content_block_stop', index: 0 });
    sendEvent(response, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 2 },
    });
    sendEvent(response, 'message_stop', { type: 'message_stop' });
  }
  response.end();
}

async function httpFixture(api: CustomProtocol) {
  const requests: {
    path: string;
    authorization: string | undefined;
    apiKey: string | undefined;
    client: string | undefined;
    body: unknown;
  }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push({
        path: request.url ?? '',
        authorization: request.headers.authorization,
        apiKey:
          typeof request.headers['x-api-key'] === 'string'
            ? request.headers['x-api-key']
            : undefined,
        client:
          typeof request.headers['x-client'] === 'string' ? request.headers['x-client'] : undefined,
        body,
      });
      respond(response, api);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected dynamic TCP port');
  return {
    requests,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: (): Promise<void> =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
function custom(api: CustomProtocol, baseUrl: string, id: string): ProviderInput {
  return {
    id,
    name: id,
    kind: 'custom',
    requiresApiKey: true,
    builtinId: null,
    api,
    baseUrl,
    enabled: true,
    models: [
      {
        id: 'requested-model',
        name: 'Requested model',
        api,
        contextWindow: 8192,
        maxTokens: 1024,
        reasoning: false,
        input: ['text'],
        headers: { 'X-Client': 'fixture-client' },
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsUsageInStreaming: true,
          maxTokensField: 'max_tokens',
        },
      },
    ],
  };
}
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Authentication interaction timed out');
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

describe('ModelGateway protocol and credentials', () => {
  it('continues a legacy native proxy session without moving its key to the new official slot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-legacy-proxy-'));
    const store = await openProfileStore(directory);
    const secrets = createMemoryCredentialStore();
    const http = await httpFixture('openai-completions');
    const definition = custom('openai-completions', http.baseUrl, 'legacy').models[0];
    if (!definition) throw new Error('Missing fixture definition');
    const provider = createProvider({
      id: 'openai',
      name: 'Official fixture',
      baseUrl: 'https://official.invalid/v1',
      auth: { apiKey: envApiKeyAuth('Key', []) },
      api: openAICompletionsApi(),
      models: [
        {
          ...definition,
          api: 'openai-completions',
          provider: 'openai',
          baseUrl: 'https://official.invalid/v1',
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
    store.putProvider({
      id: 'old-proxy',
      name: 'Old proxy',
      kind: 'builtin',
      builtinId: 'openai-codex',
      api: null,
      baseUrl: `${http.baseUrl}/v1`,
      models: [],
      enabled: true,
      requiresApiKey: true,
      revision: 1,
      credentialRef: 'old-proxy-key',
      hasCredential: false,
      credentialType: null,
      legacy: false,
      configured: false,
      authSource: null,
      credentialPreview: null,
    });
    store.createSession({
      id: 'old-session',
      branchId: 'main',
      title: 'Legacy',
      providerId: 'old-proxy',
      modelId: 'requested-model',
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'ask',
      at: 1,
    });
    const gateway = new ModelGateway({
      store,
      secrets,
      loadProvider: () => Promise.resolve(provider),
    });
    const runtime = new SessionRuntime({
      store,
      gateway,
      onError: (error) => {
        throw error;
      },
    });
    try {
      await gateway.initialize();
      await gateway.setApiKey('old-proxy', 'legacy-private-key');
      const canonical = (await gateway.listProviders()).find(
        (entry) => entry.builtinId === 'openai-codex',
      );
      if (!canonical) throw new Error('Missing canonical slot');
      expect(canonical.id).not.toBe('old-proxy');
      expect(canonical.credentialRef).not.toBe('old-proxy-key');
      await expect(gateway.resolve(canonical.id, 'requested-model')).rejects.toMatchObject({
        code: 'AUTH_REQUIRED',
      });
      expect(await gateway.getProvider('old-proxy')).toMatchObject({
        legacy: true,
        hasCredential: true,
        baseUrl: `${http.baseUrl}/v1`,
      });
      await runtime.send('old-session', {
        mode: 'send',
        text: 'Continue legacy',
        requestId: 'legacy-request',
      });
      await until(() => store.getSnapshot('old-session').session.activeRunId === null);
      expect(store.getSnapshot('old-session').messages.at(-1)?.text).toBe('Fixture answer');
      expect(http.requests[0]?.authorization).toBe('Bearer legacy-private-key');
      expect(await secrets.read(canonical.credentialRef)).toBeUndefined();
    } finally {
      await runtime.close();
      await gateway.close();
      store.close();
      await http.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it.each(['openai-completions', 'openai-responses', 'anthropic-messages'] as const)(
    'sends %s without authentication in explicit keyless mode and retains an unused saved key',
    async (api) => {
      const directory = await mkdtemp(join(tmpdir(), 'my-pi-keyless-'));
      const store = await openProfileStore(directory);
      const secrets = createMemoryCredentialStore();
      let credentialReads = 0;
      const gateway = new ModelGateway({
        store,
        secrets: {
          ...secrets,
          read: async (ref) => {
            credentialReads++;
            return secrets.read(ref);
          },
        },
        authContext: {
          env: () => {
            throw new Error('Keyless requests must not resolve environment credentials');
          },
          fileExists: () => Promise.resolve(false),
        },
      });
      const http = await httpFixture(api);
      try {
        const input = custom(api, http.baseUrl, 'keyless');
        let config = await gateway.saveProvider({ ...input, requiresApiKey: false });
        config = await gateway.setApiKey(config.id, 'fixture-retained-key');
        expect(config).toMatchObject({
          configured: true,
          hasCredential: true,
          credentialType: 'api_key',
          authSource: 'none',
        });
        const before = credentialReads;
        expect(await gateway.testConnection(config.id, 'requested-model')).toMatchObject({
          ok: true,
        });
        expect(credentialReads).toBe(before);
        expect(http.requests).toHaveLength(1);
        expect(http.requests[0]).toMatchObject({ authorization: undefined, apiKey: undefined });
        expect(await secrets.read(config.credentialRef)).toContain('fixture-retained-key');
        config = await gateway.saveProvider({
          ...input,
          requiresApiKey: true,
          expectedRevision: config.revision,
        });
        expect(config).toMatchObject({
          configured: true,
          authSource: 'api_key',
          credentialType: 'api_key',
        });
        expect(await gateway.testConnection(config.id, 'requested-model')).toMatchObject({
          ok: true,
        });
        if (api === 'anthropic-messages')
          expect(http.requests[1]?.apiKey).toBe('fixture-retained-key');
        else expect(http.requests[1]?.authorization).toBe('Bearer fixture-retained-key');
      } finally {
        await gateway.close();
        store.close();
        await http.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  it.each(['openai-completions', 'openai-responses', 'anthropic-messages'] as const)(
    'dispatches %s through its real Pi adapter with account-scoped credentials',
    async (api) => {
      const directory = await mkdtemp(join(tmpdir(), 'my-pi-gateway-'));
      const store = await openProfileStore(directory);
      const secrets = createMemoryCredentialStore();
      const gateway = new ModelGateway({ store, secrets });
      const http = await httpFixture(api);
      try {
        const versionPath = api === 'anthropic-messages' ? '' : '/v1';
        const first = await gateway.saveProvider(
          custom(api, `${http.baseUrl}/one${versionPath}`, 'account-one'),
        );
        const second = await gateway.saveProvider(
          custom(api, `${http.baseUrl}/two${versionPath}`, 'account-two'),
        );
        await gateway.setApiKey(first.id, 'fixture-key-one');
        await gateway.setApiKey(second.id, 'fixture-key-two');
        expect(await gateway.testConnection(first.id, 'requested-model')).toMatchObject({
          ok: true,
        });
        expect(await gateway.testConnection(second.id, 'requested-model')).toMatchObject({
          ok: true,
        });
        const suffix =
          api === 'openai-completions'
            ? '/chat/completions'
            : api === 'openai-responses'
              ? '/responses'
              : '/messages?beta=true';
        expect(http.requests.map(({ path }) => path)).toEqual([
          `/one/v1${suffix}`,
          `/two/v1${suffix}`,
        ]);
        expect(http.requests.map(({ body }) => body)).toEqual(
          expect.arrayContaining([expect.objectContaining({ model: 'requested-model' })]),
        );
        expect(http.requests.map(({ client }) => client)).toEqual([
          'fixture-client',
          'fixture-client',
        ]);
        if (api === 'anthropic-messages')
          expect(http.requests.map(({ apiKey }) => apiKey)).toEqual([
            'fixture-key-one',
            'fixture-key-two',
          ]);
        else
          expect(http.requests.map(({ authorization }) => authorization)).toEqual([
            'Bearer fixture-key-one',
            'Bearer fixture-key-two',
          ]);
        expect(JSON.stringify(await gateway.listProviders())).not.toContain('fixture-key');
        expect(first.credentialRef).not.toBe(second.credentialRef);
        await gateway.logout(first.id);
        expect(await secrets.read(first.credentialRef)).toBeUndefined();
        expect(await secrets.read(second.credentialRef)).toBeDefined();
      } finally {
        await gateway.close();
        store.close();
        await http.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it('exposes the six selected native factories and their real auth methods without connecting to a provider', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-catalog-'));
    const store = await openProfileStore(directory);
    const gateway = new ModelGateway({ store, secrets: createMemoryCredentialStore() });
    try {
      const providers = await gateway.listBuiltinProviders();
      expect(providers).toHaveLength(6);
      expect(new Set(providers.map(({ id }) => id)).size).toBe(6);
      expect(providers.find(({ id }) => id === 'openai-codex')?.authKinds).toEqual(['oauth']);
      expect(providers.find(({ id }) => id === 'deepseek')?.authKinds).toEqual(['api_key']);
    } finally {
      await gateway.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('locks a resolved provider until release and rejects an uncredentialed account despite another account key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-lease-'));
    const store = await openProfileStore(directory);
    const gateway = new ModelGateway({ store, secrets: createMemoryCredentialStore() });
    try {
      const input = custom('openai-completions', 'https://fixture.invalid/v1', 'leased-account');
      const config = await gateway.saveProvider(input);
      const other = await gateway.saveProvider(
        custom('openai-completions', 'https://fixture.invalid/v1', 'empty-account'),
      );
      await gateway.setApiKey(config.id, 'fixture-key');
      await expect(gateway.resolve(other.id, 'requested-model')).rejects.toMatchObject({
        code: 'AUTH_REQUIRED',
      });
      const resolved = await gateway.resolve(config.id, 'requested-model');
      await expect(
        gateway.saveProvider({ ...input, expectedRevision: config.revision }),
      ).rejects.toMatchObject({ code: 'PROVIDER_BUSY' });
      await expect(gateway.setApiKey(config.id, 'replacement-key')).rejects.toMatchObject({
        code: 'PROVIDER_BUSY',
      });
      resolved.release();
      resolved.release();
      expect(
        (await gateway.saveProvider({ ...input, expectedRevision: config.revision })).revision,
      ).toBe(config.revision + 1);
    } finally {
      await gateway.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects incoherent native/custom settings before saving any provider revision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-model-config-'));
    const store = await openProfileStore(directory);
    const gateway = new ModelGateway({ store, secrets: createMemoryCredentialStore() });
    try {
      const base = custom('openai-completions', 'https://fixture.invalid/v1', 'invalid-provider');
      const invalid: ProviderInput[] = [
        { ...base, builtinId: 'openai' },
        { ...base, models: [...base.models, ...base.models] },
        {
          ...base,
          models: base.models.map((model) => ({ ...model, maxTokens: model.contextWindow + 1 })),
        },
        { ...base, models: base.models.map((model) => ({ ...model, api: 'anthropic-messages' })) },
      ];
      for (const input of invalid)
        await expect(gateway.saveProvider(input)).rejects.toMatchObject({
          code: 'PROVIDER_CONFIG_INVALID',
        });
      expect(store.listProviders()).toEqual([]);
    } finally {
      await gateway.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses Models.login for URL, device, secret and code prompts, persists the credential, and logs out', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-auth-flow-'));
    const store = await openProfileStore(directory);
    const secrets = createMemoryCredentialStore();
    const model: Model<'openai-completions'> = {
      id: 'auth-model',
      name: 'Auth model',
      api: 'openai-completions',
      provider: 'fixture',
      baseUrl: 'https://fixture.invalid/v1',
      reasoning: false,
      input: ['text'],
      contextWindow: 8192,
      maxTokens: 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const provider: Provider = createProvider({
      id: 'fixture',
      name: 'Fixture',
      models: [model],
      api: openAICompletionsApi(),
      auth: {
        apiKey: envApiKeyAuth('Fixture key', []),
        oauth: {
          name: 'Fixture OAuth',
          async login(interaction) {
            interaction.notify({ type: 'auth_url', url: 'https://fixture.invalid/login' });
            interaction.notify({
              type: 'device_code',
              verificationUri: 'https://fixture.invalid/device',
              userCode: 'DEVICE-CODE',
            });
            const text = await interaction.prompt({
              type: 'text',
              message: 'Optional account label',
              placeholder: 'Leave empty',
            });
            const selected = await interaction.prompt({
              type: 'select',
              message: 'Choose account',
              options: [{ id: 'personal', label: 'Personal', description: 'Fixture account' }],
            });
            if (text !== '' || selected !== 'personal') throw new Error('Fixture prompt rejected');
            const secret = await interaction.prompt({
              type: 'secret',
              message: 'Enter fixture secret',
            });
            const code = await interaction.prompt({
              type: 'manual_code',
              message: 'Enter fixture code',
            });
            if (secret !== 'fixture-secret' || code !== 'fixture-code')
              throw new Error('Fixture authentication rejected');
            return {
              type: 'oauth',
              access: 'fixture-access',
              refresh: 'fixture-refresh',
              expires: Date.now() + 3600_000,
            };
          },
          refresh: (credential) => Promise.resolve(credential),
          toAuth: (credential) => Promise.resolve({ apiKey: credential.access }),
        },
      },
    });
    const gateway = new ModelGateway({
      store,
      secrets,
      loadProvider: () => Promise.resolve(provider),
    });
    try {
      store.putProvider({
        id: 'oauth-instance',
        name: 'OAuth instance',
        kind: 'builtin',
        requiresApiKey: true,
        credentialRef: 'oauth-ref',
        revision: 1,
        hasCredential: false,
        credentialType: null,
        legacy: false,
        configured: false,
        authSource: null,
        credentialPreview: null,
        builtinId: 'anthropic',
        api: null,
        baseUrl: null,
        models: [],
        enabled: true,
      });
      await gateway.initialize();
      const config = await gateway.getProvider('oauth-instance');
      const flow = gateway.startAuth(config.id, 'oauth');
      expect(gateway.listAuth()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: flow.id, status: 'pending' })]),
      );
      await until(() => gateway.getAuth(flow.id).prompt?.type === 'text');
      const textPrompt = gateway.getAuth(flow.id).prompt;
      if (!textPrompt) throw new Error('Expected text prompt');
      expect(textPrompt.placeholder).toBe('Leave empty');
      gateway.respondAuth(flow.id, textPrompt.id, '');
      await until(() => gateway.getAuth(flow.id).prompt?.type === 'select');
      const selectPrompt = gateway.getAuth(flow.id).prompt;
      if (!selectPrompt) throw new Error('Expected select prompt');
      expect(selectPrompt.options?.[0]?.description).toBe('Fixture account');
      expect(() => gateway.respondAuth(flow.id, selectPrompt.id, '')).toThrow('option');
      gateway.respondAuth(flow.id, selectPrompt.id, 'personal');
      await until(() => gateway.getAuth(flow.id).prompt?.secret === true);
      const first = gateway.getAuth(flow.id);
      expect(first.deviceCode).toBe('DEVICE-CODE');
      expect(first.url).toBe('https://fixture.invalid/device');
      if (!first.prompt) throw new Error('Expected secret prompt');
      expect(() => gateway.respondAuth(flow.id, first.prompt?.id ?? '', '')).toThrow('empty');
      gateway.respondAuth(flow.id, first.prompt.id, 'fixture-secret');
      await until(() => gateway.getAuth(flow.id).prompt?.secret === false);
      const second = gateway.getAuth(flow.id);
      if (!second.prompt) throw new Error('Expected code prompt');
      gateway.respondAuth(flow.id, second.prompt.id, 'fixture-code');
      await until(() => gateway.getAuth(flow.id).status === 'completed');
      const serialized = await secrets.read(config.credentialRef);
      if (!serialized) throw new Error('Credential was not persisted');
      expect(decodeCredential(serialized)).toMatchObject({
        type: 'oauth',
        access: 'fixture-access',
        refresh: 'fixture-refresh',
      });
      expect(JSON.stringify(gateway.getAuth(flow.id))).not.toContain('fixture-access');
      await gateway.logout(config.id);
      expect(await secrets.read(config.credentialRef)).toBeUndefined();
      const cancelled = gateway.startAuth(config.id, 'oauth');
      gateway.cancelAuth(cancelled.id);
      await until(() => gateway.getAuth(cancelled.id).status === 'cancelled');
      await gateway.close();
      expect(await secrets.read(config.credentialRef)).toBeUndefined();
    } finally {
      await gateway.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
