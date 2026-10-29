import { createHash } from 'node:crypto';
import { startConnectionUpstream } from './connection-upstream.mjs';
import { BrowserPluginMcpManager, startPluginMcpUpstream } from './plugin-mcp-upstream.mjs';
import { createMemoryCredentialStore } from '../../packages/storage/dist/index.js';
import { loadDaemonConfig } from '../../apps/daemon/dist/application/config.js';
import { createApplicationServices } from '../../apps/daemon/dist/application/services.js';
import { createDaemonApplication } from '../../apps/daemon/dist/http/server.js';
import { clearAmbientModelEnvironment } from '../../apps/daemon/dist/application/model-environment.js';

// Tests explicitly inject synthetic credentials; the shipped bootstrap always uses the OS store.
const config = loadDaemonConfig();
clearAmbientModelEnvironment(process.env);
let challengeId = 0;
const tokenPolls = new Map();
const connectionUpstream = await startConnectionUpstream();
const mcpUpstream = await startPluginMcpUpstream();
const credentials = createMemoryCredentialStore();
const githubFetch = async (input, init) => {
  const address = new URL(input instanceof Request ? input.url : input);
  if (address.href === 'https://github.com/login/device/code') {
    challengeId += 1;
    return Response.json({
      device_code: `synthetic-private-device-code-${challengeId}`,
      user_code: 'E2E-TEST',
      verification_uri: 'https://github.com/login/device',
      expires_in: 600,
      interval: 1,
    });
  }
  if (address.href === 'https://github.com/login/oauth/access_token') {
    const fields = new URLSearchParams(init?.body);
    if (fields.has('code')) {
      const verifier = fields.get('code_verifier');
      const challenge = createHash('sha256')
        .update(verifier ?? '')
        .digest('base64url');
      if (
        fields.get('client_id') !== 'synthetic-e2e-client-id' ||
        fields.get('client_secret') !== 'synthetic-e2e-client-secret' ||
        !verifier ||
        fields.get('code') !== `synthetic-e2e-code-${challenge}`
      )
        return Response.json({ error: 'invalid_grant' });
      return Response.json({
        access_token: 'synthetic-disposable-github-token',
        token_type: 'bearer',
        scope: 'read:user',
      });
    }
    const code = fields.get('device_code');
    const attempts = (tokenPolls.get(code) ?? 0) + 1;
    tokenPolls.set(code, attempts);
    if (attempts === 1) return Response.json({ error: 'authorization_pending' });
    return Response.json({
      access_token: 'synthetic-disposable-github-token',
      token_type: 'bearer',
      scope: 'read:user',
    });
  }
  if (address.href === 'https://api.github.com/user')
    return Response.json({
      id: 42424242,
      login: 'e2e-user',
      name: 'E2E User',
      avatar_url: 'https://avatars.githubusercontent.com/u/42424242?v=4',
    });
  throw new Error(`Unexpected synthetic GitHub request: ${address.origin}${address.pathname}`);
};
async function createApplication() {
  const services = await createApplicationServices(config, {
    credentials,
    connectionFixtureOrigin: connectionUpstream.origin,
    remoteMcpManager: new BrowserPluginMcpManager(mcpUpstream.origin),
    // Real CPU inference has separate integration coverage; browser tests own deterministic vectors.
    toolSearchEmbedder: {
      async embed(_purpose, inputs) {
        return inputs.map(() => [1, 0]);
      },
    },
    githubFetch,
  });
  const application = await createDaemonApplication(config, undefined, services);
  // The real gateway token check still protects this exact test-owned read target.
  application.server.get('/api/skill-gateway/fixture/read', () => ({
    result: 'M5-READONLY-GET-OK',
  }));
  return application;
}
let application = await createApplication();
let restarting;
async function restart() {
  const address = application.server.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture restart port');
  await application.server.close();
  application = await createApplication();
  await application.server.listen({ host: config.host, port: address.port });
}
let stopping;
function stop() {
  stopping ??= Promise.resolve(restarting)
    .then(() => application.server.close())
    .finally(async () => {
      await mcpUpstream.close();
      await connectionUpstream.close();
      if (process.connected) process.disconnect();
    });
  return stopping;
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void stop();
  });
process.on('message', (message) => {
  if (message?.type === 'daemon.shutdown') void stop();
  if (message?.type === 'fixture.restart' && !stopping && !restarting) {
    restarting = restart();
    restarting
      .then(
        () => process.send?.({ type: 'fixture.restarted', requestId: message.requestId }),
        () => process.send?.({ type: 'fixture.restart-failed', requestId: message.requestId }),
      )
      .finally(() => {
        restarting = undefined;
      });
  }
});
process.once('disconnect', () => {
  void stop();
});
await application.server.listen({ host: config.host, port: config.port });
const address = application.server.server.address();
if (!address || typeof address === 'string') throw new Error('No TCP address');
process.stdout.write(
  `${JSON.stringify({ type: 'daemon.ready', host: config.host, port: address.port, instanceId: application.identity.instanceId })}\n`,
);
