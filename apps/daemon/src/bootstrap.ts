import { DaemonControlMessageSchema, type DaemonReadyRecord } from '@my-pi-harness/protocol';
import pino from 'pino';
import { Value } from 'typebox/value';
import { createApplicationServices } from './application/services.js';
import { loadDaemonConfig } from './application/config.js';
import { watchParentProcess } from './application/parent-monitor.js';
import { createDaemonApplication } from './http/server.js';
import { clearAmbientModelEnvironment } from './application/model-environment.js';

const logger = pino(
  {
    level: 'info',
    serializers: {
      req: (request: { method: string; url: string }) => ({
        method: request.method,
        url: request.url.split('?')[0],
      }),
    },
  },
  pino.destination(2),
);

async function main(): Promise<void> {
  const config = loadDaemonConfig();
  clearAmbientModelEnvironment(process.env);
  const services = await createApplicationServices(config, {
    onError: (error) =>
      logger.error(
        { errorName: error instanceof Error ? error.name : 'unknown' },
        'Runtime operation failed',
      ),
  });
  let application;
  try {
    application = await createDaemonApplication(config, logger, services);
  } catch (error: unknown) {
    await services.close();
    throw error;
  }
  const { server, identity } = application;
  if (config.ownerSecret === null && process.stderr.isTTY)
    process.stderr.write(`浏览器一次性配对码（10分钟有效）：${services.auth.pairingCode}\n`);
  let stopParentMonitor: (() => void) | undefined;
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (reason: string): Promise<void> => {
    shutdownPromise ??= (async (): Promise<void> => {
      stopParentMonitor?.();
      logger.info({ reason, instanceId: identity.instanceId }, 'Stopping daemon');
      await server.close();
      if (process.connected) process.disconnect();
    })();
    return shutdownPromise;
  };
  const reportShutdownError = (error: unknown): void => {
    logger.error({ err: error }, 'Daemon shutdown failed');
    process.exitCode = 1;
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal).catch(reportShutdownError);
    });
  }
  if (process.send !== undefined) {
    process.on('message', (message: unknown) => {
      if (!Value.Check(DaemonControlMessageSchema, message)) {
        logger.warn('Ignored invalid daemon control message');
        return;
      }
      void shutdown('owner requested shutdown').catch(reportShutdownError);
    });
    process.once('disconnect', () => {
      void shutdown('owner disconnected').catch(reportShutdownError);
    });
    if (!process.connected) {
      await shutdown('owner disconnected before startup');
      return;
    }
  }
  try {
    await server.listen({ host: config.host, port: config.port });
    const address = server.server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Daemon has no TCP listener');
    const readyRecord: DaemonReadyRecord = {
      type: 'daemon.ready',
      host: config.host,
      port: address.port,
      instanceId: identity.instanceId,
    };
    process.stdout.write(`${JSON.stringify(readyRecord)}\n`);
    if (config.parentPid !== null) {
      stopParentMonitor = watchParentProcess(
        config.parentPid,
        () => {
          void shutdown('parent exited').catch(reportShutdownError);
        },
        (error) => {
          logger.error({ err: error }, 'Parent process check failed');
          process.exitCode = 1;
          void shutdown('parent check failed').catch(reportShutdownError);
        },
      );
    }
  } catch (error: unknown) {
    await shutdown('startup failed');
    throw error;
  }
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'Daemon failed to start');
  process.exitCode = 1;
});
