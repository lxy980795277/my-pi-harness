import { createServer } from 'node:http';
import { ModelGateway } from '@my-pi-harness/agent-runtime';
import { createMemoryCredentialStore, openProfileStore } from '@my-pi-harness/storage';
import type { CustomProtocol } from '@my-pi-harness/protocol';
import { clearAmbientModelEnvironment } from '../../src/application/model-environment.js';

const directory = process.argv[2];
if (!directory) throw new Error('A private fixture directory is required');
clearAmbientModelEnvironment(process.env);
const requests: { headers: Record<string, string | string[] | undefined> }[] = [];
const server = createServer((request, response) => {
  request.resume();
  requests.push({ headers: request.headers });
  // A non-retryable response proves the real SDK reached HTTP without needing a fake stream parser.
  response.writeHead(400, { 'Content-Type': 'application/json' });
  response.end(
    JSON.stringify({ error: { type: 'invalid_request_error', message: 'Fixture rejection' } }),
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const store = await openProfileStore(directory);
const gateway = new ModelGateway({ store, secrets: createMemoryCredentialStore() });
try {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture TCP listener');
  const apis: CustomProtocol[] = ['openai-completions', 'openai-responses', 'anthropic-messages'];
  for (const api of apis) {
    const config = await gateway.saveProvider({
      id: api,
      name: api,
      kind: 'custom',
      builtinId: null,
      api,
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      enabled: true,
      requiresApiKey: false,
      models: [
        {
          id: 'model',
          name: 'Model',
          api,
          contextWindow: 8192,
          maxTokens: 1024,
          reasoning: false,
          input: ['text'],
          headers: { 'X-Explicit-Client': 'fixture-explicit-client' },
        },
      ],
    });
    await gateway.testConnection(config.id, 'model');
  }
  process.stdout.write(`${JSON.stringify(requests)}\n`);
} finally {
  await gateway.close();
  store.close();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
