import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
  link,
  readdir,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import type { ToolCallRecord, FileChangeImage } from '@my-pi-harness/protocol';
import { storedToolCallId } from '../src/sessions/projections/tool-intents';
import { SessionRecovery } from '../src/sessions/recovery';
import { SessionJournal } from '../src/sessions/session-jsonl';
import { ArchiveFiles } from '../src/archives/files';
import type { FrozenSkill } from '@my-pi-harness/protocol/internal';
import {
  openProfileStore,
  sessionLogDirectory,
  type ProfileStore,
  type SessionArchiveInput,
  type SessionArchiveSource,
  type ProfileStoreOptions,
} from '../src/index';

interface Fixture {
  directory: string;
  store: ProfileStore;
}
const owned: Fixture[] = [];
const sources: SessionArchiveSource[] = [];
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const input = (source: SessionArchiveSource): SessionArchiveInput => ({
  manifest: source.manifest,
  open: (path) => {
    const entry = source.entries.find((item) => item.path === path);
    if (entry === undefined) throw new Error('Missing entry');
    return entry.open();
  },
});

async function profile(options: ProfileStoreOptions = {}): Promise<Fixture> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'session-archive-')));
  const store = await openProfileStore(directory, options);
  const value = { directory, store };
  owned.push(value);
  return value;
}
function session(store: ProfileStore, id = 'session', workspaceId: string | null = null): void {
  store.createSession({
    id,
    branchId: `branch-${id}`,
    title: 'Archive history',
    providerId: 'missing-provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId,
    approvalMode: 'full-access',
    at: 1,
  });
}
async function source(
  store: ProfileStore,
  id = 'session',
  options: Parameters<ProfileStore['createSessionArchive']>[1] = {},
): Promise<SessionArchiveSource> {
  const value = await store.createSessionArchive(id, options);
  sources.push(value);
  return value;
}
function workspace(value: Fixture): void {
  value.store.createWorkspace({
    id: 'workspace',
    name: 'Workspace',
    icon: 'folder',
    rootPath: value.directory,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  });
}
function nativeWrite(
  store: ProfileStore,
  id: string,
  before: string | null,
  after: string,
  sessionId = 'session',
): void {
  const runId = `run-${sessionId}`;
  const branchId = `branch-${sessionId}`;
  if (store.getSession(sessionId)?.activeRunId === null)
    store.append(sessionId, [
      {
        type: 'run.accepted',
        runId,
        at: 2,
        data: {
          requestId: `request-${sessionId}`,
          run: {
            id: runId,
            sessionId,
            branchId,
            providerId: 'missing-provider',
            modelId: 'model',
            status: 'running',
            createdAt: 2,
            finishedAt: null,
            error: null,
          },
        },
      },
    ]);
  const anchor = `assistant-${id}`,
    callId = `call-${id}`;
  const tool: ToolCallRecord = {
    id: storedToolCallId(runId, anchor, callId),
    sessionId,
    runId,
    branchId,
    name: 'write_file',
    arguments: { path: 'file.txt', content: after },
    binding: { kind: 'accepted', source: { kind: 'workspace' }, fingerprint: 'f'.repeat(64) },
    dispatch: { state: 'not_applicable' },
    status: 'running',
    summary: 'Write file',
    result: null,
    diff: null,
    createdAt: 3,
    updatedAt: 3,
  };
  store.append(sessionId, [
    {
      type: 'message.started',
      runId,
      at: 3,
      data: {
        id: anchor,
        sessionId,
        runId,
        branchId,
        role: 'assistant',
        text: 'Writing',
        thinking: '',
        status: 'complete',
        stopReason: 'toolUse',
        createdAt: 3,
      },
      privateData: {
        codecVersion: 1,
        sdkVersion: '1.4.0',
        message: {
          role: 'assistant',
          content: [
            { type: 'toolCall', id: callId, name: 'write_file', arguments: tool.arguments },
          ],
        },
      },
    },
    { type: 'tool.requested', runId, at: 3, data: { tool } },
  ]);
  const pins: string[] = [];
  const freeze = (text: string | null): FileChangeImage => {
    if (text === null) return { exists: false };
    const blob = store.putFileChangeBytes(Buffer.from(text));
    pins.push(blob.sha256);
    return { exists: true, ...blob, mode: 0o640 };
  };
  const targetKey = hash('physical-target');
  try {
    store.prepareFileOperation(
      sessionId,
      {
        operationId: id,
        action: 'write',
        targetChangeId: null,
        workspaceId: 'workspace',
        branchId,
        path: 'file.txt',
        source: { kind: 'tool', toolCallId: tool.id },
        before: freeze(before),
        after: freeze(after),
        requestHash: hash(id),
        targetKey,
        expectedRevision: store.getFileChangeHead(targetKey).revision,
        rootIdentity: { device: '1', inode: '2' },
        parentIdentity: { device: '1', inode: '3' },
      },
      runId,
      4,
    );
    store.completeFileOperation(sessionId, id, { status: 'applied', error: null }, 5);
  } finally {
    for (const pin of pins) store.abandonFileChangeBytes(pin);
  }
}
function nativeUndo(
  store: ProfileStore,
  id: string,
  changeId: string,
  sessionId = 'session',
): void {
  const original = store.getFileChangeRecord(sessionId, changeId).operation.intent;
  store.prepareFileOperation(
    sessionId,
    {
      ...original,
      operationId: id,
      action: 'undo',
      targetChangeId: changeId,
      source: { kind: 'user' },
      before: original.after,
      after: original.before,
      expectedRevision: store.getFileChangeHead(original.targetKey).revision,
      requestHash: hash(id),
    },
    null,
    6,
  );
  store.completeFileOperation(sessionId, id, { status: 'applied', error: null }, 7);
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const source of sources.splice(0)) source.release();
  for (const value of owned.splice(0)) {
    value.store.close();
    await rm(value.directory, { recursive: true, force: true });
  }
});

it('freezes a committed prefix, imports into an independent profile and requires explicit new authority', async () => {
  const original = await profile();
  const target = await profile();
  session(original.store);
  original.store.append('session', [
    {
      type: 'run.accepted',
      runId: 'run',
      at: 2,
      data: {
        requestId: 'request',
        run: {
          id: 'run',
          sessionId: 'session',
          branchId: 'branch-session',
          providerId: 'missing-provider',
          modelId: 'model',
          status: 'running',
          createdAt: 2,
          finishedAt: null,
          error: null,
        },
      },
    },
    {
      type: 'message.started',
      runId: 'run',
      at: 3,
      data: {
        id: 'user',
        sessionId: 'session',
        branchId: 'branch-session',
        runId: 'run',
        role: 'user',
        text: 'Frozen prefix',
        thinking: '',
        status: 'complete',
        stopReason: null,
        createdAt: 3,
      },
    },
  ]);
  const exported = await source(original.store);
  original.store.append('session', [
    { type: 'session.configured', runId: null, at: 4, data: { title: 'After export' } },
  ]);
  const preview = await target.store.previewSessionArchive(input(exported), hash('transport'));
  expect(preview).toMatchObject({
    canImport: true,
    conflictCount: 0,
    manifest: { activeAtSnapshot: true, title: 'Archive history', entryCount: 1 },
  });
  const receipt = await target.store.importSessionArchive(
    'import',
    input(exported),
    hash('transport'),
  );
  expect(receipt.status).toBe('completed');
  expect(target.store.getSession('session')?.title).toBe('Archive history');
  expect(target.store.getSessionExecutionAccess('session')).toEqual({
    importedThroughSeq: exported.manifest.snapshotSeq,
    bound: false,
  });
  expect(target.store.getSnapshot('session').runs[0]?.status).toBe('interrupted');
  expect(target.store.getSnapshot('session').messages[0]?.text).toBe('Frozen prefix');
  expect(target.store.listProviders()).toEqual([]);
  expect(
    await target.store.importSessionArchive('import', input(exported), hash('transport')),
  ).toEqual(receipt);
  await expect(
    target.store.importSessionArchive('import', input(exported), hash('different')),
  ).rejects.toMatchObject({ code: 'ARCHIVE_CONFLICT' });
  target.store.close();
  target.store = await openProfileStore(target.directory);
  expect(target.store.getSessionArchiveImport('import')?.status).toBe('completed');
  expect(target.store.getSessionExecutionAccess('session').bound).toBe(false);
});

it('exports only referenced frozen attachments and Skill resources and can export imported history again', async () => {
  const original = await profile();
  const target = await profile();
  session(original.store);
  const bytes = Buffer.from('Historical resource');
  const resources = [
    { path: 'scripts/helper.txt', hash: hash(bytes), size: bytes.length, mediaType: 'text/plain' },
  ];
  const content = 'Use the historical helper';
  const contentHash = hash(JSON.stringify(['fixture', 'Description', content, [], resources]));
  const skill: FrozenSkill = {
    selection: { id: 'skill', contentHash },
    authorization: {
      skillEpoch: 1,
      pluginId: 'plugin',
      pluginEpoch: 2,
      pluginGeneration: 'generation',
    },
    name: 'fixture',
    description: 'Description',
    content,
    scope: 'plugin',
    source: 'plugin',
    allowedTools: [],
    resources,
  };
  const directory = join(original.directory, 'versions', contentHash);
  await mkdir(join(directory, 'scripts'), { recursive: true, mode: 0o700 });
  await writeFile(join(directory, 'scripts', 'helper.txt'), bytes, { mode: 0o400 });
  original.store.putAttachment({
    attachment: {
      id: 'used',
      name: 'notes.txt',
      mediaType: 'text/plain',
      kind: 'text',
      byteLength: 5,
      preview: 'Notes',
      sourcePath: null,
      workspaceId: null,
      createdAt: 1,
    },
    text: 'Notes',
    imageData: null,
  });
  original.store.putAttachment({
    attachment: {
      id: 'unused',
      name: 'secret.txt',
      mediaType: 'text/plain',
      kind: 'text',
      byteLength: 6,
      preview: 'Secret',
      sourcePath: null,
      workspaceId: null,
      createdAt: 1,
    },
    text: 'Secret',
    imageData: null,
  });
  original.store.append('session', [
    {
      type: 'run.accepted',
      runId: 'run',
      at: 2,
      data: {
        requestId: 'request',
        run: {
          id: 'run',
          sessionId: 'session',
          branchId: 'branch-session',
          providerId: 'missing-provider',
          modelId: 'model',
          status: 'running',
          createdAt: 2,
          finishedAt: null,
          error: null,
        },
      },
      privateData: { skills: [skill] },
    },
    {
      type: 'message.started',
      runId: 'run',
      at: 3,
      data: {
        id: 'user',
        sessionId: 'session',
        branchId: 'branch-session',
        runId: 'run',
        role: 'user',
        text: 'Notes',
        thinking: '',
        status: 'complete',
        stopReason: null,
        createdAt: 3,
        attachmentIds: ['used'],
      },
    },
  ]);
  const exported = await source(original.store, 'session', {
    resolveSkillDirectory: () => directory,
  });
  expect(exported.manifest.entries.map((entry) => entry.path)).toEqual([
    'session.jsonl',
    'attachments/used.json',
    `skills/${contentHash}/scripts/helper.txt`,
  ]);
  await target.store.importSessionArchive('import', input(exported), hash('transport'));
  expect(target.store.getAttachment('used')?.text).toBe('Notes');
  expect(target.store.getAttachment('unused')).toBeUndefined();
  expect(target.store.getSkillContext('session', 'branch-session')).toEqual([]);
  const again = await source(target.store);
  const entry = again.entries.find((item) => item.path.startsWith('skills/'));
  expect(entry?.sha256).toBe(hash(bytes));
  const body: Buffer[] = [];
  for await (const chunk of entry?.open() ?? Readable.from([])) {
    if (!(chunk instanceof Uint8Array)) throw new Error('Byte stream required');
    body.push(Buffer.from(chunk));
  }
  expect(Buffer.concat(body)).toEqual(bytes);
});

it('rejects bad bytes, missing resources and global ID conflicts before making a partial session visible', async () => {
  const original = await profile();
  const target = await profile();
  session(original.store);
  const exported = await source(original.store);
  const bad = { manifest: exported.manifest, open: () => Readable.from([Buffer.from('forged')]) };
  await expect(target.store.importSessionArchive('bad', bad, hash('bad'))).rejects.toMatchObject({
    code: 'ARCHIVE_INVALID',
  });
  expect(target.store.listSessions()).toEqual([]);
  expect(target.store.getSessionArchiveImport('bad')).toBeUndefined();
  session(target.store);
  const preview = await target.store.previewSessionArchive(input(exported), hash('transport'));
  expect(preview.canImport).toBe(false);
  expect(preview.conflicts.some((item) => item.kind === 'sessions')).toBe(true);
  await expect(
    target.store.importSessionArchive('conflict', input(exported), hash('transport')),
  ).rejects.toMatchObject({ code: 'ARCHIVE_CONFLICT' });
  expect(target.store.listSessions()).toHaveLength(1);
});

it('restores a read-only file history whose successful undo chain crossed another session', async () => {
  const original = await profile(),
    target = await profile();
  workspace(original);
  session(original.store, 'A', 'workspace');
  session(original.store, 'B', 'workspace');
  nativeWrite(original.store, 'a', null, 'A', 'A');
  nativeWrite(original.store, 'b', 'A', 'B', 'B');
  nativeWrite(original.store, 'c', 'B', 'C', 'A');
  nativeUndo(original.store, 'undo-c', 'c', 'A');
  nativeUndo(original.store, 'undo-b', 'b', 'B');
  nativeUndo(original.store, 'undo-a', 'a', 'A');
  const exported = await source(original.store, 'A');
  expect(exported.manifest.entries.filter((entry) => entry.kind === 'blob')).toHaveLength(3);
  await target.store.importSessionArchive('import', input(exported), hash('transport'));
  const changes = target.store.listFileChanges('A').items;
  expect(
    changes.map((change) => [
      change.changeId,
      change.state,
      change.undoAvailable,
      change.redoAvailable,
    ]),
  ).toEqual([
    ['c', 'undone', false, false],
    ['a', 'undone', false, false],
  ]);
  expect(target.store.getSession('B')).toBeUndefined();
  target.store.close();
  target.store = await openProfileStore(target.directory);
  expect(target.store.getFileChange('A', 'a').change.state).toBe('undone');
});

it('recovers a durable publication plan after process loss before any resource or journal publication', async () => {
  const original = await profile(),
    target = await profile();
  session(original.store);
  const exported = await source(original.store);
  // The saved implementation is invoked with its owning instance by the fault interceptor.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const writeReceipt = ArchiveFiles.prototype.writeReceipt;
  const fault = vi.spyOn(ArchiveFiles.prototype, 'writeReceipt').mockImplementationOnce(function (
    this: ArchiveFiles,
    id,
    value,
  ) {
    writeReceipt.call(this, id, value);
    throw new Error('Injected crash after plan fsync');
  });
  await expect(
    target.store.importSessionArchive('import', input(exported), hash('transport')),
  ).rejects.toMatchObject({ code: 'SESSION_LOG_UNAVAILABLE' });
  fault.mockRestore();
  expect(target.store.listSessions()).toEqual([]);
  expect(target.store.getSessionArchiveImport('import')?.status).toBe('publishing');
  target.store.close();
  target.store = await openProfileStore(target.directory);
  expect(target.store.getSessionArchiveImport('import')?.status).toBe('completed');
  expect(target.store.getSession('session')).toBeDefined();
  expect(target.store.getSessionExecutionAccess('session').bound).toBe(false);
});

it('recovers a published journal after projection failure without exposing a half session or duplicating its seal', async () => {
  const original = await profile(),
    target = await profile();
  session(original.store);
  const exported = await source(original.store);
  // The saved implementation is invoked with its owning instance by the fault interceptor.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const replay = SessionRecovery.prototype.replaySession;
  let calls = 0;
  const fault = vi.spyOn(SessionRecovery.prototype, 'replaySession').mockImplementation(function (
    this: SessionRecovery,
    id,
  ) {
    calls++;
    if (calls === 2) throw new Error('Injected projection failure');
    return replay.call(this, id);
  });
  await expect(
    target.store.importSessionArchive('import', input(exported), hash('transport')),
  ).rejects.toMatchObject({ code: 'SESSION_LOG_UNAVAILABLE' });
  fault.mockRestore();
  expect(target.store.listSessions()).toEqual([]);
  expect(target.store.getSessionArchiveImport('import')?.status).toBe('publishing');
  target.store.close();
  target.store = await openProfileStore(target.directory);
  expect(target.store.getSessionArchiveImport('import')?.status).toBe('completed');
  expect(
    target.store.readEvents('session').filter((event) => event.type === 'session.imported'),
  ).toHaveLength(1);
});

it('merges concurrent identical operation IDs and rejects a different archive before publishing another session', async () => {
  const first = await profile(),
    second = await profile(),
    target = await profile();
  session(first.store, 'first');
  session(second.store, 'second');
  const a = await source(first.store, 'first'),
    b = await source(second.store, 'second');
  const pending = target.store.importSessionArchive('same', input(a), hash('a'));
  const duplicate = target.store.importSessionArchive('same', input(a), hash('a'));
  await expect(
    target.store.importSessionArchive('same', input(b), hash('b')),
  ).rejects.toMatchObject({ code: 'ARCHIVE_CONFLICT' });
  expect(await duplicate).toEqual(await pending);
  expect(target.store.listSessions().map((item) => item.id)).toEqual(['first']);
});

it('cancels before publication and ignores cancellation after the durable publication boundary', async () => {
  const original = await profile(),
    target = await profile();
  session(original.store);
  const exported = await source(original.store);
  const before = new AbortController();
  before.abort();
  await expect(
    target.store.importSessionArchive('cancelled', input(exported), hash('transport'), {
      signal: before.signal,
    }),
  ).rejects.toThrow();
  expect(target.store.getSessionArchiveImport('cancelled')).toBeUndefined();
  expect(target.store.listSessions()).toEqual([]);
  const after = new AbortController();
  // The saved implementation is invoked with its owning instance by the fault interceptor.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const writeReceipt = ArchiveFiles.prototype.writeReceipt;
  const boundary = vi
    .spyOn(ArchiveFiles.prototype, 'writeReceipt')
    .mockImplementationOnce(function (this: ArchiveFiles, id, value) {
      writeReceipt.call(this, id, value);
      after.abort();
    });
  const receipt = await target.store.importSessionArchive(
    'committed',
    input(exported),
    hash('transport'),
    { signal: after.signal },
  );
  boundary.mockRestore();
  expect(receipt.status).toBe('completed');
  expect(target.store.listSessions()).toHaveLength(1);
});

it('preflights the real target pool quota without creating a durable publishing operation', async () => {
  const original = await profile(),
    target = await profile({ artifactLimits: { maximumFileBytes: 1024, maximumProfileBytes: 2 } });
  workspace(original);
  session(original.store, 'session', 'workspace');
  nativeWrite(original.store, 'write', null, 'larger than quota');
  const exported = await source(original.store);
  await expect(
    target.store.importSessionArchive('quota', input(exported), hash('transport')),
  ).rejects.toThrow('quota');
  expect(target.store.getSessionArchiveImport('quota')).toBeUndefined();
  expect(target.store.listSessions()).toEqual([]);
  target.store.close();
  target.store = await openProfileStore(target.directory, {
    artifactLimits: { maximumFileBytes: 1024, maximumProfileBytes: 2 },
  });
  expect(target.store.listSessions()).toEqual([]);
});

it('rejects a complete archive entry whose journal checksum or declared activity was forged', async () => {
  const original = await profile(),
    target = await profile();
  session(original.store);
  const exported = await source(original.store);
  const chunks: Buffer[] = [];
  for await (const chunk of exported.entries[0]?.open() ?? Readable.from([])) {
    if (!(chunk instanceof Uint8Array)) throw new Error('Byte stream required');
    chunks.push(Buffer.from(chunk));
  }
  const originalBytes = Buffer.concat(chunks);
  const forged = Buffer.from(
    originalBytes.toString().replace('Archive history', 'Changed history'),
  );
  const manifest = {
    ...exported.manifest,
    entries: exported.manifest.entries.map((entry) =>
      entry.kind === 'journal' ? { ...entry, bytes: forged.length, sha256: hash(forged) } : entry,
    ),
  };
  await expect(
    target.store.previewSessionArchive(
      { manifest, open: () => Readable.from([forged]) },
      hash('forged'),
    ),
  ).rejects.toMatchObject({ code: 'ARCHIVE_INVALID' });
  await expect(
    target.store.previewSessionArchive(
      { ...input(exported), manifest: { ...exported.manifest, activeAtSnapshot: true } },
      hash('activity'),
    ),
  ).rejects.toThrow('activity summary');
  expect(target.store.listSessions()).toEqual([]);
});

it('rejects a referenced image blob that was omitted from the resource closure', async () => {
  const original = await profile(),
    target = await profile();
  workspace(original);
  session(original.store, 'session', 'workspace');
  nativeWrite(original.store, 'write', null, 'file bytes');
  const exported = await source(original.store);
  const missing = {
    ...exported.manifest,
    entries: exported.manifest.entries.filter((entry) => entry.kind !== 'blob'),
  };
  await expect(
    target.store.previewSessionArchive({ ...input(exported), manifest: missing }, hash('missing')),
  ).rejects.toMatchObject({ code: 'ARCHIVE_INVALID' });
  expect(target.store.listSessions()).toEqual([]);
});

it('detects operation IDs shared across file publication and user batch domains before publication', async () => {
  const original = await profile(),
    target = await profile();
  workspace(original);
  workspace(target);
  session(original.store, 'source', 'workspace');
  session(target.store, 'target', 'workspace');
  nativeWrite(original.store, 'shared', null, 'source', 'source');
  nativeWrite(target.store, 'target-change', null, 'target', 'target');
  target.store.acceptFileChangeBatch(
    'target',
    {
      operationId: 'shared',
      requestHash: hash('batch'),
      action: 'undo',
      items: [{ changeId: 'target-change', path: 'file.txt' }],
    },
    10,
  );
  const exported = await source(original.store, 'source');
  const preview = await target.store.previewSessionArchive(input(exported), hash('transport'));
  expect(preview).toMatchObject({ canImport: false });
  expect(
    preview.conflicts.some((item) => item.kind === 'file_operations' && item.id === 'shared'),
  ).toBe(true);
  await expect(
    target.store.importSessionArchive('import', input(exported), hash('transport')),
  ).rejects.toMatchObject({ code: 'ARCHIVE_CONFLICT' });
  expect(target.store.getSession('source')).toBeUndefined();
  expect(target.store.getSessionArchiveImport('import')).toBeUndefined();
});

it('binds current workspace and non-off reasoning atomically and preserves that choice after restart', async () => {
  const original = await profile(),
    target = await profile();
  session(original.store);
  const exported = await source(original.store);
  await target.store.importSessionArchive('import', input(exported), hash('transport'));
  workspace(target);
  target.store.putProvider({
    id: 'current',
    name: 'Current provider',
    kind: 'custom',
    builtinId: null,
    api: 'openai-completions',
    baseUrl: 'https://fixture.invalid/v1',
    models: [],
    enabled: true,
    requiresApiKey: false,
    revision: 1,
    hasCredential: false,
    credentialType: null,
    legacy: false,
    configured: true,
    authSource: 'none',
    credentialPreview: null,
    credentialRef: 'no-secret',
  });
  target.store.bindSessionArchive('session', {
    providerId: 'current',
    modelId: 'current-model',
    thinkingLevel: 'high',
    workspaceId: 'workspace',
  });
  expect(target.store.getSnapshot('session').session).toMatchObject({
    providerId: 'current',
    modelId: 'current-model',
    thinkingLevel: 'high',
    workspaceId: 'workspace',
    approvalMode: 'ask',
  });
  target.store.close();
  target.store = await openProfileStore(target.directory);
  expect(target.store.getSessionExecutionAccess('session').bound).toBe(true);
  expect(target.store.getSession('session')).toMatchObject({
    workspaceId: 'workspace',
    thinkingLevel: 'high',
  });
});

it('recovers the immutable pool after a crash between final hardlink publication and temporary unlink', async () => {
  const value = await profile();
  workspace(value);
  session(value.store, 'session', 'workspace');
  nativeWrite(value.store, 'write', null, 'linked bytes');
  const pool = join(
    sessionLogDirectory(value.directory, join(value.directory, '.my-pi-harness')),
    'artifacts',
  );
  const target = join(pool, `${hash('linked bytes')}.blob`),
    temporary = join(pool, `${randomUUID()}.tmp`);
  await link(target, temporary);
  expect((await stat(target)).nlink).toBe(2);
  value.store.close();
  value.store = await openProfileStore(value.directory);
  expect((await stat(target)).nlink).toBe(1);
  expect(await readFile(target, 'utf8')).toBe('linked bytes');
  expect((await readdir(pool)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  expect(value.store.getFileChange('session', 'write', { side: 'after' }).text).toBe(
    'linked bytes',
  );
});

it('does not replay or repair a frozen store while creating a complete archive', async () => {
  const value = await profile();
  session(value.store);
  const failure = vi.spyOn(SessionJournal.prototype, 'append').mockImplementationOnce(() => {
    throw new Error('Injected journal failure');
  });
  expect(() =>
    value.store.append('session', [
      { type: 'session.configured', runId: null, at: 2, data: { title: 'Unconfirmed' } },
    ]),
  ).toThrow('outcome may be unknown');
  failure.mockRestore();
  const replay = vi.spyOn(SessionJournal.prototype, 'read');
  expect(() => value.store.createSessionArchive('session')).toThrow('outcome may be unknown');
  expect(replay).not.toHaveBeenCalled();
});
