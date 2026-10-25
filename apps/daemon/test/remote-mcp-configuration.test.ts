import { createServer, type RequestListener } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Value } from 'typebox/value';
import { RemoteMcpDraftTestResultSchema, type RemoteMcpInput } from '@my-pi-harness/protocol';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { remoteFixture } from '../../../tests/fixtures/remote-mcp.js';
import { loadDaemonConfig } from '../src/config.js';
import { createApplicationServices } from '../src/services.js';
import { createDaemonApplication } from '../src/server.js';
import { loginFixture } from './support/login.js';

async function fixture(remoteFixtureOrigin?: string) {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-remote-config-'));
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
  });
  const credentials = createMemoryCredentialStore();
  const services = await createApplicationServices(config, {
    credentials,
    ...(remoteFixtureOrigin === undefined ? {} : { remoteFixtureOrigin }),
  });
  const application = await createDaemonApplication(config, undefined, services);
  const origin = await application.server.listen({ host: '127.0.0.1', port: 0 });
  const identity = await loginFixture(origin, services);
  return {
    services,
    credentials,
    send: (path: string, body: unknown, signal = AbortSignal.timeout(5000)) =>
      fetch(`${origin}${path}`, {
        method: 'POST',
        headers: {
          Cookie: identity.cookie,
          Origin: origin,
          'X-CSRF-Token': identity.csrf,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      }),
    close: async () => {
      await application.server.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function upstream(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      accept();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing upstream port');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((accept, reject) => {
        server.close((error) => {
          if (error === undefined) accept();
          else reject(error);
        });
      });
    },
  };
}

const input: RemoteMcpInput = {
  name: 'configured-mcp',
  transport: 'streamable-http',
  endpoint: 'https://example.com/mcp',
  publicHeaders: {},
  secretHeaders: [{ slotId: 'api', headerName: 'X-Api-Key' }],
  oauth: false,
};

describe('remote MCP draft connection and configuration ownership', () => {
  it.each(['streamable-http', 'sse'] as const)(
    'uses the real SDK %s handshake and metadata without saving or calling tools',
    async (transport) => {
      const remote = await remoteFixture(transport);
      const f = await fixture(remote.origin);
      const write = vi.spyOn(f.credentials, 'write');
      const read = vi.spyOn(f.credentials, 'read');
      try {
        const response = await f.send('/api/mcp/remote-servers/test-draft', {
          transport,
          endpoint: remote.endpoint,
          headers: {
            Authorization: 'Bearer synthetic-draft-only-secret',
            'X-Workspace-Access': 'synthetic-arbitrary-header-secret',
          },
        });
        expect(response.status).toBe(200);
        const result: unknown = await response.json();
        expect(Value.Check(RemoteMcpDraftTestResultSchema, result)).toBe(true);
        expect(result).toMatchObject({
          connected: true,
          toolCount: 1,
          resourceCount: 1,
          promptCount: 1,
        });
        expect(JSON.stringify(result)).not.toContain('synthetic-draft-only-secret');
        expect(JSON.stringify(result)).not.toContain('synthetic-arbitrary-header-secret');
        expect(remote.requests()).toBeGreaterThan(0);
        expect(remote.calls()).toBe(0);
        expect(f.services.remoteMcp.list()).toEqual([]);
        expect(f.services.store.remoteMcp.list()).toEqual([]);
        expect(write).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
        expect(
          await f.services.remoteMcp.freezeCandidates(
            null,
            'ask',
            'execute',
            AbortSignal.timeout(1000),
          ),
        ).toEqual([]);
      } finally {
        await f.close();
        await remote.close();
      }
    },
  );

  it.each([
    { transport: 'streamable-http', status: 403 },
    { transport: 'sse', status: 401 },
  ] as const)(
    'reports $transport authentication $status without upstream secrets or OAuth',
    async ({ transport, status }) => {
      const paths: string[] = [];
      const remote = await upstream((request, response) => {
        paths.push(request.url ?? '');
        response.writeHead(status, { 'X-Upstream-Secret': 'synthetic-upstream-secret' });
        response.end('synthetic-upstream-secret');
      });
      const f = await fixture(remote.origin);
      try {
        const response = await f.send('/api/mcp/remote-servers/test-draft', {
          transport,
          endpoint: `${remote.origin}/mcp`,
          headers: { 'X-Workspace-Access': 'synthetic-input-secret' },
        });
        expect(response.status).toBe(422);
        const result = await response.text();
        expect(result).toContain('AUTHENTICATION_REQUIRED');
        expect(result).not.toContain('synthetic-upstream-secret');
        expect(result).not.toContain('synthetic-input-secret');
        expect(paths.length).toBeGreaterThan(0);
        expect(paths.every((path) => path === '/mcp')).toBe(true);
        expect(f.services.remoteMcp.list()).toEqual([]);
      } finally {
        await f.close();
        await remote.close();
      }
    },
  );

  it('rejects unknown fields, private destinations and unsafe or duplicate headers before requests', async () => {
    let requests = 0;
    const remote = await upstream((_request, response) => {
      requests += 1;
      response.end();
    });
    const f = await fixture(remote.origin);
    try {
      const draft = { transport: 'streamable-http', endpoint: `${remote.origin}/mcp`, headers: {} };
      const rejected = [
        { ...draft, connectionId: 'must-not-read-saved-credentials' },
        { ...draft, serverId: 'must-not-read-saved-credentials' },
        { ...draft, transport: 'stdio' },
        { ...draft, endpoint: 'https://127.0.0.1/mcp' },
        { ...draft, headers: { Cookie: 'private-cookie' } },
        { ...draft, headers: { Host: 'other.example' } },
        { ...draft, headers: { 'MCP-Session-ID': 'other-session' } },
        { ...draft, headers: { Authorization: 'secret', authorization: 'different' } },
        { ...draft, headers: { Authorization: 'secret\r\nInjected: value' } },
      ];
      for (const body of rejected)
        expect(
          (await f.send('/api/mcp/remote-servers/test-draft', body)).status,
        ).toBeGreaterThanOrEqual(400);
      expect(requests).toBe(0);
      expect(f.services.remoteMcp.list()).toEqual([]);
    } finally {
      await f.close();
      await remote.close();
    }
  });

  it('cancels a draft probe when its HTTP caller aborts and closes the upstream request', async () => {
    let receive = (): void => {
      throw new Error('The draft request arrival gate has not initialized');
    };
    const arrived = new Promise<void>((resolve) => {
      receive = resolve;
    });
    let closed = false;
    const remote = await upstream((request, response) => {
      request.resume();
      response.once('close', () => {
        closed = true;
      });
      receive();
    });
    const f = await fixture(remote.origin);
    const controller = new AbortController();
    const result = (async (): Promise<boolean> => {
      try {
        const response = await f.send(
          '/api/mcp/remote-servers/test-draft',
          {
            transport: 'streamable-http',
            endpoint: `${remote.origin}/mcp`,
            headers: {},
          },
          controller.signal,
        );
        await response.body?.cancel();
        return false;
      } catch {
        return controller.signal.aborted;
      }
    })();
    try {
      await arrived;
      controller.abort();
      expect(await result).toBe(true);
      await expect.poll(() => closed).toBe(true);
      expect(f.services.remoteMcp.list()).toEqual([]);
    } finally {
      controller.abort();
      await result;
      await f.close();
      await remote.close();
    }
  });

  it('keeps matching header secrets at the same target but still revokes startup authorization', async () => {
    const f = await fixture();
    try {
      let server = f.services.remoteMcp.create({ ...input, connectionId: 'previous-connection' });
      server = await f.services.remoteMcp.writeSecret(server.id, 'api', {
        expectedRevision: server.revision,
        value: 'synthetic-kept-secret',
      });
      const binding = f.services.store.remoteMcp.get(server.id)?.secretBindings[0];
      if (binding?.credentialRef === null || binding?.credentialRef === undefined)
        throw new Error('Missing saved credential reference');
      const control = {
        expectedRevision: server.revision,
        expectedAccessEpoch: server.accessEpoch,
      };
      const preview = f.services.remoteMcp.preview(server.id, control);
      f.services.remoteMcp.trust(server.id, { ...control, fingerprint: preview.fingerprint });
      const updated = await f.services.remoteMcp.update(server.id, {
        ...input,
        name: 'renamed-mcp',
        publicHeaders: { 'X-Project': 'different-scope' },
        expectedRevision: server.revision,
      });
      expect(updated.secretHeaders[0]?.configured).toBe(true);
      expect(updated).toMatchObject({
        enabled: false,
        trusted: false,
        revision: server.revision + 1,
      });
      expect(updated).not.toHaveProperty('connectionId');
      expect(f.services.store.remoteMcp.get(server.id)?.secretBindings[0]).toEqual(binding);
      expect(await f.credentials.read(binding.credentialRef)).toBe('synthetic-kept-secret');
    } finally {
      await f.close();
    }
  });

  it.each(['endpoint', 'transport', 'slot', 'header'] as const)(
    'does not retain old credentials after changing the %s',
    async (change) => {
      const f = await fixture();
      try {
        let server = f.services.remoteMcp.create(input);
        server = await f.services.remoteMcp.writeSecret(server.id, 'api', {
          expectedRevision: server.revision,
          value: 'synthetic-removed-secret',
        });
        const previous = f.services.store.remoteMcp.get(server.id)?.secretBindings[0]
          ?.credentialRef;
        if (previous === null || previous === undefined) throw new Error('Missing saved secret');
        const update = { ...input, expectedRevision: server.revision };
        if (change === 'endpoint') update.endpoint = 'https://example.com/changed-path';
        if (change === 'transport') update.transport = 'sse';
        if (change === 'slot')
          update.secretHeaders = [{ slotId: 'changed', headerName: 'X-Api-Key' }];
        if (change === 'header')
          update.secretHeaders = [{ slotId: 'api', headerName: 'X-Other-Key' }];
        const saved = await f.services.remoteMcp.update(server.id, update);
        expect(saved.secretHeaders[0]?.configured).toBe(false);
        expect(saved).toMatchObject({ trusted: false, enabled: false });
        expect(await f.credentials.read(previous)).toBeUndefined();
      } finally {
        await f.close();
      }
    },
  );

  it('rejects duplicate aliases on create and update without partially changing either configuration', async () => {
    const f = await fixture();
    try {
      const first = f.services.remoteMcp.create(input);
      const second = f.services.remoteMcp.create({ ...input, name: 'second-mcp' });
      expect(() => f.services.remoteMcp.create({ ...input, name: ' CONFIGURED-MCP ' })).toThrow(
        'MCP ID已存在',
      );
      await expect(
        f.services.remoteMcp.update(second.id, {
          ...input,
          expectedRevision: second.revision,
        }),
      ).rejects.toThrow('MCP ID已存在');
      expect(f.services.remoteMcp.get(first.id)).toEqual(first);
      expect(f.services.remoteMcp.get(second.id)).toEqual(second);
      expect(f.services.remoteMcp.list()).toHaveLength(2);
    } finally {
      await f.close();
    }
  });
});
