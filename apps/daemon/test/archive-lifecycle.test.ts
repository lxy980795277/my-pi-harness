import { fstatSync, type PathLike, type RmOptions } from 'node:fs';
import type * as FsPromises from 'node:fs/promises';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { SessionSummary } from '@my-pi-harness/protocol';
import { openProfileStore, type ProfileStore } from '@my-pi-harness/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionArchiveService } from '../src/archives/service';

interface LifecycleFixture {
  directory: string;
  store: ProfileStore;
  service: SessionArchiveService;
  session: SessionSummary;
  errors: unknown[];
  closeService(): Promise<void>;
  cleanup(): Promise<void>;
}

const removals = vi.hoisted(() => ({
  armed: false,
  failure: null as Error | null,
  failedPath: null as string | null,
  attempts: [] as string[],
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>();
  return {
    ...original,
    rm: vi.fn(async (path: PathLike, options?: RmOptions): Promise<void> => {
      if (typeof path === 'string') {
        removals.attempts.push(path);
        if (
          removals.armed &&
          path.includes('my-pi-session-archives-') &&
          path.includes('operation-')
        ) {
          removals.armed = false;
          removals.failedPath = path;
          throw removals.failure ?? new Error('Injected stage removal failure');
        }
      }
      await original.rm(path, options);
    }),
  };
});

const fixtures: LifecycleFixture[] = [];

afterEach(async () => {
  const failures: unknown[] = [];
  removals.armed = false;
  for (const fixture of fixtures.splice(0).reverse()) {
    try {
      await fixture.cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  vi.restoreAllMocks();
  removals.failure = null;
  removals.failedPath = null;
  removals.attempts = [];
  if (failures.length !== 0) throw new AggregateError(failures, 'Archive fixture cleanup failed');
});

async function fixture(): Promise<LifecycleFixture> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'my-pi-archive-lifecycle-')));
  const profileDirectory = join(directory, 'profile');
  const store = await openProfileStore(profileDirectory);
  let service: SessionArchiveService;
  const errors: unknown[] = [];
  try {
    service = await SessionArchiveService.create({
      store,
      profileDirectory,
      runtime: {
        importedBindingCommand: () =>
          Promise.reject(new Error('Binding is unused by transfer tests')),
      },
      gateway: { resolve: () => Promise.reject(new Error('Models are unused by transfer tests')) },
      workspaces: {
        requireAvailable: () =>
          Promise.reject(new Error('Workspaces are unused by transfer tests')),
      },
      onError: (error) => errors.push(error),
    });
  } catch (error) {
    store.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  let serviceClosed = false;
  const session = store.createSession({
    id: randomUUID(),
    branchId: randomUUID(),
    title: 'Lifecycle fixture',
    providerId: 'unbound-fixture',
    modelId: 'model',
    thinkingLevel: 'off',
    approvalMode: 'ask',
    workspaceId: null,
    at: 1,
  });
  const result: LifecycleFixture = {
    directory,
    store,
    service,
    session,
    errors,
    closeService() {
      serviceClosed = true;
      return service.close();
    },
    async cleanup() {
      try {
        if (!serviceClosed) await result.closeService();
      } finally {
        store.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
  fixtures.push(result);
  return result;
}

async function completed(fixture: LifecycleFixture, operationId: string): Promise<void> {
  await vi.waitFor(() => expect(fixture.service.get(operationId).status).toBe('completed'), {
    timeout: 5000,
  });
}

function fileDescriptor(content: Readable): number {
  const descriptor: unknown = Reflect.get(content, 'fd');
  if (typeof descriptor !== 'number') throw new Error('Expected an actual open archive descriptor');
  return descriptor;
}

describe('archive transfer resource ownership', () => {
  it('destroys a blocked export source and releases its real resource lease before cancellation returns', async () => {
    const f = await fixture();
    const opened = vi.fn();
    const destroyed = vi.fn();
    const released = vi.fn();
    const blocked = new Readable({
      read() {
        opened();
      },
      destroy(error, callback) {
        destroyed(error);
        callback(error);
      },
    });
    const closed = Promise.allSettled([finished(blocked, { cleanup: true })]);
    const create = f.store.createSessionArchive.bind(f.store);
    vi.spyOn(f.store, 'createSessionArchive').mockImplementationOnce(async (id, options) => {
      const source = await create(id, options);
      return {
        ...source,
        entries: source.entries.map((entry, index) =>
          index === 0 ? { ...entry, open: () => blocked } : entry,
        ),
        release() {
          released();
          source.release();
        },
      };
    });
    const operationId = randomUUID();
    f.service.export(operationId, f.session.id);
    await vi.waitFor(() => expect(opened).toHaveBeenCalled(), { timeout: 5000 });
    expect((await f.service.cancel(operationId)).status).toBe('cancelled');
    await closed;
    expect(blocked.destroyed).toBe(true);
    expect(blocked.closed).toBe(true);
    expect(destroyed).toHaveBeenCalledTimes(1);
    expect(released).toHaveBeenCalledTimes(1);
    expect(f.service.get(operationId).downloadAvailable).toBe(false);
    expect(f.errors).toEqual([]);
  });

  it('bounds download leases and waits for every actual file descriptor to close during shutdown', async () => {
    const f = await fixture();
    const operationId = randomUUID();
    f.service.export(operationId, f.session.id);
    await completed(f, operationId);
    const downloads = Array.from({ length: 4 }, () => f.service.download(operationId));
    const descriptors = downloads.map(({ content }) => fileDescriptor(content));
    for (const descriptor of descriptors) expect(fstatSync(descriptor).isFile()).toBe(true);
    expect(() => f.service.download(operationId)).toThrow(
      expect.objectContaining({ code: 'ARCHIVE_BUSY' }),
    );
    await f.closeService();
    for (const { content } of downloads) {
      expect(content.destroyed).toBe(true);
      expect(content.closed).toBe(true);
    }
    for (const descriptor of descriptors)
      expect(() => fstatSync(descriptor)).toThrow(expect.objectContaining({ code: 'EBADF' }));
    expect(() => f.service.download(operationId)).toThrow(
      expect.objectContaining({ code: 'ARCHIVE_CLOSED' }),
    );
    expect(f.errors).toEqual([]);
  });

  it('retains a failed cleanup directory for shutdown retry and owns the background rejection', async () => {
    const f = await fixture();
    const readFailure = new Error('Injected archive source read failure');
    const cleanupFailure = new Error('Injected archive stage cleanup failure');
    const unhandled: unknown[] = [];
    const observeRejection = (error: unknown): void => {
      unhandled.push(error);
    };
    process.on('unhandledRejection', observeRejection);
    try {
      const create = f.store.createSessionArchive.bind(f.store);
      vi.spyOn(f.store, 'createSessionArchive').mockImplementationOnce(async (id, options) => {
        const source = await create(id, options);
        return {
          ...source,
          entries: source.entries.map((entry, index) =>
            index === 0
              ? {
                  ...entry,
                  open: () =>
                    new Readable({
                      read() {
                        this.destroy(readFailure);
                      },
                    }),
                }
              : entry,
          ),
        };
      });
      removals.armed = true;
      removals.failure = cleanupFailure;
      const operationId = randomUUID();
      f.service.export(operationId, f.session.id);
      await vi.waitFor(() => expect(f.errors).toContain(cleanupFailure), { timeout: 5000 });
      const failedPath = removals.failedPath;
      if (failedPath === null) throw new Error('Expected the real stage cleanup attempt');
      expect((await stat(failedPath)).isDirectory()).toBe(true);
      expect(f.errors).toContain(readFailure);
      expect(f.service.get(operationId).status).toBe('failed');
      const close = await Promise.allSettled([f.closeService()]);
      const failure = close[0];
      expect(failure?.status).toBe('rejected');
      if (failure?.status !== 'rejected' || !(failure.reason instanceof AggregateError))
        throw new Error('Expected an aggregated cleanup diagnostic');
      expect(failure.reason.errors).toContain(cleanupFailure);
      expect(removals.attempts.filter((path) => path === failedPath)).toHaveLength(2);
      await expect(stat(failedPath)).rejects.toHaveProperty('code', 'ENOENT');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', observeRejection);
    }
  });

  it('keeps durable completed imports authoritative after an outer response failure without importing twice', async () => {
    const source = await fixture();
    const target = await fixture();
    const exportId = randomUUID();
    source.service.export(exportId, source.session.id);
    await completed(source, exportId);
    const lease = source.service.download(exportId);
    const importId = randomUUID();
    const ready = await target.service.upload(
      importId,
      lease.content,
      new AbortController().signal,
    );
    expect(ready.status).toBe('ready');
    expect(ready.preview?.canImport).toBe(true);
    if (ready.archiveSha256 === null) throw new Error('Expected the verified transport digest');
    const responseFailure = new Error('Injected outer response failure after actual import');
    const publish = target.store.importSessionArchive.bind(target.store);
    const imported = vi
      .spyOn(target.store, 'importSessionArchive')
      .mockImplementationOnce(async (...args) => {
        await publish(...args);
        throw responseFailure;
      });
    target.service.commit(importId, ready.archiveSha256);
    await completed(target, importId);
    await vi.waitFor(() => expect(target.errors).toContain(responseFailure));
    expect(target.store.getSession(source.session.id)?.title).toBe(source.session.title);
    expect(target.service.commit(importId, ready.archiveSha256).status).toBe('completed');
    expect((await target.service.cancel(importId)).status).toBe('completed');
    expect(imported).toHaveBeenCalledTimes(1);
    expect(target.store.getSessionExecutionAccess(source.session.id).bound).toBe(false);
    expect(source.errors).toEqual([]);
    await target.closeService();
    expect(target.store.getSessionArchiveImport(importId)?.status).toBe('completed');
  });
});
