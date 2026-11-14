import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { StorageError } from '@my-pi-harness/storage';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileChangeBatchReceipt } from '@my-pi-harness/protocol';
import { fileChangesFixture, hashBytes } from './support/file-changes';
import { recoverFileChanges } from '../src/file-changes/recovery';

type Fixture = Awaited<ReturnType<typeof fileChangesFixture>>;
const owned: Fixture[] = [];
async function fixture(): Promise<Fixture> {
  const value = await fileChangesFixture();
  owned.push(value);
  return value;
}
async function settle(value: Fixture, id: string): Promise<FileChangeBatchReceipt> {
  await vi.waitFor(() =>
    expect(value.store.getFileChangeBatch('session', id).status).not.toMatch(
      /^(accepted|running)$/,
    ),
  );
  expect(value.errors).toEqual([]);
  return value.store.getFileChangeBatch('session', id);
}
async function restore(
  value: Fixture,
  action: 'undo' | 'redo',
  changeIds: string[],
): Promise<FileChangeBatchReceipt> {
  const operationId = randomUUID();
  value.batches.accept('session', {
    operationId,
    action,
    selection: { kind: 'changes', changeIds },
  });
  return await settle(value, operationId);
}
afterEach(async () => {
  for (const value of owned.splice(0)) await value.close();
});

describe('durable native file publications', () => {
  it('uses one physical file history across nested workspace registrations', async () => {
    const value = await fixture();
    const nested = join(value.root, 'nested');
    await mkdir(nested);
    const workspace = await value.workspaces.create({ rootPath: nested });
    const other = value.session('other', workspace.id);
    await value.modify('nested/file.txt', 'A');
    const original = value.store.listFileChanges('session').items[0];
    await value.files.modify(
      other,
      {
        path: 'file.txt',
        expectedHash: hashBytes(Buffer.from('A')),
        prepare: () => ({ content: Buffer.from('B'), result: { summary: 'Written', content: [] } }),
      },
      value.invocation(other),
    );
    const next = value.store.listFileChanges('other').items[0];
    if (original === undefined || next === undefined)
      throw new Error('Missing shared file history');
    expect(value.store.getFileChangeRecord('other', next.changeId).previousChangeId).toBe(
      original.changeId,
    );
    expect(value.store.getFileChange('session', original.changeId).change.undoAvailable).toBe(
      false,
    );
  });

  it('recovers a confirmed file outcome when only the batch progress append was interrupted', async () => {
    const value = await fixture();
    await value.modify('file.txt', 'A');
    const change = value.store.listFileChanges('session').items[0];
    if (change === undefined) throw new Error('Missing file history');
    const update = value.store.updateFileChangeBatchItem.bind(value.store);
    const fault = vi
      .spyOn(value.store, 'updateFileChangeBatchItem')
      .mockImplementation((sessionId, id, item, at) => {
        if (item.status === 'applied')
          throw new StorageError(
            'SESSION_LOG_UNAVAILABLE',
            'Process stopped before progress append',
          );
        return update(sessionId, id, item, at);
      });
    const operationId = randomUUID();
    value.batches.accept('session', {
      operationId,
      action: 'undo',
      selection: { kind: 'changes', changeIds: [change.changeId] },
    });
    await vi.waitFor(() => expect(value.errors).toHaveLength(1));
    fault.mockRestore();
    await recoverFileChanges(value.store, value.files);
    expect(value.store.getFileChangeBatch('session', operationId)).toMatchObject({
      status: 'interrupted',
      items: [{ status: 'applied' }],
    });
    await expect(readFile(join(value.root, 'file.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restores exact BOM/CRLF bytes and permission bits through a reversed multi-change chain', async () => {
    const value = await fixture();
    const path = join(value.root, 'file.txt');
    const original = Buffer.from('\uFEFF原文\r\n');
    await writeFile(path, original);
    await chmod(path, 0o675);
    await value.modify('file.txt', '第二版\n');
    await value.modify('file.txt', '第三版\r\n');
    const ids = value.store.listFileChanges('session').items.map((item) => item.changeId);
    expect((await stat(path)).mode & 0o777).toBe(0o675);
    expect((await restore(value, 'undo', ids)).status).toBe('completed');
    expect(await readFile(path)).toEqual(original);
    expect((await stat(path)).mode & 0o777).toBe(0o675);
    expect((await restore(value, 'redo', ids)).status).toBe('completed');
    expect(await readFile(path, 'utf8')).toBe('第三版\r\n');
    expect(value.store.collectUnreferencedArtifacts()).toBe(0);
  });

  it('distinguishes an absent file from an empty one and omits unchanged writes', async () => {
    const value = await fixture();
    await value.modify('empty.txt', '');
    const id = value.store.listFileChanges('session').items[0]?.changeId;
    if (id === undefined) throw new Error('Missing empty file change');
    await value.modify('empty.txt', '');
    expect(value.store.listFileChanges('session').items).toHaveLength(1);
    expect((await restore(value, 'undo', [id])).status).toBe('completed');
    await expect(readFile(join(value.root, 'empty.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await restore(value, 'redo', [id])).status).toBe('completed');
    expect(await readFile(join(value.root, 'empty.txt'))).toEqual(Buffer.alloc(0));
  });

  it('records conflicts without overwriting external edits and still applies independent selected files', async () => {
    const value = await fixture();
    await value.modify('first.txt', 'first');
    await value.modify('second.txt', 'second');
    const ids = value.store.listFileChanges('session').items.map((item) => item.changeId);
    await writeFile(join(value.root, 'first.txt'), 'outside');
    const result = await restore(value, 'undo', ids);
    expect(result.status).toBe('partial');
    expect(result.items.map((item) => item.status)).toEqual(['applied', 'conflict']);
    expect(await readFile(join(value.root, 'first.txt'), 'utf8')).toBe('outside');
    await expect(readFile(join(value.root, 'second.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('shares one write gate across sessions and rejects the second stale preimage', async () => {
    const value = await fixture();
    const other = value.session('other');
    await writeFile(join(value.root, 'file.txt'), 'A');
    const input = (text: string) => ({
      path: 'file.txt',
      expectedHash: hashBytes(Buffer.from('A')),
      prepare: () => ({ content: Buffer.from(text), result: { summary: 'Written', content: [] } }),
    });
    const calls = await Promise.allSettled([
      value.files.modify(value.owner, input('B'), value.invocation()),
      value.files.modify(other, input('C'), value.invocation(other)),
    ]);
    expect(calls.map((item) => item.status)).toEqual(['fulfilled', 'rejected']);
    expect(await readFile(join(value.root, 'file.txt'), 'utf8')).toBe('B');
    expect(value.store.listFileChanges('other').items).toHaveLength(0);
  });

  it('returns the original durable receipt on a repeated operation ID and refuses a changed action', async () => {
    const value = await fixture();
    await value.modify('file.txt', 'A');
    const changeId = value.store.listFileChanges('session').items[0]?.changeId;
    if (changeId === undefined) throw new Error('Missing file change');
    const input = {
      operationId: randomUUID(),
      action: 'undo' as const,
      selection: { kind: 'changes' as const, changeIds: [changeId] },
    };
    value.batches.accept('session', input);
    const original = await settle(value, input.operationId);
    expect(value.batches.accept('session', input)).toEqual(original);
    expect(() => value.batches.accept('session', { ...input, action: 'redo' })).toThrow(
      'different content',
    );
    await expect(readFile(join(value.root, 'file.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rechecks after batch preflight and preserves a conflicting later file', async () => {
    const value = await fixture();
    await value.modify('first.txt', 'first');
    await value.modify('second.txt', 'second');
    const original = value.files.restore.bind(value.files);
    let calls = 0;
    vi.spyOn(value.files, 'restore').mockImplementation(async (...args) => {
      if (++calls === 2) await writeFile(join(value.root, 'first.txt'), 'external after preflight');
      return await original(...args);
    });
    const result = await restore(
      value,
      'undo',
      value.store.listFileChanges('session').items.map((item) => item.changeId),
    );
    expect(result.items.map((item) => item.status)).toEqual(['applied', 'conflict']);
    expect(await readFile(join(value.root, 'first.txt'), 'utf8')).toBe('external after preflight');
  });

  it('cancels remaining items after an already started atomic operation settles', async () => {
    const value = await fixture();
    await value.modify('first.txt', 'first');
    await value.modify('second.txt', 'second');
    const operationId = randomUUID();
    const original = value.files.restore.bind(value.files);
    vi.spyOn(value.files, 'restore').mockImplementation(async (...args) => {
      const result = await original(...args);
      value.batches.cancel('session', operationId);
      return result;
    });
    value.batches.accept('session', {
      operationId,
      action: 'undo',
      selection: {
        kind: 'changes',
        changeIds: value.store.listFileChanges('session').items.map((item) => item.changeId),
      },
    });
    const result = await settle(value, operationId);
    expect(result).toMatchObject({
      status: 'cancelled',
      cancelRequested: true,
      items: [{ status: 'applied' }, { status: 'cancelled' }],
    });
    expect(await readFile(join(value.root, 'first.txt'), 'utf8')).toBe('first');
  });

  it('records a proven pre-publication failure and leaves the original bytes untouched', async () => {
    const value = await fixture();
    await writeFile(join(value.root, 'file.txt'), 'before');
    const call = value.invocation();
    const confirmed = vi.fn();
    await expect(
      value.files.modify(
        value.owner,
        {
          path: 'file.txt',
          expectedHash: hashBytes(Buffer.from('before')),
          prepare: () => ({
            content: Buffer.from('after'),
            result: { summary: 'Written', content: [] },
          }),
        },
        {
          ...call,
          beforePublish: () => {
            throw new Error('Durable barrier failed before syscall');
          },
          confirmNotPublished: confirmed,
        },
      ),
    ).rejects.toThrow();
    expect(confirmed).toHaveBeenCalledOnce();
    expect(await readFile(join(value.root, 'file.txt'), 'utf8')).toBe('before');
    expect(value.store.listFileChanges('session').items[0]?.status).toBe('not_applied');
  });

  it('observes a missing completion as unknown without replaying the write or granting undo eligibility', async () => {
    const value = await fixture();
    const complete = vi.spyOn(value.store, 'completeFileOperation').mockImplementationOnce(() => {
      throw new Error('Process stopped after publication');
    });
    await expect(value.modify('file.txt', 'published')).rejects.toThrow('Process stopped');
    complete.mockRestore();
    expect(await readFile(join(value.root, 'file.txt'), 'utf8')).toBe('published');
    await recoverFileChanges(value.store, value.files);
    const change = value.store.listFileChanges('session').items[0];
    expect(change).toMatchObject({ status: 'unknown', undoAvailable: false });
    if (change === undefined) throw new Error('Missing uncertain operation');
    expect(value.store.getFileOperation('session', change.changeId)).toMatchObject({
      observation: { match: 'after' },
    });
    await value.modify('file.txt', 'new baseline');
    expect(
      value.store.getFileChangeRecord(
        'session',
        value.store.listFileChanges('session').items[0]?.changeId ?? '',
      ),
    ).toMatchObject({ previousChangeId: null });
  });

  it.each(['prepared', 'unknown'] as const)(
    'recovers an archived %s publication after reopening and permits a new same-target write',
    async (status) => {
      const value = await fixture();
      const complete = value.store.completeFileOperation.bind(value.store);
      const stopped = vi
        .spyOn(value.store, 'completeFileOperation')
        .mockImplementationOnce((sessionId, id, _outcome, at) => {
          if (status === 'unknown')
            complete(sessionId, id, { status, error: 'Publication could not be confirmed' }, at);
          throw new Error('Process stopped after publication');
        });
      try {
        await expect(value.modify('file.txt', 'published')).rejects.toThrow('Process stopped');
      } finally {
        stopped.mockRestore();
      }
      const operation = value.store.listPendingFileOperations().items[0];
      if (operation === undefined) throw new Error('Missing uncertain file publication');
      expect(operation.status).toBe(status);
      value.store.append('session', [
        {
          type: 'run.finished',
          runId: value.owner.runId,
          at: Date.now(),
          data: { status: 'failed', finishedAt: Date.now(), error: 'Publication uncertain' },
        },
        { type: 'session.deleted', runId: null, at: Date.now(), data: {} },
      ]);
      await value.reopen();
      await recoverFileChanges(value.store, value.files);
      expect(await readFile(join(value.root, 'file.txt'), 'utf8')).toBe('published');
      expect(value.store.getSession('session')).toBeUndefined();
      expect(value.store.listPendingFileOperations().items).toEqual([]);
      expect(value.store.readEvents('session').at(-1)).toMatchObject({
        type: 'file.operation.observed',
        data: {
          operationId: operation.intent.operationId,
          observation: { match: 'after' },
        },
      });
      expect(value.store.getFileChangeHead(operation.intent.targetKey)).toMatchObject({
        pendingOperationId: null,
        uncertainOperationId: operation.intent.operationId,
      });
      const other = value.session('other');
      await value.modify('file.txt', 'new baseline', other);
      expect(await readFile(join(value.root, 'file.txt'), 'utf8')).toBe('new baseline');
      const baseline = value.store.listFileChanges('other').items[0];
      if (baseline === undefined) throw new Error('Missing new baseline');
      expect(value.store.getFileChangeRecord('other', baseline.changeId)).toMatchObject({
        previousChangeId: null,
        applied: true,
      });
    },
  );
});
