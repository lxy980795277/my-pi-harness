import {
  createProvider,
  envApiKeyAuth,
  type Api,
  type Model,
  type Provider,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import type { ProviderConfig } from '@my-pi-harness/protocol';
import { RuntimeError } from './errors.js';
import { isKnownBuiltinProvider } from './provider-loader.js';

function validateEndpoint(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RuntimeError(
      'PROVIDER_ENDPOINT_INVALID',
      'Provider endpoint must be an absolute URL',
    );
  }
  const loopback =
    url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new RuntimeError(
      'PROVIDER_ENDPOINT_INVALID',
      'Provider endpoint must use HTTPS or explicit loopback HTTP without credentials',
    );
  }
}

/** Instantiate validated configuration through Pi public provider factories. */
export async function createProviderInstance(
  config: ProviderConfig,
  loader: (id: string) => Promise<Provider>,
): Promise<Provider> {
  if (
    new Set(config.models.map(({ id }) => id)).size !== config.models.length ||
    config.models.some(({ maxTokens, contextWindow }) => maxTokens > contextWindow)
  ) {
    throw new RuntimeError(
      'PROVIDER_CONFIG_INVALID',
      'Models require unique IDs and output limits within their context window',
    );
  }
  if (config.baseUrl !== null) validateEndpoint(config.baseUrl);
  if (config.kind === 'builtin') {
    if (
      config.builtinId === null ||
      !isKnownBuiltinProvider(config.builtinId) ||
      config.api !== null
    )
      throw new RuntimeError('PROVIDER_CONFIG_INVALID', 'Native provider ID is required');
    const original = await loader(config.builtinId);
    if (
      config.models.some(
        (definition) =>
          !original
            .getModels()
            .some((model) => model.id === definition.id && model.api === definition.api),
      )
    ) {
      throw new RuntimeError(
        'PROVIDER_CONFIG_INVALID',
        'Native model overrides must name an existing model and its API',
      );
    }
    const mapModel = (model: Model<Api>): Model<Api> => ({
      ...model,
      ...config.models.find(({ id }) => id === model.id),
      provider: config.id,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    });
    const restore = (model: Model<Api>): Model<Api> => ({ ...model, provider: original.id });
    return {
      ...original,
      id: config.id,
      name: config.name,
      getModels: () => original.getModels().map(mapModel),
      getAllModels: () => original.getModels().map(mapModel),
      stream: (model, context, options) => original.stream(restore(model), context, options),
      streamSimple: (model, context, options) =>
        original.streamSimple(restore(model), context, options),
    };
  }
  if (config.builtinId !== null || config.api === null || config.baseUrl === null) {
    throw new RuntimeError(
      'PROVIDER_CONFIG_INVALID',
      'Custom providers require an API and endpoint',
    );
  }
  const configuredApi = config.api;
  if (config.models.length > 100)
    throw new RuntimeError(
      'PROVIDER_CONFIG_INVALID',
      'Custom providers support at most 100 models',
    );
  const baseUrl = config.baseUrl;
  if (config.models.some(({ api }) => api !== configuredApi))
    throw new RuntimeError(
      'PROVIDER_CONFIG_INVALID',
      'Custom model API must match its provider API',
    );
  const customModels: Model<Api>[] = config.models.map((definition) => ({
    id: definition.id,
    name: definition.name,
    api: configuredApi,
    provider: config.id,
    baseUrl,
    input: [...definition.input],
    reasoning: definition.reasoning,
    contextWindow: definition.contextWindow,
    maxTokens: definition.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...(definition.compat ? { compat: definition.compat } : {}),
    ...(definition.headers ? { headers: definition.headers } : {}),
  }));
  const api =
    config.api === 'openai-completions'
      ? openAICompletionsApi()
      : config.api === 'openai-responses'
        ? openAIResponsesApi()
        : anthropicMessagesApi();
  return createProvider({
    id: config.id,
    name: config.name,
    baseUrl: config.baseUrl,
    auth: { apiKey: envApiKeyAuth('API key', []) },
    models: customModels,
    api,
  });
}
