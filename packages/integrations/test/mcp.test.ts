import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  McpConnectionManager,
  type McpCallInput,
  type McpConnectionBinding,
  type McpLease,
} from '../src/index.js';

const roots: string[] = [];
const managers: McpConnectionManager[] = [];
afterEach(async () => {
  await Promise.all(
    managers.splice(0).map(async (manager) => {
      await manager.close();
    }),
  );
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});
async function fixture(
  mode = 'normal',
): Promise<{ manager: McpConnectionManager; binding: McpConnectionBinding; root: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-mcp-test-')));
  const profileDirectory = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-mcp-profile-')));
  roots.push(root, profileDirectory);
  const manager = new McpConnectionManager({ startupDeadlineMs: 3000, callDeadlineMs: 2000 });
  managers.push(manager);
  const launch = {
    command: process.execPath,
    args: [
      fileURLToPath(
        new URL(
          mode.startsWith('excess-')
            ? './excess-content-fixture.mjs'
            : mode === 'backpressure'
              ? './backpressure-fixture.mjs'
              : './fixture.mjs',
          import.meta.url,
        ),
      ),
    ],
    workspaceRoot: root,
    profileDirectory,
    environment: { FIXTURE_DIRECTORY: root, FIXTURE_MODE: mode },
    secretDescriptors: [],
    scope: 'full-access' as const,
  };
  const preview = await manager.previewLaunch(launch);
  return {
    manager,
    root,
    binding: {
      ownerId: 'owner',
      identityEpoch: 1,
      serverId: 'server',
      serverRevision: 1,
      accessEpoch: 1,
      credentialEpoch: 1,
      grantId: 'grant',
      startupFingerprint: preview.startupFingerprint,
      launch,
    },
  };
}
function input(lease: McpLease, overrides: Partial<McpCallInput> = {}): McpCallInput {
  const tool = lease.catalog.tools[0];
  if (!tool) throw new Error('Missing fixture tool');
  return {
    tool,
    arguments: { value: 'hello' },
    callAttemptId: crypto.randomUUID(),
    beforeDispatch: async () => {},
    signal: new AbortController().signal,
    ...overrides,
  };
}
async function waitFile(path: string): Promise<string> {
  const deadline = performance.now() + 3000;
  for (;;) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      if (performance.now() >= deadline) throw new Error('Fixture did not report its event');
      await new Promise((accept) => {
        setTimeout(accept, 10);
      });
    }
  }
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

describe.skipIf(process.platform !== 'darwin')('official SDK over a supervised stdio lease', () => {
  it('previews executable/root identity without spawning and excludes secret bytes from trust fingerprints', async () => {
    const { manager, binding, root } = await fixture();
    await expect(readFile(join(root, 'started'))).rejects.toHaveProperty('code', 'ENOENT');
    const secretDescriptors = [
      { slotId: 'key', credentialRef: 'ref', credentialEpoch: 1, environmentName: 'FAKE_SECRET' },
    ];
    const first = await manager.previewLaunch({
      ...binding.launch,
      secretDescriptors,
      environment: { ...binding.launch.environment, FAKE_SECRET: 'fake-one' },
    });
    const second = await manager.previewLaunch({
      ...binding.launch,
      secretDescriptors,
      environment: { ...binding.launch.environment, FAKE_SECRET: 'fake-two' },
    });
    expect(first.startupFingerprint).toBe(second.startupFingerprint);
    const changed = await manager.previewLaunch({
      ...binding.launch,
      secretDescriptors: [
        {
          ...secretDescriptors[0],
          slotId: 'key',
          credentialRef: 'other',
          credentialEpoch: 2,
          environmentName: 'FAKE_SECRET',
        },
      ],
    });
    expect(changed.startupFingerprint).not.toBe(first.startupFingerprint);
  });
  it('discovers genuine schemas and sends exactly one call only after the durable barrier', async () => {
    const { manager, binding, root } = await fixture();
    const lease = await manager.acquire(binding, { signal: new AbortController().signal });
    const result = await lease.call(
      input(lease, {
        beforeDispatch: async () => {
          await expect(readFile(join(root, 'calls'))).rejects.toHaveProperty('code', 'ENOENT');
        },
      }),
    );
    expect(result).toMatchObject({
      kind: 'known',
      isError: false,
      content: [{ type: 'text', text: 'hello' }],
    });
    const lines = (await readFile(join(root, 'calls'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('my-pi-harness/call');
    const pid = Number(await readFile(join(root, 'started'), 'utf8'));
    await lease.release();
    expect(alive(pid)).toBe(false);
  });
  it('keeps another lease alive after a normal release and closes after the last release', async () => {
    const { manager, binding, root } = await fixture();
    const [first, second] = await Promise.all([
      manager.acquire(binding, { signal: new AbortController().signal }),
      manager.acquire(binding, { signal: new AbortController().signal }),
    ]);
    const pid = Number(await waitFile(join(root, 'started')));
    await first.release();
    expect(alive(pid)).toBe(true);
    expect(await second.call(input(second))).toMatchObject({ kind: 'known' });
    await second.release();
    expect(alive(pid)).toBe(false);
  });
  it('keeps configuration busy after the last lease release until the actual process close completes', async () => {
    const { manager, binding, root } = await fixture();
    const lease = await manager.acquire(binding, { signal: new AbortController().signal });
    const pid = Number(await waitFile(join(root, 'started')));
    expect(alive(pid)).toBe(true);
    let closed = false;
    const closing = lease.release();
    closing
      .finally(() => {
        closed = true;
      })
      .catch(() => {});
    // release synchronously enters the close owner; this gate observes its still-pending process/pipe cleanup.
    expect(closed).toBe(false);
    expect(manager.hasActiveLeases(binding.serverId)).toBe(true);
    await closing;
    expect(closed).toBe(true);
    expect(alive(pid)).toBe(false);
    expect(manager.hasActiveLeases(binding.serverId)).toBe(false);
  });
  it('revokes a send still awaiting fsync and waits before reporting no dispatch', async () => {
    const { manager, binding, root } = await fixture();
    const lease = await manager.acquire(binding, { signal: new AbortController().signal });
    let complete: () => void = () => {};
    let entered: () => void = () => {};
    const barrier = new Promise<void>((accept) => {
      complete = accept;
    });
    const started = new Promise<void>((accept) => {
      entered = accept;
    });
    const controller = new AbortController();
    let settled = false;
    const call = lease.call(
      input(lease, {
        signal: controller.signal,
        beforeDispatch: async () => {
          entered();
          await barrier;
        },
      }),
    );
    await started;
    controller.abort();
    call
      .finally(() => {
        settled = true;
      })
      .catch(() => {});
    await new Promise((accept) => {
      setImmediate(accept);
    });
    expect(settled).toBe(false);
    complete();
    expect(await call).toMatchObject({ kind: 'not-dispatched', cancelled: true });
    await expect(readFile(join(root, 'calls'))).rejects.toHaveProperty('code', 'ENOENT');
    await lease.release();
  });
  it('propagates a failed persistence barrier without writing or disguising storage failure', async () => {
    const { manager, binding, root } = await fixture();
    const lease = await manager.acquire(binding, { signal: new AbortController().signal });
    const failure = new Error('synthetic fsync failure');
    await expect(
      lease.call(input(lease, { beforeDispatch: () => Promise.reject(failure) })),
    ).rejects.toBe(failure);
    await expect(readFile(join(root, 'calls'))).rejects.toHaveProperty('code', 'ENOENT');
    await lease.release();
  });
  it('waits for an outstanding dispatch barrier during manager shutdown and prevents a late stdin write', async () => {
    const { manager, binding, root } = await fixture();
    const lease = await manager.acquire(binding, { signal: new AbortController().signal });
    let complete: () => void = () => {};
    let entered: () => void = () => {};
    const barrier = new Promise<void>((accept) => {
      complete = accept;
    });
    const started = new Promise<void>((accept) => {
      entered = accept;
    });
    const call = lease.call(
      input(lease, {
        beforeDispatch: async () => {
          entered();
          await barrier;
        },
      }),
    );
    await started;
    let stopped = false;
    const closing = manager.close();
    closing
      .finally(() => {
        stopped = true;
      })
      .catch(() => {});
    await new Promise((accept) => {
      setImmediate(accept);
    });
    expect(stopped).toBe(false);
    complete();
    expect(await call).toMatchObject({ kind: 'not-dispatched', cancelled: true });
    await closing;
    await expect(readFile(join(root, 'calls'))).rejects.toHaveProperty('code', 'ENOENT');
    await lease.release();
  });
  it('does not permit a completed attempt identity to dispatch twice on a connection', async () => {
    const { manager, binding, root } = await fixture();
    const lease = await manager.acquire(binding, { signal: new AbortController().signal });
    const requested = input(lease);
    expect(await lease.call(requested)).toMatchObject({ kind: 'known' });
    await expect(lease.call(requested)).rejects.toHaveProperty('code', 'DUPLICATE_ATTEMPT');
    expect((await readFile(join(root, 'calls'), 'utf8')).trim().split('\n')).toHaveLength(1);
    await lease.release();
  });
  it('rejects invalid parameters and changed definitions before the dispatch barrier', async () => {
    const { manager, binding, root } = await fixture();
    const lease = await manager.acquire(binding, { signal: new AbortController().signal });
    const requested = input(lease);
    expect(await lease.call({ ...requested, arguments: { value: 3 } })).toMatchObject({
      kind: 'not-dispatched',
      code: 'INVALID_ARGUMENTS',
    });
    expect(
      await lease.call({
        ...requested,
        tool: { ...requested.tool, definitionFingerprint: 'changed' },
      }),
    ).toMatchObject({ kind: 'not-dispatched', code: 'TOOL_CHANGED' });
    await expect(readFile(join(root, 'calls'))).rejects.toHaveProperty('code', 'ENOENT');
    await lease.release();
  });
  it('settles every pending shared call as unknown when the connection is revoked', async () => {
    const { manager, binding, root } = await fixture('hang');
    const [first, second] = await Promise.all([
      manager.acquire(binding, { signal: new AbortController().signal }),
      manager.acquire(binding, { signal: new AbortController().signal }),
    ]);
    const firstCall = first.call(input(first));
    const secondCall = second.call(input(second));
    const deadline = performance.now() + 3000;
    while ((await waitFile(join(root, 'calls'))).trim().split('\n').length !== 2) {
      if (performance.now() > deadline) throw new Error('Second call not received');
      await new Promise((accept) => {
        setTimeout(accept, 10);
      });
    }
    expect(manager.hasActiveLeases('server')).toBe(true);
    await manager.invalidateServer('server');
    expect(await firstCall).toMatchObject({ kind: 'unknown' });
    expect(await secondCall).toMatchObject({ kind: 'unknown' });
    await Promise.all([first.release(), second.release()]);
  });
  it('uses its own deadline and returns unknown after stdin handoff, without retrying', async () => {
    const { manager, binding, root } = await fixture('hang');
    const lease = await manager.acquire(binding, { signal: new AbortController().signal });
    expect(await lease.call(input(lease, { deadlineMs: 1000 }))).toMatchObject({ kind: 'unknown' });
    expect((await readFile(join(root, 'calls'), 'utf8')).trim().split('\n')).toHaveLength(1);
    expect(alive(Number(await readFile(join(root, 'started'), 'utf8')))).toBe(false);
    await lease.release();
  });
  it('closes a real paused stdin before waiting for a timed-out backpressured tool send', async () => {
    const { manager, binding, root } = await fixture('backpressure');
    const lease = await manager.acquire(binding, { signal: new AbortController().signal });
    expect(await waitFile(join(root, 'paused'))).toBe('ready');
    const pid = Number(await waitFile(join(root, 'started')));
    let timer: NodeJS.Timeout | undefined;
    const call = lease.call(
      input(lease, { arguments: { value: 'x'.repeat(250000) }, deadlineMs: 300 }),
    );
    const watchdog = new Promise<never>((_accept, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Backpressured send did not settle after its deadline'));
      }, 5000);
    });
    try {
      expect(await Promise.race([call, watchdog])).toMatchObject({ kind: 'unknown' });
      expect(alive(pid)).toBe(false);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      await manager.invalidateServer(binding.serverId);
      await call;
      await lease.release();
    }
  });
  it.each(['pollute', 'bad-utf8'])(
    'rejects %s stdout and retains unknown dispatch facts',
    async (mode) => {
      const { manager, binding } = await fixture(mode);
      const lease = await manager.acquire(binding, { signal: new AbortController().signal });
      expect(await lease.call(input(lease))).toMatchObject({ kind: 'unknown' });
      await lease.release();
    },
  );
  it.each(['excess-blocks', 'excess-structured'])(
    'keeps %s after dispatch unknown instead of returning an unstorable known result',
    async (mode) => {
      const { manager, binding, root } = await fixture(mode);
      const lease = await manager.acquire(binding, { signal: new AbortController().signal });
      expect(await lease.call(input(lease))).toMatchObject({ kind: 'unknown' });
      expect((await readFile(join(root, 'calls'), 'utf8')).trim().split('\n')).toHaveLength(1);
      expect(alive(Number(await readFile(join(root, 'started'), 'utf8')))).toBe(false);
      await lease.release();
    },
  );
  it('keeps a legal isError response as a known error result', async () => {
    const { manager, binding } = await fixture('error');
    const lease = await manager.acquire(binding, { signal: new AbortController().signal });
    expect(await lease.call(input(lease))).toMatchObject({ kind: 'known', isError: true });
    await lease.release();
  });
  it('places structuredContent into model-visible text', async () => {
    const { manager, binding } = await fixture('structured');
    const lease = await manager.acquire(binding, { signal: new AbortController().signal });
    const result = await lease.call(input(lease));
    expect(JSON.stringify(result)).toContain('MCP structured content');
    expect(JSON.stringify(result)).toContain('hello');
    await lease.release();
  });
  it('shows unsupported schemas without making them executable', async () => {
    const { manager, binding } = await fixture('bad-schema');
    const lease = await manager.acquire(binding, { signal: new AbortController().signal });
    expect(lease.catalog.tools[0]).toMatchObject({ supported: false, parameters: null });
    expect(await lease.call(input(lease))).toMatchObject({
      kind: 'not-dispatched',
      code: 'TOOL_CHANGED',
    });
    await lease.release();
  });
  it.each(['duplicate', 'repeated-cursor'])(
    'rejects bounded malformed catalog %s',
    async (mode) => {
      const { manager, binding } = await fixture(mode);
      await expect(
        manager.discover(binding, { signal: new AbortController().signal }),
      ).rejects.toHaveProperty('code', 'INVALID_CATALOG');
    },
  );
  it.each(['secret-catalog', 'secret-result'])(
    'does not expose direct credential echoes from %s',
    async (mode) => {
      const { manager, binding } = await fixture(mode);
      binding.launch.environment = {
        ...binding.launch.environment,
        FAKE_SECRET: 'fake-mcp-private-credential',
      };
      binding.launch.secretDescriptors = [
        { slotId: 'key', credentialRef: 'ref', credentialEpoch: 1, environmentName: 'FAKE_SECRET' },
      ];
      binding.startupFingerprint = (await manager.previewLaunch(binding.launch)).startupFingerprint;
      if (mode === 'secret-catalog') {
        await expect(
          manager.discover(binding, { signal: new AbortController().signal }),
        ).rejects.toMatchObject({ code: 'SECRET_ECHO' });
      } else {
        const lease = await manager.acquire(binding, { signal: new AbortController().signal });
        const result = await lease.call(input(lease));
        expect(result).toMatchObject({ kind: 'unknown' });
        expect(JSON.stringify(result)).not.toContain('fake-mcp-private');
        await lease.release();
      }
    },
  );
});
