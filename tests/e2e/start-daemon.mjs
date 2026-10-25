import { createHash } from 'node:crypto';
import { startConnectionUpstream } from './connection-upstream.mjs';
import { createMemoryCredentialStore } from '../../packages/storage/dist/index.js';
import { loadDaemonConfig } from '../../apps/daemon/dist/config.js';
import { createApplicationServices } from '../../apps/daemon/dist/services.js';
import { createDaemonApplication } from '../../apps/daemon/dist/server.js';
import { clearAmbientModelEnvironment } from '../../apps/daemon/dist/model-environment.js';

// Tests explicitly inject synthetic credentials; the shipped bootstrap always uses the OS store.
const config = loadDaemonConfig();
clearAmbientModelEnvironment(process.env);
let challengeId = 0;
const tokenPolls = new Map();
const connectionUpstream = await startConnectionUpstream();
const services = await createApplicationServices(config, {
  credentials: createMemoryCredentialStore(),
  connectionFixtureOrigin: connectionUpstream.origin,
  githubFetch: async (input, init) => {
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
  },
});
const { server, identity } = await createDaemonApplication(config, undefined, services);
let stopping;
function stop() {
  stopping ??= server.close().finally(async () => {
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
});
process.once('disconnect', () => {
  void stop();
});
await server.listen({ host: config.host, port: config.port });
const address = server.server.address();
if (!address || typeof address === 'string') throw new Error('No TCP address');
process.stdout.write(
  `${JSON.stringify({ type: 'daemon.ready', host: config.host, port: address.port, instanceId: identity.instanceId })}\n`,
);
