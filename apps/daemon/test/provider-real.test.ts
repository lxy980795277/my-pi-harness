import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { expect, it } from 'vitest';
import { loadDaemonConfig } from '../src/application/config.js';
import { createApplicationServices } from '../src/application/services.js';

// Only this explicit test namespace authorizes a billed request; no .env or ambient vendor key is read.
const apiKey = process.env.MY_PI_HARNESS_TEST_API_KEY;
it.skipIf(!apiKey)(
  'explicit real OpenAI-compatible provider probe',
  async () => {
    const endpoint = process.env.MY_PI_HARNESS_TEST_BASE_URL;
    const modelId = process.env.MY_PI_HARNESS_TEST_MODEL;
    if (!apiKey || !endpoint || !modelId)
      throw new Error('Set TEST_API_KEY, TEST_BASE_URL and TEST_MODEL together');
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-real-provider-'));
    const services = await createApplicationServices(
      loadDaemonConfig({
        MY_PI_HARNESS_PROFILE_DIRECTORY: directory,
        MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
        MY_PI_HARNESS_PORT: '0',
      }),
      { credentials: createMemoryCredentialStore() },
    );
    try {
      const provider = await services.gateway.saveProvider({
        name: 'Explicit real API test',
        kind: 'custom',
        requiresApiKey: true,
        builtinId: null,
        api: 'openai-completions',
        baseUrl: endpoint,
        enabled: true,
        models: [
          {
            id: modelId,
            name: modelId,
            api: 'openai-completions',
            contextWindow: 8192,
            maxTokens: 1024,
            reasoning: false,
            input: ['text'],
          },
        ],
      });
      await services.gateway.setApiKey(provider.id, apiKey);
      expect((await services.gateway.testConnection(provider.id, modelId)).ok).toBe(true);
    } finally {
      await services.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  45_000,
);
