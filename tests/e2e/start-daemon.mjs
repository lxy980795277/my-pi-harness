import { createMemoryCredentialStore } from '../../packages/storage/dist/index.js';
import { loadDaemonConfig } from '../../apps/daemon/dist/config.js';
import { createApplicationServices } from '../../apps/daemon/dist/services.js';
import { createDaemonApplication } from '../../apps/daemon/dist/server.js';
import { clearAmbientModelEnvironment } from '../../apps/daemon/dist/model-environment.js';

// Tests explicitly inject synthetic credentials; the shipped bootstrap always uses the OS store.
const config = loadDaemonConfig();
clearAmbientModelEnvironment(process.env);
const services = await createApplicationServices(config, {
  credentials: createMemoryCredentialStore(),
});
const { server, identity } = await createDaemonApplication(config, undefined, services);
let stopping;
function stop() {
  stopping ??= server.close().finally(() => {
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
