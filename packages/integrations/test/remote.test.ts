import { describe, expect, it } from 'vitest';
import { RemoteMcpManager } from '../src/remote.js';
import { parseRemoteUrl, assertRemoteAddress, createRemoteFetch } from '../src/remote-network.js';
import { remoteFixture } from '../../../tests/fixtures/remote-mcp.js';

for (const transport of ['streamable-http', 'sse'] as const)
  describe(`official SDK remote ${transport}`, () => {
    it('discovers bounded metadata and sends one call after the durable barrier', async () => {
      const fixture = await remoteFixture(transport);
      const manager = new RemoteMcpManager({
        fixtureOrigin: fixture.origin,
        startupDeadlineMs: 3000,
      });
      try {
        const lease = await manager.acquire(
          {
            serverId: 'server',
            endpoint: fixture.endpoint,
            transport,
            headers: {},
            secrets: [],
            authorizationKey: 'key',
          },
          { signal: AbortSignal.timeout(5000) },
        );
        expect(lease.catalog.resources?.[0]?.name).toBe('Fixture resource');
        expect(lease.catalog.prompts?.[0]?.name).toBe('fixture-prompt');
        const tool = lease.catalog.tools[0];
        if (tool === undefined) throw new Error('Missing tool');
        let barriers = 0;
        const outcome = await lease.call({
          tool,
          arguments: { value: 'hello' },
          callAttemptId: 'one',
          signal: AbortSignal.timeout(3000),
          beforeDispatch: () => {
            expect(fixture.calls()).toBe(0);
            barriers += 1;
            return Promise.resolve();
          },
        });
        expect(outcome).toMatchObject({
          kind: 'known',
          content: [{ type: 'text', text: 'hello' }],
        });
        expect(barriers).toBe(1);
        expect(fixture.calls()).toBe(1);
        await lease.release();
        expect(fixture.failures).toEqual([]);
      } finally {
        await manager.close();
        await fixture.close();
      }
    });
    it('does not send after a failed persistent barrier', async () => {
      const fixture = await remoteFixture(transport);
      const manager = new RemoteMcpManager({
        fixtureOrigin: fixture.origin,
        startupDeadlineMs: 3000,
      });
      try {
        const lease = await manager.acquire(
          {
            serverId: 'server',
            endpoint: fixture.endpoint,
            transport,
            headers: {},
            secrets: [],
            authorizationKey: 'key',
          },
          { signal: AbortSignal.timeout(5000) },
        );
        const tool = lease.catalog.tools[0];
        if (tool === undefined) throw new Error('Missing tool');
        await expect(
          lease.call({
            tool,
            arguments: { value: 'hello' },
            callAttemptId: 'one',
            signal: AbortSignal.timeout(3000),
            beforeDispatch: () => Promise.reject(new Error('fsync failure')),
          }),
        ).rejects.toThrow('fsync failure');
        expect(fixture.calls()).toBe(0);
        await lease.release();
      } finally {
        await manager.close();
        await fixture.close();
      }
    });
    it('keeps a disconnected dispatched call unknown without replay', async () => {
      const fixture = await remoteFixture(transport, 'disconnect');
      const manager = new RemoteMcpManager({
        fixtureOrigin: fixture.origin,
        startupDeadlineMs: 3000,
      });
      try {
        const lease = await manager.acquire(
          {
            serverId: 'server',
            endpoint: fixture.endpoint,
            transport,
            headers: {},
            secrets: [],
            authorizationKey: 'key',
          },
          { signal: AbortSignal.timeout(5000) },
        );
        const tool = lease.catalog.tools[0];
        if (tool === undefined) throw new Error('Missing tool');
        expect(
          await lease.call({
            tool,
            arguments: { value: 'hello' },
            callAttemptId: 'one',
            deadlineMs: 500,
            signal: AbortSignal.timeout(2000),
            beforeDispatch: async () => {},
          }),
        ).toMatchObject({ kind: 'unknown' });
        expect(fixture.calls()).toBe(1);
        await lease.release();
      } finally {
        await manager.close();
        await fixture.close();
      }
    });
  });
describe('remote network policy', () => {
  it.each([
    'http://example.com/mcp',
    'https://127.0.0.1/mcp',
    'https://10.1.2.3/mcp',
    'https://[::1]/mcp',
    'https://user:pass@example.com/mcp',
    'https://example.com:444/mcp',
    'https://example.com/mcp#fragment',
    'https://metadata.internal/mcp',
    'https://example.com/mcp?access_token=secret',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => parseRemoteUrl(url)).toThrow();
  });
  it.each(['169.254.169.254', '192.168.1.1', '::ffff:127.0.0.1', '2001:db8::1'])(
    'rejects reserved socket address %s',
    (address) => {
      expect(() => assertRemoteAddress(address)).toThrow();
    },
  );
  it('rejects redirects instead of forwarding static authorization', async () => {
    const fixture = await remoteFixture('streamable-http', 'redirect');
    try {
      const fetch = createRemoteFetch({
        fixtureOrigin: fixture.origin,
        allowedOrigins: new Set([fixture.origin]),
      });
      await expect(
        fetch(fixture.endpoint, { headers: { authorization: 'fake-private-token' } }),
      ).rejects.toThrow('重定向');
      expect(fixture.requests()).toBe(1);
    } finally {
      await fixture.close();
    }
  });
  it('rejects an SSE POST endpoint on another origin', async () => {
    const fixture = await remoteFixture('sse', 'cross-origin');
    const manager = new RemoteMcpManager({ fixtureOrigin: fixture.origin, startupDeadlineMs: 500 });
    try {
      await expect(
        manager.discover(
          {
            serverId: 'server',
            endpoint: fixture.endpoint,
            transport: 'sse',
            headers: { Authorization: 'fake-private-token' },
            secrets: ['fake-private-token'],
            authorizationKey: 'key',
          },
          { signal: AbortSignal.timeout(1000) },
        ),
      ).rejects.toThrow();
      expect(fixture.calls()).toBe(0);
    } finally {
      await manager.close();
      await fixture.close();
    }
  });
});
