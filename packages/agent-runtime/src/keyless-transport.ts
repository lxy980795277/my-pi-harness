import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { FetchFunction, Provider } from '@earendil-works/pi-ai';

const AUTH_HEADERS = [
  'authorization',
  'x-api-key',
  'api-key',
  'cf-aig-authorization',
  'openai-organization',
  'openai-project',
];

/** Pi SDK clients require a nonempty key; remove their generated authentication before HTTP. */
function withoutAuthentication(fetch: FetchFunction): FetchFunction {
  return (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    for (const name of AUTH_HEADERS) headers.delete(name);
    return fetch(input, { ...init, headers });
  };
}

/** Use Pi's HTTP/SSE adapters while bypassing all stored and ambient credentials. */
export function keylessStream(provider: Provider): StreamFn {
  return (model, context, options) =>
    provider.streamSimple(model, context, {
      ...options,
      apiKey: 'keyless-local-adapter',
      fetch: withoutAuthentication(options?.fetch ?? globalThis.fetch),
      transport: 'sse',
    });
}
