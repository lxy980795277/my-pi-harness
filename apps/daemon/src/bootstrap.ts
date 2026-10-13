import { DaemonControlMessageSchema, type DaemonReadyRecord } from '@my-pi-harness/protocol';
import pino from 'pino';
import { Value } from 'typebox/value';
import { loadDaemonConfig } from './config.js';
import { watchParentProcess } from './parent-monitor.js';
import { createDaemonApplication } from './server.js';

const logger = pino({ level: 'info' }, pino.destination(2));

async function main(): Promise<void> {
  const config = loadDaemonConfig();
  const { server, identity } = await createDaemonApplication(config, logger);
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
