import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { FileChangeImage, ToolCallRecord } from '@my-pi-harness/protocol';
import type { EventInput, FileOperationPrepare } from '@my-pi-harness/protocol/internal';
import { openProfileStore, sessionLogDirectory, type ProfileStore } from '../src/index';
import { storedToolCallId } from '../src/sessions/projections/tool-intents';
import { SessionJournal } from '../src/sessions/session-jsonl';

interface Fixture {
  directory: string;
  store: ProfileStore;
}
const owned: Fixture[] = [];
const targetKey = 'c'.repeat(64);
const identity = { device: '1', inode: '2' };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function event(
  type: string,
  data: EventInput['data'],
  sessionId = 'session',
  privateData?: EventInput['privateData'],
): EventInput {
  return {
    type,
    data,
    runId: `run-${sessionId}`,
    at: 10,
    ...(privateData === undefined ? {} : { privateData }),
  };
}
async function fixture(): Promise<Fixture> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'file-history-')));
  const store = await openProfileStore(directory);
  const value = { directory, store };
  owned.push(value);
  store.createWorkspace({
    id: 'workspace',
    name: 'Workspace',
    icon: 'folder',
    rootPath: directory,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  session(store, 'session');
  return value;
}
function session(store: ProfileStore, id: string): void {
  store.createSession({
    id,
    branchId: `branch-${id}`,
    title: 'Files',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: 'workspace',
    approvalMode: 'full-access',
    at: 1,
  });
  store.append(id, [
    event(
      'run.accepted',
      {
        requestId: `request-${id}`,
        run: {
          id: `run-${id}`,
          sessionId: id,
          branchId: `branch-${id}`,
          providerId: 'provider',
          modelId: 'model',
          status: 'running',
          createdAt: 2,
          finishedAt: null,
          error: null,
        },
      },
      id,
    ),
  ]);
}
function tool(store: ProfileStore, id: string, sessionId = 'session'): ToolCallRecord {
  const anchor = `assistant-${id}`;
  const providerCallId = `call-${id}`;
  const runId = store.getSession(sessionId)?.activeRunId ?? `restarted-${id}`;
  if (store.getSession(sessionId)?.activeRunId === null)
    store.append(sessionId, [
      {
        ...event(
          'run.accepted',
          {
            requestId: `restarted-${id}`,
            run: {
              id: runId,
              sessionId,
              branchId: `branch-${sessionId}`,
              providerId: 'provider',
              modelId: 'model',
              status: 'running',
              createdAt: 2,
              finishedAt: null,
              error: null,
            },
          },
          sessionId,
        ),
        runId,
      },
    ]);
  const message = {
    id: anchor,
    sessionId,
    branchId: `branch-${sessionId}`,
    runId,
    role: 'assistant',
    text: 'Writing',
    thinking: '',
    createdAt: 3,
    status: 'complete',
    stopReason: 'toolUse',
  };
  const record: ToolCallRecord = {
    id: storedToolCallId(runId, anchor, providerCallId),
    sessionId,
    branchId: `branch-${sessionId}`,
    runId,
    name: 'write_file',
    arguments: { path: 'file.txt', content: id },
    binding: { kind: 'accepted', source: { kind: 'workspace' }, fingerprint: 'a'.repeat(64) },
    dispatch: { state: 'not_applicable' },
    status: 'running',
    summary: 'Write file.txt',
    result: null,
    diff: null,
    createdAt: 3,
    updatedAt: 3,
  };
  store.append(
    sessionId,
    [
      event('message.started', { ...message, status: 'streaming' }, sessionId),
      event('message.completed', { message }, sessionId, {
        codecVersion: 1,
        sdkVersion: '1.4.0',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: providerCallId,
              name: 'write_file',
              arguments: record.arguments,
            },
          ],
        },
      }),
      event('tool.requested', { tool: record }, sessionId),
    ].map((value) => ({ ...value, runId })),
  );
  return record;
}
function image(store: ProfileStore, text: string, mode = 0o640): FileChangeImage {
  return { exists: true, ...store.putFileChangeBytes(Buffer.from(text)), mode };
}
function write(
  store: ProfileStore,
  id: string,
  before: FileChangeImage,
  after: FileChangeImage,
  sessionId = 'session',
  complete = true,
): FileOperationPrepare {
  const source = tool(store, id, sessionId);
  const input: FileOperationPrepare = {
    operationId: id,
    action: 'write',
    targetChangeId: null,
    workspaceId: 'workspace',
    branchId: `branch-${sessionId}`,
    path: 'file.txt',
    source: { kind: 'tool', toolCallId: source.id },
    before,
    after,
    requestHash: hash(id),
    targetKey,
    rootIdentity: identity,
    parentIdentity: identity,
    expectedRevision: store.getFileChangeHead(targetKey).revision,
  };
  store.prepareFileOperation(sessionId, input, source.runId, 10);
  for (const value of [before, after]) if (value.exists) store.abandonFileChangeBytes(value.sha256);
  if (complete) store.completeFileOperation(sessionId, id, { status: 'applied', error: null }, 20);
  return input;
}
function restore(
  store: ProfileStore,
  id: string,
  target: string,
  action: 'undo' | 'redo',
  sessionId = 'session',
): void {
  const original = store.getFileChangeRecord(sessionId, target).operation.intent;
  store.prepareFileOperation(
    sessionId,
    {
      ...original,
      operationId: id,
      action,
      targetChangeId: target,
      source: { kind: 'user' },
      requestHash: hash(id),
      expectedRevision: store.getFileChangeHead(targetKey).revision,
      before: action === 'undo' ? original.after : original.before,
      after: action === 'undo' ? original.before : original.after,
    },
    null,
    30,
  );
  store.completeFileOperation(sessionId, id, { status: 'applied', error: null }, 40);
}
async function reopen(value: Fixture): Promise<ProfileStore> {
  value.store.close();
  value.store = await openProfileStore(value.directory);
  return value.store;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const item of owned.splice(0)) {
    item.store.close();
    await rm(item.directory, { recursive: true, force: true });
  }
});

it('keeps exact empty/BOM/CRLF bytes and modes in shared blobs, with bounded metadata-only history', async () => {
  const { store, directory } = await fixture();
  const before = image(store, '');
  const bytes = '\uFEFFhello\r\nworld\r\n';
  const after = image(store, bytes, 0o600);
  write(store, 'write', before, after);
  expect(store.listFileChanges('session').items[0]).toMatchObject({
    changeId: 'write',
    local: true,
    status: 'applied',
    undoAvailable: true,
    before: { bytes: 0, mode: 0o640 },
    after: { mode: 0o600 },
  });
  expect(store.getFileChange('session', 'write', { side: 'after' }).text).toBe(bytes);
  expect(
    Buffer.from(store.readFileChangeBytes(after as { sha256: string; bytes: number })).toString(),
  ).toBe(bytes);
  expect(store.collectUnreferencedArtifacts()).toBe(0);
  const path = join(
    sessionLogDirectory(directory, join(directory, '.my-pi-harness')),
    'session.jsonl',
  );
  const journal = await readFile(path, 'utf8');
  expect(journal).not.toContain('hello\\r');
  const publicEvents = store.readEvents('session', 0);
  expect(JSON.stringify(publicEvents)).not.toContain('rootIdentity');
  expect(JSON.stringify(publicEvents)).not.toContain('targetKey');
});

it('restores same-file chains in reverse and forward order, invalidating old redo on a new write', async () => {
  const { store } = await fixture();
  write(store, 'one', image(store, 'A'), image(store, 'B'));
  write(store, 'two', image(store, 'B'), image(store, 'C'));
  expect(store.getFileChange('session', 'one').change.undoAvailable).toBe(false);
  expect(() => restore(store, 'wrong', 'one', 'undo')).toThrow('history order');
  restore(store, 'undo-two', 'two', 'undo');
  restore(store, 'undo-one', 'one', 'undo');
  expect(store.getFileChange('session', 'one').change.redoAvailable).toBe(true);
  restore(store, 'redo-one', 'one', 'redo');
  restore(store, 'redo-two', 'two', 'redo');
  expect(store.getFileChangeHead(targetKey).headChangeId).toBe('two');
  restore(store, 'undo-two-again', 'two', 'undo');
  write(store, 'three', image(store, 'B'), image(store, 'D'));
  expect(store.getFileChange('session', 'two').change.redoAvailable).toBe(false);
  expect(store.getFileChangeRecord('session', 'three').previousChangeId).toBe('one');
});

it('rebuilds global same-target revisions across journals in a different filename order', async () => {
  const value = await fixture();
  session(value.store, 'aaa');
  write(value.store, 'first', image(value.store, 'A'), image(value.store, 'B'));
  write(value.store, 'second', image(value.store, 'B'), image(value.store, 'C'), 'aaa');
  const store = await reopen(value);
  expect(store.getFileChangeHead(targetKey)).toMatchObject({ revision: 2, headChangeId: 'second' });
  expect(store.getFileChangeRecord('aaa', 'second').previousChangeId).toBe('first');
  restore(store, 'undo-second', 'second', 'undo', 'aaa');
  expect(store.getFileChange('session', 'first').change.undoAvailable).toBe(true);
});

it('preserves uncertain outcomes, only observes current images, and lets a new write establish a baseline', async () => {
  const value = await fixture();
  write(value.store, 'one', image(value.store, 'A'), image(value.store, 'B'));
  const second = write(
    value.store,
    'two',
    image(value.store, 'B'),
    image(value.store, 'C'),
    'session',
    false,
  );
  expect(value.store.listPendingFileOperations().items).toHaveLength(1);
  expect(() =>
    write(value.store, 'blocked', image(value.store, 'C'), image(value.store, 'D')),
  ).toThrow('unresolved');
  const store = await reopen(value);
  store.observeFileOperation('session', 'two', { match: 'after', at: 50 }, 50);
  expect(store.getFileOperation('session', 'two')).toMatchObject({
    status: 'unknown',
    outcome: null,
    observation: { match: 'after' },
  });
  expect(store.getFileChange('session', 'one').change.undoAvailable).toBe(false);
  write(store, 'baseline', second.after, image(store, 'D'));
  expect(store.getFileChangeRecord('session', 'baseline').previousChangeId).toBeNull();
  restore(store, 'undo-baseline', 'baseline', 'undo');
  expect(store.getFileChange('session', 'one').change.undoAvailable).toBe(false);
  expect(store.collectUnreferencedArtifacts()).toBe(0);
});

it.each(['prepared', 'unknown'] as const)(
  'settles an archived %s publication without reopening the conversation or retaining its shared lock',
  async (status) => {
    const value = await fixture();
    const input = write(
      value.store,
      'uncertain',
      image(value.store, 'A'),
      image(value.store, 'B'),
      'session',
      false,
    );
    if (status === 'unknown')
      value.store.completeFileOperation(
        'session',
        'uncertain',
        { status, error: 'Publication could not be confirmed' },
        20,
      );
    value.store.append('session', [
      event('run.finished', { status: 'failed', finishedAt: 30, error: 'Publication uncertain' }),
      { type: 'session.deleted', runId: null, at: 31, data: {} },
    ]);
    const store = await reopen(value);
    expect(store.listPendingFileOperations().items[0]?.intent.operationId).toBe('uncertain');
    expect(() =>
      store.append('session', [
        { type: 'session.configured', runId: null, at: 40, data: { title: 'Reopened' } },
      ]),
    ).toThrow('archived');
    const observation = event('file.operation.observed', {
      operationId: 'uncertain',
      observation: { match: 'after', at: 40 },
    });
    expect(() =>
      store.append('session', [
        observation,
        { type: 'session.configured', runId: null, at: 40, data: { title: 'Reopened' } },
      ]),
    ).toThrow('archived');
    expect(() => store.append('session', [{ ...observation, runId: null }])).toThrow('source run');
    store.observeFileOperation('session', 'uncertain', { match: 'after', at: 40 }, 40);
    expect(store.getSession('session')).toBeUndefined();
    expect(store.listPendingFileOperations().items).toEqual([]);
    expect(store.getFileChangeHead(targetKey)).toMatchObject({
      pendingOperationId: null,
      uncertainOperationId: 'uncertain',
    });
    expect(store.readEvents('session').at(-1)).toMatchObject({
      type: 'file.operation.observed',
      data: { operationId: 'uncertain', observation: { match: 'after' } },
    });
    expect(() =>
      store.completeFileOperation('session', 'uncertain', { status: 'applied', error: null }, 41),
    ).toThrow('different result');
    expect(() => store.getFileChangeRecord('session', 'uncertain')).toThrow('archived');
    session(store, 'other');
    write(store, 'baseline', input.after, image(store, 'C'), 'other');
    expect(store.getFileChangeRecord('other', 'baseline')).toMatchObject({
      previousChangeId: null,
      applied: true,
    });
    expect(store.collectUnreferencedArtifacts()).toBe(0);
    const recovered = await reopen(value);
    expect(recovered.getSession('session')).toBeUndefined();
    expect(recovered.listPendingFileOperations().items).toEqual([]);
    expect(recovered.getFileChangeHead(targetKey)).toMatchObject({
      headChangeId: 'baseline',
      pendingOperationId: null,
      uncertainOperationId: null,
    });
  },
);

it('makes preparation and completion idempotent, rejects ID/body reuse and revision races', async () => {
  const { store } = await fixture();
  const input = write(store, 'one', image(store, 'A'), image(store, 'B'));
  expect(store.prepareFileOperation('session', input, 'run-session', 99).status).toBe('applied');
  expect(() =>
    store.prepareFileOperation(
      'session',
      { ...input, requestHash: hash('other') },
      'run-session',
      99,
    ),
  ).toThrow('different content');
  expect(
    store.completeFileOperation('session', 'one', { status: 'applied', error: null }, 100)
      .finishedAt,
  ).toBe(20);
  expect(() =>
    store.completeFileOperation('session', 'one', { status: 'unknown', error: null }, 100),
  ).toThrow('different result');
  const original = tool(store, 'race');
  expect(() =>
    store.prepareFileOperation(
      'session',
      { ...input, operationId: 'race', source: { kind: 'tool', toolCallId: original.id } },
      'run-session',
      100,
    ),
  ).toThrow('history changed');
  expect(store.listFileChanges('session').items).toHaveLength(1);
});

it('paginates all UTF-8 before/after content without splitting characters or hiding suffixes', async () => {
  const { store } = await fixture();
  const text = '🚀中\n"\\'.repeat(10000);
  write(store, 'long', { exists: false }, image(store, text));
  let offset = 0,
    all = '';
  for (let index = 0; index < 200; index++) {
    const page = store.getFileChange('session', 'long', { side: 'after', offset, maxBytes: 1024 });
    expect(Buffer.byteLength(JSON.stringify(page.text))).toBeLessThanOrEqual(1024);
    all += page.text;
    if (page.nextOffset === null) break;
    expect(page.nextOffset).toBeGreaterThan(offset);
    offset = page.nextOffset;
  }
  expect(all).toBe(text);
  expect(() =>
    store.getFileChange('session', 'long', { side: 'after', offset: 1, maxBytes: 1024 }),
  ).toThrow('offset');
});

it('retains file changes when their source tool is still running and gives paged operation history', async () => {
  const value = await fixture();
  const { store } = value;
  const input = write(store, 'one', image(store, 'A'), image(store, 'B'));
  expect(store.listFileChanges('session').items[0]?.status).toBe('applied');
  expect(input.source.kind).toBe('tool');
  const receipt = store.acceptFileChangeBatch(
    'session',
    {
      operationId: 'batch',
      requestHash: hash('batch'),
      action: 'undo',
      items: [{ changeId: 'one', path: 'file.txt' }],
    },
    50,
  );
  expect(receipt.status).toBe('accepted');
  expect(
    store.acceptFileChangeBatch(
      'session',
      {
        operationId: 'batch',
        requestHash: hash('batch'),
        action: 'undo',
        items: [{ changeId: 'other', path: 'other' }],
      },
      99,
    ),
  ).toEqual(receipt);
  expect(() =>
    store.acceptFileChangeBatch(
      'session',
      {
        operationId: 'batch',
        requestHash: hash('changed'),
        action: 'undo',
        items: [{ changeId: 'one', path: 'file.txt' }],
      },
      99,
    ),
  ).toThrow('different content');
  store.requestFileChangeBatchCancel('session', 'batch', 51);
  store.finishFileChangeBatch('session', 'batch', 'interrupted', 'Process stopped', 52);
  expect(store.listFileChangeBatches('session').items[0]).toMatchObject({
    operationId: 'batch',
    itemCount: 1,
    unknownCount: 0,
    status: 'interrupted',
  });
  expect(store.listFileChangeBatches('session').items[0]).not.toHaveProperty('items');
  expect(store.listPendingFileChangeBatches().items).toHaveLength(0);
  const reopened = await reopen(value);
  expect(reopened.getFileChangeBatch('session', 'batch')).toMatchObject({
    status: 'interrupted',
    cancelRequested: true,
    items: [{ status: 'not_started' }],
  });
});

it('does not reclaim prepared/unknown file bytes and removes unreferenced abandoned image blobs', async () => {
  const { store, directory } = await fixture();
  const orphan = store.putFileChangeBytes(Buffer.from('orphan'));
  store.abandonFileChangeBytes(orphan.sha256);
  write(store, 'pending', { exists: false }, image(store, 'kept'), 'session', false);
  expect(store.collectUnreferencedArtifacts()).toBe(6);
  expect(
    (
      await readdir(
        join(sessionLogDirectory(directory, join(directory, '.my-pi-harness')), 'artifacts'),
      )
    ).filter((name) => name.endsWith('.blob')),
  ).toHaveLength(1);
  store.completeFileOperation(
    'session',
    'pending',
    { status: 'unknown', error: 'Interrupted after publish' },
    20,
  );
  expect(store.collectUnreferencedArtifacts()).toBe(0);
});

it('requires a prepared native file publication before accepting a dispatch barrier', async () => {
  const { store } = await fixture();
  const source = tool(store, 'barrier');
  const marked = {
    ...source,
    dispatch: { state: 'may_have_started', attemptId: 'operation', at: 15 },
  };
  expect(() => store.append('session', [event('tool.updated', { tool: marked })])).toThrow(
    'frozen source',
  );
  const after = image(store, 'new');
  store.prepareFileOperation(
    'session',
    {
      operationId: 'operation',
      action: 'write',
      targetChangeId: null,
      workspaceId: 'workspace',
      branchId: 'branch-session',
      path: 'file.txt',
      source: { kind: 'tool', toolCallId: source.id },
      before: { exists: false },
      after,
      requestHash: hash('operation'),
      targetKey,
      rootIdentity: identity,
      parentIdentity: identity,
      expectedRevision: 0,
    },
    source.runId,
    12,
  );
  if (after.exists) store.abandonFileChangeBytes(after.sha256);
  store.append('session', [event('tool.updated', { tool: marked })]);
  expect(store.getFileOperation('session', 'operation')?.status).toBe('prepared');
  expect(() =>
    store.append('session', [
      event('tool.updated', {
        tool: { ...marked, dispatch: { ...marked.dispatch, attemptId: 'different' } },
      }),
    ]),
  ).toThrow('frozen source');
});

it('rejects missing images before journaling intent and keeps stale or foreign changes out of batches', async () => {
  const { store } = await fixture();
  const source = tool(store, 'missing');
  const missing: FileOperationPrepare = {
    operationId: 'missing',
    action: 'write',
    targetChangeId: null,
    workspaceId: 'workspace',
    branchId: 'branch-session',
    path: 'file.txt',
    source: { kind: 'tool', toolCallId: source.id },
    before: { exists: false },
    after: { exists: true, sha256: 'd'.repeat(64), bytes: 2, mode: 0o600 },
    requestHash: hash('missing'),
    targetKey,
    rootIdentity: identity,
    parentIdentity: identity,
    expectedRevision: 0,
  };
  expect(() => store.prepareFileOperation('session', missing, source.runId, 20)).toThrow();
  expect(store.getFileOperation('session', 'missing')).toBeUndefined();
  write(store, 'known', image(store, 'A'), image(store, 'B'));
  session(store, 'foreign');
  expect(() =>
    store.acceptFileChangeBatch(
      'foreign',
      {
        operationId: 'foreign-batch',
        requestHash: hash('foreign'),
        action: 'undo',
        items: [{ changeId: 'known', path: 'file.txt' }],
      },
      20,
    ),
  ).toThrow('does not belong');
  expect(() =>
    store.acceptFileChangeBatch(
      'session',
      {
        operationId: 'known',
        requestHash: hash('known'),
        action: 'undo',
        items: [{ changeId: 'known', path: 'file.txt' }],
      },
      20,
    ),
  ).toThrow('another operation');
});

it('replays imported non-local file facts as read-only history without granting restoration rights', async () => {
  const value = await fixture();
  const source = tool(value.store, 'imported');
  const imageAfter = image(value.store, 'Imported');
  value.store.append('session', [
    event(
      'file.operation.prepared',
      {
        operationId: 'imported',
        action: 'write',
        targetChangeId: null,
        workspaceId: 'workspace',
        branchId: 'branch-session',
        path: 'file.txt',
        source: { kind: 'tool', toolCallId: source.id },
        before: { exists: false },
        after: imageAfter,
      },
      'session',
      {
        fileOperationHost: {
          requestHash: hash('imported'),
          targetKey,
          rootIdentity: identity,
          parentIdentity: identity,
          expectedRevision: 0,
          local: false,
        },
      },
    ),
  ]);
  if (imageAfter.exists) value.store.abandonFileChangeBytes(imageAfter.sha256);
  value.store.completeFileOperation('session', 'imported', { status: 'applied', error: null }, 20);
  const store = await reopen(value);
  expect(store.getFileChange('session', 'imported').change).toMatchObject({
    local: false,
    undoAvailable: false,
    redoAvailable: false,
    blockedReason: '导入的文件历史仅供查看',
  });
  expect(store.listFileChanges('session').canOperate).toBe(false);
  write(store, 'local-after-import', image(store, 'Imported'), image(store, 'Local'));
  const localPage = store.listFileChanges('session', { limit: 1 });
  expect(localPage.canOperate).toBe(true);
  expect(localPage.items[0]?.local).toBe(true);
  if (localPage.nextCursor === null) throw new Error('Missing history continuation');
  const importedPage = store.listFileChanges('session', { limit: 1, cursor: localPage.nextCursor });
  expect(importedPage.items[0]?.local).toBe(false);
  expect(importedPage.canOperate).toBe(true);
  expect(store.listFileChanges('session', { toolCallId: source.id }).canOperate).toBe(false);
  expect(() => restore(store, 'undo-imported', 'imported', 'undo')).toThrow('cannot be restored');
});

it('persists per-item results separately from the original file change and recovers unfinished batches without replay', async () => {
  const value = await fixture();
  const { store } = value;
  write(store, 'one', image(store, 'A'), image(store, 'B'));
  store.acceptFileChangeBatch(
    'session',
    {
      operationId: 'batch',
      requestHash: hash('batch'),
      action: 'undo',
      items: [{ changeId: 'one', path: 'file.txt' }],
    },
    30,
  );
  const original = store.getFileChangeRecord('session', 'one').operation.intent;
  store.prepareFileOperation(
    'session',
    {
      ...original,
      operationId: 'undo',
      action: 'undo',
      targetChangeId: 'one',
      source: { kind: 'user' },
      requestHash: hash('undo'),
      expectedRevision: 1,
      before: original.after,
      after: original.before,
    },
    null,
    31,
  );
  store.updateFileChangeBatchItem(
    'session',
    'batch',
    { changeId: 'one', path: 'file.txt', fileOperationId: 'undo', status: 'running', error: null },
    31,
  );
  store.completeFileOperation('session', 'undo', { status: 'applied', error: null }, 32);
  store.updateFileChangeBatchItem(
    'session',
    'batch',
    { changeId: 'one', path: 'file.txt', fileOperationId: 'undo', status: 'applied', error: null },
    32,
  );
  store.finishFileChangeBatch('session', 'batch', 'completed', null, 33);
  expect(store.findFileChangeBatch('session', 'batch', hash('batch'))?.items[0]?.status).toBe(
    'applied',
  );
  expect(() => store.findFileChangeBatch('session', 'batch', hash('different'))).toThrow(
    'different content',
  );
  store.acceptFileChangeBatch(
    'session',
    {
      operationId: 'pending-batch',
      requestHash: hash('pending-batch'),
      action: 'redo',
      items: [{ changeId: 'one', path: 'file.txt' }],
    },
    40,
  );
  const reopened = await reopen(value);
  expect(reopened.listPendingFileChangeBatches().items[0]?.receipt.operationId).toBe(
    'pending-batch',
  );
  expect(reopened.getFileChange('session', 'one').change.state).toBe('undone');
  const first = reopened.listFileChangeBatches('session', { limit: 1 });
  expect(first.items[0]?.operationId).toBe('pending-batch');
  expect(
    reopened.listFileChangeBatches('session', { cursor: first.nextCursor ?? 0, limit: 1 }).items[0]
      ?.operationId,
  ).toBe('batch');
});

it('does not expose a failed preparation as committed history and reclaims its abandoned images', async () => {
  const value = await fixture();
  const source = tool(value.store, 'failed-prepare');
  const after = image(value.store, 'not published');
  const fault = vi.spyOn(SessionJournal.prototype, 'append').mockImplementationOnce(() => {
    throw new Error('Injected journal failure');
  });
  try {
    expect(() =>
      value.store.prepareFileOperation(
        'session',
        {
          operationId: 'failed-prepare',
          action: 'write',
          targetChangeId: null,
          workspaceId: 'workspace',
          branchId: 'branch-session',
          path: 'file.txt',
          source: { kind: 'tool', toolCallId: source.id },
          before: { exists: false },
          after,
          requestHash: hash('failed-prepare'),
          targetKey,
          rootIdentity: identity,
          parentIdentity: identity,
          expectedRevision: 0,
        },
        source.runId,
        12,
      ),
    ).toThrow('outcome may be unknown');
  } finally {
    fault.mockRestore();
    if (after.exists) value.store.abandonFileChangeBytes(after.sha256);
  }
  const store = await reopen(value);
  expect(store.getFileOperation('session', 'failed-prepare')).toBeUndefined();
  expect(store.listFileChanges('session').items).toEqual([]);
  expect(store.collectUnreferencedArtifacts()).toBe(Buffer.byteLength('not published'));
});

it('keeps a prepared publication and its bytes after terminal journal failure, without inventing disk success', async () => {
  const value = await fixture();
  write(
    value.store,
    'uncertain',
    { exists: false },
    image(value.store, 'may have published'),
    'session',
    false,
  );
  const fault = vi.spyOn(SessionJournal.prototype, 'append').mockImplementationOnce(() => {
    throw new Error('Injected terminal journal failure');
  });
  try {
    expect(() =>
      value.store.completeFileOperation(
        'session',
        'uncertain',
        { status: 'applied', error: null },
        20,
      ),
    ).toThrow('outcome may be unknown');
  } finally {
    fault.mockRestore();
  }
  const store = await reopen(value);
  expect(store.listPendingFileOperations().items[0]?.intent.operationId).toBe('uncertain');
  expect(store.getFileChange('session', 'uncertain').change).toMatchObject({
    status: 'prepared',
    undoAvailable: false,
  });
  expect(store.collectUnreferencedArtifacts()).toBe(0);
  store.observeFileOperation('session', 'uncertain', { match: 'before', at: 30 }, 30);
  expect(store.getFileOperation('session', 'uncertain')).toMatchObject({
    status: 'unknown',
    outcome: null,
    observation: { match: 'before' },
  });
});
