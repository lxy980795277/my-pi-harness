import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServerViewSchema, WorkspaceSchema, type McpServerInput } from '@my-pi-harness/protocol';
import { createMemoryCredentialStore, type CredentialStore } from '@my-pi-harness/storage';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { loadDaemonConfig } from '../src/application/config.js';
import { createDaemonApplication } from '../src/http/server.js';
import { createApplicationServices } from '../src/application/services.js';
import { loginFixture } from './support/login.js';
import { mcpManagerFixture } from './support/mcp.js';

async function fixture(
  credentials: CredentialStore = createMemoryCredentialStore(),
  realSdk = false,
) {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-mcp-api-'));
  const profile = join(directory, 'profile');
  const project = join(directory, 'project');
  await mkdir(project);
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: profile,
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(profile, '.my-pi-harness'),
  });
  const protocol = mcpManagerFixture();
  const services = await createApplicationServices(config, {
    credentials,
    ...(realSdk ? {} : { mcpManager: protocol.manager }),
  });
  const application = await createDaemonApplication(config, undefined, services);
  const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
  const login = await loginFixture(origin, services);
  const headers = {
    Cookie: login.cookie,
    Origin: origin,
    'X-CSRF-Token': login.csrf,
    'Content-Type': 'application/json',
  };
  const send = (path: string, method = 'GET', body?: unknown) =>
    fetch(`${origin}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
  const registered: unknown = await (
    await send('/api/workspaces', 'POST', { rootPath: project })
  ).json();
  if (!Value.Check(WorkspaceSchema, registered)) throw new Error('Invalid workspace fixture');
  const input: McpServerInput = {
    name: 'Fixture server',
    workspaceId: registered.id,
    command: '/usr/bin/fixture',
    args: ['server'],
    publicEnvironment: { PUBLIC_MODE: 'test' },
    secretSlots: [],
  };
  return {
    services,
    protocol,
    credentials,
    send,
    input,
    origin,
    project: registered.rootPath,
    close: async () => {
      await application.server.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function create(value: Awaited<ReturnType<typeof fixture>>, input = value.input) {
  const response = await value.send('/api/mcp/servers', 'POST', input);
  expect(response.status).toBe(200);
  const server: unknown = await response.json();
  if (!Value.Check(McpServerViewSchema, server)) throw new Error('Invalid MCP fixture');
  return server;
}
async function trust(
  value: Awaited<ReturnType<typeof fixture>>,
  id: string,
  scope: 'sandboxed' | 'full-access' = 'sandboxed',
  expectedRevision = 1,
  expectedAccessEpoch = 1,
) {
  const body = { expectedRevision, expectedAccessEpoch, scope };
  const preview = await value.send(`/api/mcp/servers/${id}/trust-preview`, 'POST', body);
  expect(preview.status).toBe(200);
  const data: unknown = await preview.json();
  if (!data || typeof data !== 'object' || !('startupFingerprint' in data))
    throw new Error('Invalid trust preview');
  const response = await value.send(`/api/mcp/servers/${id}/trust`, 'POST', {
    ...body,
    startupFingerprint: data.startupFingerprint,
  });
  expect(response.status).toBe(200);
}

describe('protected MCP configuration API', () => {
  it('rejects launch controls in public and secret names before saving or previewing configuration', async () => {
    const value = await fixture();
    try {
      const allowed: McpServerInput = {
        ...value.input,
        secretSlots: [{ slotId: 'api', environmentName: 'API_TOKEN' }],
      };
      const server = await create(value, allowed);
      const preview = await value.send('/api/mcp/configuration/preview', 'POST', {
        version: 1,
        local: [{ ...allowed, name: 'Preview fixture' }],
        remote: [],
      });
      expect(preview.status).toBe(200);
      expect(await preview.json()).toMatchObject({ local: ['Preview fixture'] });

      for (const name of [
        'NODE_TLS_REJECT_UNAUTHORIZED',
        'GIT_CONFIG_COUNT',
        'RUBYLIB',
        'dyld_custom_library',
      ]) {
        for (const source of ['public', 'secret']) {
          const input: McpServerInput = { ...allowed, name: 'Rejected fixture' };
          if (source === 'public') input.publicEnvironment = { [name]: 'synthetic-value' };
          else input.secretSlots = [{ slotId: 'api', environmentName: name }];
          const requests = [
            ['/api/mcp/servers', 'POST', input],
            [`/api/mcp/servers/${server.id}`, 'PUT', { ...input, expectedRevision: 1 }],
            ['/api/mcp/configuration/preview', 'POST', { version: 1, local: [input], remote: [] }],
          ] as const;
          for (const [path, method, body] of requests) {
            const response = await value.send(path, method, body);
            expect(response.status, `${source} ${name} at ${path}`).toBe(422);
            expect(await response.json()).toMatchObject({ code: 'MCP_ENVIRONMENT_INVALID' });
          }
        }
      }
      expect(value.services.mcp.list()).toEqual([server]);
      expect(value.protocol.state.starts).toBe(0);
      expect(await value.credentials.list()).toEqual([]);
    } finally {
      await value.close();
    }
  });

  it('keeps GET and startup preview inert, validates CAS and requires each isolation scope explicitly', async () => {
    const value = await fixture();
    try {
      expect((await fetch(`${value.origin}/api/mcp/servers`)).status).toBe(401);
      expect(
        (await value.send('/api/mcp/servers', 'POST', { ...value.input, arbitrary: true })).status,
      ).toBe(400);
      expect(
        (
          await value.send('/api/mcp/servers', 'POST', {
            ...value.input,
            publicEnvironment: { NODE_OPTIONS: '--inspect' },
          })
        ).status,
      ).toBe(422);
      const server = await create(value);
      const path = `/api/mcp/servers/${server.id}`;
      expect((await value.send(path)).status).toBe(200);
      expect(await (await value.send(`${path}/tools?scope=sandboxed`)).json()).toBeNull();
      expect(value.protocol.state.starts).toBe(0);
      await trust(value, server.id);
      expect(value.protocol.state.starts).toBe(0);
      expect(
        (
          await value.send(`${path}/discover`, 'POST', {
            expectedRevision: 1,
            expectedAccessEpoch: 1,
            scope: 'full-access',
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await value.send(`${path}/discover`, 'POST', {
            expectedRevision: 1,
            expectedAccessEpoch: 1,
            scope: 'sandboxed',
          })
        ).status,
      ).toBe(200);
      expect(value.protocol.state.starts).toBe(1);
      const cached: unknown = await (await value.send(`${path}/tools?scope=sandboxed`)).json();
      expect(cached).toMatchObject({
        serverId: server.id,
        tools: [{ remoteToolName: 'echo', available: true }],
      });
      expect(value.protocol.state.starts).toBe(1);
      expect((await value.send(path, 'PUT', { ...value.input, expectedRevision: 9 })).status).toBe(
        409,
      );
      expect(
        (await value.send(path, 'PUT', { ...value.input, name: 'Changed', expectedRevision: 1 }))
          .status,
      ).toBe(200);
      expect(await (await value.send(`${path}/tools?scope=sandboxed`)).json()).toBeNull();
      expect(value.services.mcp.get(server.id)).toMatchObject({
        revision: 2,
        enabled: false,
        trustedScopes: [],
      });
    } finally {
      await value.close();
    }
  });

  it('writes fresh opaque system references and rolls them back when control changes during the write', async () => {
    const memory = createMemoryCredentialStore();
    let afterWrite: (() => Promise<void>) | undefined;
    const credentials: CredentialStore = {
      ...memory,
      async write(ref, secret) {
        await memory.write(ref, secret);
        if (afterWrite !== undefined) await afterWrite();
      },
    };
    const value = await fixture(credentials);
    try {
      const server = await create(value, {
        ...value.input,
        secretSlots: [{ slotId: 'api', environmentName: 'API_TOKEN' }],
      });
      const path = `/api/mcp/servers/${server.id}`;
      expect(
        (
          await value.send(`${path}/secrets/api`, 'POST', {
            expectedRevision: 1,
            value: 'synthetic-secret-one',
          })
        ).status,
      ).toBe(200);
      const originalRefs = await memory.list();
      expect(originalRefs).toHaveLength(1);
      expect(JSON.stringify(await (await value.send(path)).json())).not.toContain(originalRefs[0]);
      expect(JSON.stringify(await (await value.send(path)).json())).not.toContain(
        'synthetic-secret-one',
      );
      afterWrite = async () => {
        await value.services.mcp.disable(server.id, {
          expectedRevision: 2,
          expectedAccessEpoch: 1,
        });
      };
      const conflict = await value.send(`${path}/secrets/api`, 'POST', {
        expectedRevision: 2,
        value: 'synthetic-secret-two',
      });
      expect(conflict.status).toBe(409);
      expect(await memory.list()).toEqual(originalRefs);
      const originalRef = originalRefs[0];
      if (originalRef === undefined) throw new Error('Original credential missing');
      expect(await memory.read(originalRef)).toBe('synthetic-secret-one');
      expect(value.services.mcp.get(server.id)).toMatchObject({
        revision: 2,
        accessEpoch: 2,
        enabled: false,
      });
      afterWrite = undefined;
      expect(
        (
          await value.send(`${path}/secrets/api`, 'DELETE', {
            expectedRevision: 2,
            expectedAccessEpoch: 2,
          })
        ).status,
      ).toBe(200);
      expect(await memory.list()).toEqual([]);
    } finally {
      await value.close();
    }
  });

  it('freezes workspace and authorization, keeps accepted bindings on browser logout, and rejects explicit revocation', async () => {
    const value = await fixture();
    try {
      const server = await create(value);
      const path = `/api/mcp/servers/${server.id}`;
      await trust(value, server.id);
      await value.send(`${path}/discover`, 'POST', {
        expectedRevision: 1,
        expectedAccessEpoch: 1,
        scope: 'sandboxed',
      });
      const selection = [
        {
          serverId: server.id,
          serverRevision: 1,
          remoteToolName: 'echo',
          definitionFingerprint: value.protocol.tool.definitionFingerprint,
        },
      ];
      const signal = new AbortController().signal;
      const frozen = await value.services.mcp.freezeSelections(
        value.input.workspaceId,
        'ask',
        selection,
        signal,
      );
      expect(JSON.stringify(frozen)).not.toContain('credentialRef');
      expect(JSON.stringify(frozen)).not.toContain('/usr/bin/fixture');
      await expect(
        value.services.mcp.freezeSelections(null, 'ask', selection, signal),
      ).rejects.toThrow();
      await expect(
        value.services.mcp.freezeSelections(
          value.input.workspaceId,
          'read-only',
          selection,
          signal,
        ),
      ).rejects.toThrow();
      await expect(
        value.services.mcp.freezeSelections('another-workspace', 'ask', selection, signal),
      ).rejects.toThrow();
      expect((await value.send('/api/auth/logout', 'POST', {})).status).toBe(200);
      await expect(value.services.mcp.validateBindings(frozen, signal)).resolves.toBeUndefined();
      const selectedTool = frozen[0];
      if (selectedTool === undefined) throw new Error('Frozen tool missing');
      const encoded: unknown = JSON.parse(JSON.stringify(frozen));
      const restored = await value.services.mcp.restoreBindings(encoded as typeof frozen, signal);
      const restoredTool = restored[0];
      if (restoredTool === undefined) throw new Error('Restored tool missing');
      expect(Value.Check(restoredTool.definition.parameters, { text: 'valid' })).toBe(true);
      expect(Value.Check(restoredTool.definition.parameters, {})).toBe(false);
      expect(value.protocol.state.starts).toBe(1);
      let dispatched = false;
      const outcome = await value.services.mcp.call({
        tool: selectedTool,
        arguments: { text: 'hello' },
        callAttemptId: 'attempt',
        signal,
        beforeDispatch: () => {
          dispatched = true;
          return Promise.resolve();
        },
      });
      expect(outcome.kind).toBe('known');
      expect(dispatched).toBe(true);
      expect(value.protocol.state.active).toBe(0);
      await value.services.mcp.disable(server.id, { expectedRevision: 1, expectedAccessEpoch: 1 });
      await expect(value.services.mcp.validateBindings(frozen, signal)).rejects.toThrow();
      await expect(
        value.services.mcp.call({
          tool: selectedTool,
          arguments: {},
          callAttemptId: 'attempt-two',
          signal,
          beforeDispatch: () => Promise.resolve(),
        }),
      ).rejects.toThrow();
      expect(value.protocol.state.calls).toHaveLength(1);
      const preview = await value.services.mcp.preview(server.id, {
        expectedRevision: 1,
        expectedAccessEpoch: 2,
        scope: 'sandboxed',
      });
      await value.services.mcp.trust(server.id, {
        expectedRevision: 1,
        expectedAccessEpoch: 2,
        scope: 'sandboxed',
        startupFingerprint: preview.startupFingerprint,
      });
      await expect(value.services.mcp.validateBindings(frozen, signal)).rejects.toThrow();
    } finally {
      await value.close();
    }
  });

  it('blocks ordinary edits during a lease and revokes access before waiting for active cleanup', async () => {
    const value = await fixture();
    try {
      const server = await create(value);
      await trust(value, server.id);
      value.protocol.state.active = 1;
      expect(
        (
          await value.send(`/api/mcp/servers/${server.id}`, 'PUT', {
            ...value.input,
            expectedRevision: 1,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await value.send(`/api/mcp/servers/${server.id}/disable`, 'POST', {
            expectedRevision: 1,
            expectedAccessEpoch: 1,
          })
        ).status,
      ).toBe(200);
      expect(value.services.mcp.get(server.id)).toMatchObject({
        enabled: false,
        accessEpoch: 2,
        trustedScopes: [],
      });
      expect(value.protocol.state.invalidated).toEqual([server.id]);
      value.protocol.state.active = 0;
    } finally {
      await value.close();
    }
  });

  it('keeps a known server result when releasing its lease reports a separate cleanup failure', async () => {
    const value = await fixture();
    try {
      const server = await create(value);
      await trust(value, server.id);
      await value.send(`/api/mcp/servers/${server.id}/discover`, 'POST', {
        expectedRevision: 1,
        expectedAccessEpoch: 1,
        scope: 'sandboxed',
      });
      const signal = new AbortController().signal;
      const frozen = await value.services.mcp.freezeSelections(
        value.input.workspaceId,
        'ask',
        [
          {
            serverId: server.id,
            serverRevision: 1,
            remoteToolName: 'echo',
            definitionFingerprint: value.protocol.tool.definitionFingerprint,
          },
        ],
        signal,
      );
      const selected = frozen[0];
      if (selected === undefined) throw new Error('Frozen tool missing');
      const acquire = value.protocol.manager.acquire.bind(value.protocol.manager);
      value.protocol.manager.acquire = async (binding, options) => {
        const lease = await acquire(binding, options);
        return {
          ...lease,
          release: async () => {
            await lease.release();
            throw new Error('synthetic process cleanup error');
          },
        };
      };
      const outcome = await value.services.mcp.call({
        tool: selected,
        arguments: { text: 'value' },
        signal,
        callAttemptId: 'cleanup-attempt',
        beforeDispatch: () => Promise.resolve(),
      });
      expect(outcome.kind).toBe('known');
      expect(value.services.mcp.get(server.id).diagnostic).toContain('进程清理失败');
      expect(value.services.mcp.get(server.id).diagnostic).not.toContain('synthetic');
    } finally {
      await value.close();
    }
  });

  it('waits for an in-flight secret write to roll back before MCP shutdown completes', async () => {
    const memory = createMemoryCredentialStore();
    let resume = (): void => {
      throw new Error('Write gate is not ready');
    };
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let started = (): void => {
      throw new Error('Start gate is not ready');
    };
    const writingStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const credentials: CredentialStore = {
      ...memory,
      async write(ref, secret) {
        await memory.write(ref, secret);
        started();
        await gate;
      },
    };
    const value = await fixture(credentials);
    try {
      const server = await create(value, {
        ...value.input,
        secretSlots: [{ slotId: 'api', environmentName: 'API_TOKEN' }],
      });
      const writing = value.services.mcp.writeSecret(server.id, 'api', {
        expectedRevision: 1,
        value: 'synthetic-pending-secret',
      });
      const rejected = expect(writing).rejects.toThrow('关闭');
      await writingStarted;
      let closed = false;
      const closing = value.services.mcp.close().then(() => {
        closed = true;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      resume();
      await rejected;
      await closing;
      expect(await memory.list()).toEqual([]);
      expect(value.services.store.mcp.get(server.id)?.revision).toBe(1);
    } finally {
      resume();
      await value.close();
    }
  });

  it('does not grant a pending startup confirmation across profile identity revocation', async () => {
    const value = await fixture();
    let release = (): void => {
      throw new Error('Trust gate missing');
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let notify = (): void => {
      throw new Error('Trust observer missing');
    };
    const entered = new Promise<void>((resolve) => {
      notify = resolve;
    });
    try {
      const server = await create(value);
      const input = { expectedRevision: 1, expectedAccessEpoch: 1, scope: 'sandboxed' as const };
      const preview = await value.services.mcp.preview(server.id, input);
      const original = value.protocol.manager.previewLaunch.bind(value.protocol.manager);
      value.protocol.manager.previewLaunch = async (launch) => {
        notify();
        await gate;
        return original(launch);
      };
      const trusting = value.services.mcp.trust(server.id, {
        ...input,
        startupFingerprint: preview.startupFingerprint,
      });
      const rejected = expect(trusting).rejects.toThrow('身份授权已变化');
      await entered;
      await value.services.mcp.revokeIdentity();
      release();
      await rejected;
      expect(value.services.mcp.get(server.id)).toMatchObject({
        enabled: false,
        trustedScopes: [],
      });
    } finally {
      release();
      await value.close();
    }
  });

  it.skipIf(process.platform !== 'darwin')(
    'manages an actual official SDK server through explicit HTTP trust and discovery before one call',
    async () => {
      const value = await fixture(createMemoryCredentialStore(), true);
      try {
        const server = await create(value, {
          ...value.input,
          command: process.execPath,
          args: [
            fileURLToPath(
              new URL('../../../packages/integrations/test/fixture.mjs', import.meta.url),
            ),
          ],
          publicEnvironment: { FIXTURE_DIRECTORY: value.project, FIXTURE_MODE: 'normal' },
        });
        const path = `/api/mcp/servers/${server.id}`;
        await value.send('/api/mcp/servers');
        await value.send(path);
        await expect(stat(join(value.project, 'started'))).rejects.toThrow();
        await trust(value, server.id, 'full-access');
        await expect(stat(join(value.project, 'started'))).rejects.toThrow();
        const response = await value.send(`${path}/discover`, 'POST', {
          expectedRevision: 1,
          expectedAccessEpoch: 1,
          scope: 'full-access',
        });
        expect(response.status).toBe(200);
        const catalog = value.services.mcp.catalog(server.id, 'full-access');
        if (catalog === null || catalog.tools[0] === undefined)
          throw new Error('SDK directory is missing');
        const signal = new AbortController().signal;
        const selected = catalog.tools[0];
        const frozen = await value.services.mcp.freezeSelections(
          value.input.workspaceId,
          'full-access',
          [
            {
              serverId: selected.serverId,
              serverRevision: selected.serverRevision,
              remoteToolName: selected.remoteToolName,
              definitionFingerprint: selected.definitionFingerprint,
            },
          ],
          signal,
        );
        const selectedTool = frozen[0];
        if (selectedTool === undefined) throw new Error('Frozen tool missing');
        let barriers = 0;
        const outcome = await value.services.mcp.call({
          tool: selectedTool,
          arguments: { value: 'official SDK result' },
          callAttemptId: 'official-attempt',
          signal,
          beforeDispatch: () => {
            barriers += 1;
            return Promise.resolve();
          },
        });
        expect(outcome).toMatchObject({
          kind: 'known',
          isError: false,
          content: [{ type: 'text', text: 'official SDK result' }],
        });
        expect(barriers).toBe(1);
        const calls = (await readFile(join(value.project, 'calls'), 'utf8')).trim().split('\n');
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('official-attempt');
        expect(value.services.mcp.get(server.id).connectionState).toBe('disconnected');
      } finally {
        await value.close();
      }
    },
  );

  it.skipIf(process.platform !== 'darwin')(
    'proves no dispatch when authorization is revoked after the durable barrier callback',
    async () => {
      const value = await fixture(createMemoryCredentialStore(), true);
      let release = (): void => {
        throw new Error('Dispatch gate missing');
      };
      const barrierGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let notify = (): void => {
        throw new Error('Barrier observer missing');
      };
      const entered = new Promise<void>((resolve) => {
        notify = resolve;
      });
      try {
        const server = await create(value, {
          ...value.input,
          command: process.execPath,
          args: [
            fileURLToPath(
              new URL('../../../packages/integrations/test/fixture.mjs', import.meta.url),
            ),
          ],
          publicEnvironment: { FIXTURE_DIRECTORY: value.project, FIXTURE_MODE: 'normal' },
        });
        await trust(value, server.id, 'full-access');
        await value.send(`/api/mcp/servers/${server.id}/discover`, 'POST', {
          expectedRevision: 1,
          expectedAccessEpoch: 1,
          scope: 'full-access',
        });
        const tool = value.services.mcp
          .catalog(server.id, 'full-access')
          ?.tools.find((tool) => tool.remoteToolName === 'echo');
        if (tool === undefined) throw new Error('SDK echo tool missing');
        const signal = new AbortController().signal;
        const frozen = await value.services.mcp.freezeSelections(
          value.input.workspaceId,
          'full-access',
          [
            {
              serverId: server.id,
              serverRevision: 1,
              remoteToolName: tool.remoteToolName,
              definitionFingerprint: tool.definitionFingerprint,
            },
          ],
          signal,
        );
        const selected = frozen[0];
        if (selected === undefined) throw new Error('Frozen tool missing');
        const calling = value.services.mcp.call({
          tool: selected,
          arguments: { value: 'must not dispatch' },
          callAttemptId: 'revoked-barrier-attempt',
          signal,
          beforeDispatch: async () => {
            notify();
            await barrierGate;
          },
        });
        await entered;
        const disabling = value.services.mcp.disable(server.id, {
          expectedRevision: 1,
          expectedAccessEpoch: 1,
        });
        expect(value.services.store.mcp.get(server.id)).toMatchObject({
          enabled: false,
          accessEpoch: 2,
        });
        release();
        const outcome = await calling;
        await disabling;
        expect(outcome).toMatchObject({ kind: 'not-dispatched', cancelled: true });
        await expect(stat(join(value.project, 'calls'))).rejects.toThrow();
      } finally {
        release();
        await value.close();
      }
    },
  );
});
