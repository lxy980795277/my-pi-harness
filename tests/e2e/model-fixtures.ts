import {
  AuthStatusSchema,
  ProviderConfigSchema,
  type ProviderConfig,
} from '@my-pi-harness/protocol';
import type { Page } from '@playwright/test';
import { Value } from 'typebox/value';

/**
 * Configure a synthetic provider through protected HTTP for tests focused on subsequent interactions.
 * @param page An authenticated page at its daemon origin.
 * @param modelOrigin The test-owned loopback model server.
 * @returns The persisted provider, including its actual ID and revision.
 */
export async function configureTestProvider(
  page: Page,
  modelOrigin: string,
): Promise<ProviderConfig> {
  const origin = new URL(page.url()).origin;
  const authResponse = await page.request.get(`${origin}/api/auth/status`);
  const status: unknown = await authResponse.json();
  if (!Value.Check(AuthStatusSchema, status) || !status.csrfToken) {
    throw new Error('The model fixture requires authenticated local access');
  }
  const headers = { Origin: origin, 'X-CSRF-Token': status.csrfToken };
  const response = await page.request.post(`${origin}/api/providers`, {
    headers,
    data: {
      name: 'Queue Model',
      kind: 'custom',
      builtinId: null,
      api: 'openai-completions',
      baseUrl: `${modelOrigin}/v1`,
      enabled: true,
      requiresApiKey: true,
      models: [
        {
          id: 'chat-model',
          name: 'Chat',
          api: 'openai-completions',
          contextWindow: 8192,
          maxTokens: 1024,
          reasoning: false,
          input: ['text'],
        },
      ],
    },
  });
  const provider: unknown = await response.json();
  if (!response.ok() || !Value.Check(ProviderConfigSchema, provider)) {
    throw new Error(`Creating the synthetic provider failed (${response.status()})`);
  }
  const keyResponse = await page.request.post(
    `${origin}/api/providers/${encodeURIComponent(provider.id)}/key`,
    {
      headers,
      data: { key: 'synthetic-account-key' },
    },
  );
  if (!keyResponse.ok())
    throw new Error(`Saving the synthetic credential failed (${keyResponse.status()})`);
  return provider;
}
