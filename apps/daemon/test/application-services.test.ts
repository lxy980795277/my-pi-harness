import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelGateway } from '@my-pi-harness/agent-runtime';
import { createMemoryCredentialStore, openProfileStore } from '@my-pi-harness/storage';
import { loadDaemonConfig } from '../src/application/config.js';
import { createApplicationServices } from '../src/application/services.js';
import { RemoteMcpService } from '../src/mcp/remote-service.js';
import { PluginService } from '../src/plugins/service.js';
import { SkillsService } from '../src/skills/service.js';
import { mcpManagerFixture } from './support/mcp.js';

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

it('drains every acquired service and releases the profile after startup and cleanup both fail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'application-startup-failure-'));
  directories.push(directory);
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
  });
  const startupFailure = new Error('Plugin synchronization failed');
  const cleanupFailure = new Error('MCP shutdown failed');
  vi.spyOn(PluginService.prototype, 'synchronize').mockRejectedValueOnce(startupFailure);
  const remoteClose = vi.spyOn(RemoteMcpService.prototype, 'close');
  const pluginsClose = vi.spyOn(PluginService.prototype, 'close');
  const skillsClose = vi.spyOn(SkillsService.prototype, 'close');
  const gatewayClose = vi.spyOn(ModelGateway.prototype, 'close');
  const { manager } = mcpManagerFixture();
  vi.spyOn(manager, 'close').mockRejectedValueOnce(cleanupFailure);

  const failure = await createApplicationServices(config, {
    credentials: createMemoryCredentialStore(),
    mcpManager: manager,
  }).catch((error: unknown) => error);

  expect(remoteClose).toHaveBeenCalledTimes(1);
  expect(pluginsClose).toHaveBeenCalledTimes(1);
  expect(skillsClose).toHaveBeenCalledTimes(1);
  expect(gatewayClose).toHaveBeenCalledTimes(1);
  expect(failure).toBeInstanceOf(AggregateError);
  if (!(failure instanceof AggregateError)) throw new Error('Expected startup failures');
  expect(failure.errors[0]).toBe(startupFailure);
  expect(failure.errors[1]).toMatchObject({ errors: [cleanupFailure] });
  const reopened = await openProfileStore(config.profileDirectory, {
    sessionLogRoot: config.sessionLogRoot,
  });
  reopened.close();
});
