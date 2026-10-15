import * as fs from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  HarnessEventSchema,
  initialWorkState,
  type HarnessEvent,
  type MessageView,
  type RunView,
  type ToolCallRecord,
} from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openProfileStore,
  sessionLogDirectory,
  type EventInput,
  type ProfileStore,
} from '../src/index.js';

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return { ...original, fsyncSync: vi.fn(original.fsyncSync) };
});

const fixtures: { directory: string; store: ProfileStore }[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-session-log-'));
  const store = await openProfileStore(directory);
  const value = { directory, store };
  fixtures.push(value);
  store.createSession({
    id: 'session',
    branchId: 'main',
    title: 'Logs',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: null,
    approvalMode: 'ask',
    at: 1,
  });
  return value;
}
function logRoot(directory: string): string {
  return join(fs.realpathSync(directory), '.my-pi-harness');
}
function logDirectory(directory: string, root = logRoot(directory)): string {
  return sessionLogDirectory(fs.realpathSync(directory), root);
}
function logPath(directory: string, id = 'session'): string {
  return join(logDirectory(directory), `${id}.jsonl`);
}
async function logged(directory: string, id = 'session'): Promise<HarnessEvent[]> {
  const text = await readFile(logPath(directory, id), 'utf8');
  expect(text.endsWith('\n')).toBe(true);
  return text
    .trimEnd()
    .split('\n')
    .map((line) => {
      const value: unknown = JSON.parse(line);
      if (!Value.Check(HarnessEventSchema, value)) throw new Error('Invalid public JSONL');
      return value;
    });
}
function event(
  type: string,
  data: Record<string, unknown>,
  runId: string | null = null,
  privateData?: string,
): EventInput {
  return { type, data, runId, at: 2, ...(privateData === undefined ? {} : { privateData }) };
}
const run: RunView = {
  id: 'run',
  sessionId: 'session',
  branchId: 'main',
  providerId: 'provider',
  modelId: 'model',
  status: 'running',
  createdAt: 2,
  finishedAt: null,
  error: null,
};
const user: MessageView = {
  id: 'user',
  sessionId: 'session',
  branchId: 'main',
  runId: 'run',
  role: 'user',
  text: 'Question',
  attachmentIds: ['attachment'],
  thinking: '',
  createdAt: 2,
  status: 'complete',
  stopReason: null,
};
function accept(): EventInput[] {
  return [
    event('run.accepted', { run, requestId: 'request' }, 'run', 'private-model-codec'),
    event('message.started', user, 'run', 'private-image-base64'),
  ];
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { directory, store } of fixtures.splice(0)) {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

describe('SQLite-owned session JSONL mirrors', () => {
  it('mirrors stream, tools, queue, work, branches and archive in exact committed sequence without private codecs', async () => {
    const { directory, store } = await fixture();
    const attachmentBytes = Buffer.from('private-attachment-bytes').toString('base64');
    store.putAttachment({
      attachment: {
        id: 'attachment',
        name: 'image.png',
        mediaType: 'image/png',
        kind: 'image',
        byteLength: 24,
        preview: '',
        sourcePath: null,
        workspaceId: null,
        createdAt: 1,
      },
      text: null,
      imageData: attachmentBytes,
    });
    store.append('session', accept());
    const assistant: MessageView = {
      ...user,
      id: 'assistant',
      role: 'assistant',
      text: '',
      attachmentIds: [],
      status: 'streaming',
    };
    store.append('session', [
      event('message.started', assistant, 'run'),
      event('message.delta', { messageId: assistant.id, text: 'Read files' }, 'run'),
      event(
        'message.completed',
        {
          message: { ...assistant, text: 'Read files', status: 'complete', stopReason: 'toolUse' },
        },
        'run',
        'private-assistant-codec',
      ),
    ]);
    const tool: ToolCallRecord = {
      id: 'tool',
      sessionId: 'session',
      runId: 'run',
      branchId: 'main',
      name: 'read_file',
      arguments: { path: 'notes.txt' },
      status: 'running',
      summary: 'Read file',
      result: null,
      diff: null,
      createdAt: 2,
      updatedAt: 2,
    };
    store.append('session', [
      event('tool.requested', { tool }, 'run'),
      event(
        'tool.updated',
        { tool: { ...tool, status: 'completed', result: 'Public result' } },
        'run',
      ),
      event(
        'tool.context',
        { branchId: 'main', afterMessageId: 'assistant', toolCallId: 'tool' },
        'run',
        'private-tool-codec',
      ),
      event(
        'queue.added',
        {
          id: 'queue',
          sessionId: 'session',
          text: 'Later',
          mode: 'follow-up',
          providerId: 'provider',
          modelId: 'model',
          createdAt: 2,
          updatedAt: 2,
          revision: 1,
        },
        'run',
        JSON.stringify({ version: 1, requestId: 'queued' }),
      ),
      event(
        'work.updated',
        { state: { ...initialWorkState('main'), revision: 1, mode: 'plan' } },
        'run',
      ),
      event('run.finished', { status: 'completed', finishedAt: 3, error: null }, 'run'),
    ]);
    store.append('session', [
      event('branch.restored', {
        branch: {
          id: 'restored',
          sessionId: 'session',
          parentId: 'main',
          forkMessageId: 'assistant',
          createdAt: 4,
        },
        messageIds: ['user', 'assistant'],
      }),
      event('branch.selected', { branchId: 'restored' }),
      event('session.deleted', {}),
    ]);
    const records = await logged(directory);
    expect(records).toEqual(store.readEvents('session'));
    expect(records.map(({ seq }) => seq)).toEqual(
      Array.from({ length: records.length }, (_, index) => index + 1),
    );
    const text = await readFile(logPath(directory), 'utf8');
    expect(text).not.toContain('private-');
    expect(text).not.toContain('privateData');
    expect(text).not.toContain(attachmentBytes);
    expect(text).toContain('attachment');
    expect(store.getSession('session')).toBeUndefined();
    if (process.platform !== 'win32') {
      expect((await stat(logPath(directory))).mode & 0o777).toBe(0o600);
      expect((await stat(logDirectory(directory))).mode & 0o777).toBe(0o700);
    }
  });

  it('reconciles multi-byte records crossing chunks and more than one SQLite event page', async () => {
    const value = await fixture();
    value.store.append('session', [
      event('audit.large', { text: '项目资料\n'.repeat(16_000) }),
      ...Array.from({ length: 520 }, (_, index) => event('audit.row', { index })),
    ]);
    const before = await readFile(logPath(value.directory), 'utf8');
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect((await logged(value.directory)).map(({ seq }) => seq)).toEqual(
      Array.from({ length: 522 }, (_, index) => index + 1),
    );
    expect(await readFile(logPath(value.directory), 'utf8')).toBe(before);
    expect((await logged(value.directory))[1]?.data).toEqual({ text: '项目资料\n'.repeat(16_000) });
  });

  it('does not mirror a rolled-back batch or a failed nested Plan creation, and deduplicates accepted requests', async () => {
    const { directory, store } = await fixture();
    const initial = await readFile(logPath(directory), 'utf8');
    expect(() =>
      store.append('session', [
        ...accept(),
        event('message.started', { ...user, id: 'bad', branchId: 'foreign' }, 'run'),
      ]),
    ).toThrow();
    expect(await readFile(logPath(directory), 'utf8')).toBe(initial);
    const database = new Database(join(directory, 'data.sqlite'));
    try {
      database.exec(
        "CREATE TRIGGER reject_work BEFORE INSERT ON work_states BEGIN SELECT RAISE(ABORT, 'reject mode'); END",
      );
      expect(() =>
        store.createSession({
          id: 'bad-plan',
          branchId: 'bad-main',
          title: 'Plan',
          providerId: 'provider',
          modelId: 'model',
          thinkingLevel: 'off',
          workspaceId: null,
          approvalMode: 'ask',
          workMode: 'plan',
          at: 3,
        }),
      ).toThrow();
      await expect(lstat(logPath(directory, 'bad-plan'))).rejects.toHaveProperty('code', 'ENOENT');
      expect(store.getSession('bad-plan')).toBeUndefined();
    } finally {
      database.close();
    }
    const inputs = accept();
    store.append('session', inputs);
    const before = await readFile(logPath(directory), 'utf8');
    expect(store.append('session', inputs)).toEqual([]);
    expect(await readFile(logPath(directory), 'utf8')).toBe(before);
  });

  it('backfills missing logs including archived sessions and adds interruption facts without duplicates on restart', async () => {
    const value = await fixture();
    value.store.append('session', accept());
    value.store.createSession({
      id: 'archived',
      branchId: 'archived-main',
      title: 'Archived',
      providerId: 'provider',
      modelId: 'model',
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'ask',
      at: 4,
    });
    value.store.append('archived', [event('session.deleted', {})]);
    value.store.close();
    await rm(logRoot(value.directory), { recursive: true });
    value.store = await openProfileStore(value.directory);
    expect(await logged(value.directory)).toEqual(value.store.readEvents('session'));
    expect((await logged(value.directory)).at(-1)).toMatchObject({
      type: 'run.finished',
      data: { status: 'interrupted' },
    });
    expect(await logged(value.directory, 'archived')).toEqual(value.store.readEvents('archived'));
    const before = await readFile(logPath(value.directory), 'utf8');
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(await readFile(logPath(value.directory), 'utf8')).toBe(before);
  });

  it.each(['recovery-fsync', 'damaged-work-projection'])(
    'closes owned directory descriptors when startup %s fails',
    async (fault) => {
      const value = await fixture();
      const state = {
        ...initialWorkState('main'),
        revision: 1,
        questions: [
          {
            id: 'question',
            runId: 'run',
            branchId: 'main',
            toolCallId: 'call',
            prompt: 'Continue?',
            options: [],
            status: 'pending' as const,
            answer: null,
            createdAt: 2,
          },
        ],
      };
      value.store.append('session', [...accept(), event('work.updated', { state }, 'run')]);
      value.store.close();
      const database = new Database(join(value.directory, 'data.sqlite'));
      if (fault === 'damaged-work-projection')
        database
          .prepare('UPDATE work_states SET data = ?')
          .run(JSON.stringify({ ...state, revision: 99 }));
      database.close();
      const openedDirectories: number[] = [];
      const actual = await vi.importActual<typeof fs>('node:fs');
      const originalOpen = actual.openSync;
      const originalFsync = actual.fsyncSync;
      const opening = vi.spyOn(fs, 'openSync').mockImplementation((path, flags, mode) => {
        const fd = originalOpen(path, flags, mode);
        if (fs.fstatSync(fd).isDirectory()) openedDirectories.push(fd);
        return fd;
      });
      const syncing = vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
        if (fault === 'recovery-fsync' && fs.fstatSync(fd).isFile())
          throw new Error('Fixture recovery log synchronization failure');
        return originalFsync(fd);
      });
      try {
        await expect(openProfileStore(value.directory)).rejects.toMatchObject({
          code: fault === 'recovery-fsync' ? 'SESSION_LOG_UNAVAILABLE' : 'INVALID_RECORD',
        });
        if (process.platform !== 'win32') expect(openedDirectories).toHaveLength(4);
        for (const fd of openedDirectories)
          expect(() => fs.fstatSync(fd)).toThrow(expect.objectContaining({ code: 'EBADF' }));
      } finally {
        syncing.mockRestore();
        opening.mockRestore();
      }
      if (fault === 'damaged-work-projection') {
        const repair = new Database(join(value.directory, 'data.sqlite'));
        try {
          repair.prepare('UPDATE work_states SET data = ?').run(JSON.stringify(state));
        } finally {
          repair.close();
        }
      }
      value.store = await openProfileStore(value.directory);
      expect(value.store.getSnapshot('session').session.activeRunId).toBeNull();
      expect(await logged(value.directory)).toEqual(value.store.readEvents('session'));
    },
  );

  it.each(['fragment', 'missing-newline'])(
    'repairs a crash tail (%s) from SQLite without duplicating complete events',
    async (tail) => {
      const value = await fixture();
      value.store.append('session', [event('audit.saved', { public: true })]);
      const records = value.store.readEvents('session');
      value.store.close();
      const text =
        tail === 'fragment'
          ? `${JSON.stringify(records[0])}\n{"version":1,"eventId":"cut`
          : `${JSON.stringify(records[0])}\n${JSON.stringify(records[1])}`;
      await writeFile(logPath(value.directory), text, { mode: 0o600 });
      value.store = await openProfileStore(value.directory);
      expect(await logged(value.directory)).toEqual(records);
    },
  );

  it.each(['changed-record', 'extra-complete-tail', 'invalid-complete-line'])(
    'rejects %s without silently rewriting public history',
    async (kind) => {
      const value = await fixture();
      const record = value.store.readEvents('session')[0];
      value.store.close();
      let content = `${JSON.stringify({ ...record, type: 'forged' })}\n`;
      if (kind === 'extra-complete-tail')
        content = `${JSON.stringify(record)}\n${JSON.stringify(record)}`;
      if (kind === 'invalid-complete-line') content = '{not json}\n';
      await writeFile(logPath(value.directory), content, { mode: 0o600 });
      await expect(openProfileStore(value.directory)).rejects.toMatchObject({
        code: 'SESSION_LOG_INVALID',
      });
      expect(await readFile(logPath(value.directory), 'utf8')).toBe(content);
      await rm(logPath(value.directory));
      value.store = await openProfileStore(value.directory);
      expect(await logged(value.directory)).toEqual(value.store.readEvents('session'));
    },
  );

  it('preserves committed SQLite facts after a file failure, rejects more writes and repairs them after restart', async () => {
    const value = await fixture();
    await rm(logPath(value.directory));
    await mkdir(logPath(value.directory));
    expect(() => value.store.append('session', accept())).toThrow('SQLite changes are committed');
    expect(value.store.findRequest('session', 'request')).toEqual({ runId: 'run', inputId: null });
    expect(value.store.getSnapshot('session').messages[0]?.attachmentIds).toEqual(['attachment']);
    expect(value.store.readEvents('session')).toHaveLength(3);
    expect(() => value.store.append('session', [event('audit.retry', {})])).toThrow(
      'Restart before retrying',
    );
    expect(value.store.readEvents('session')).toHaveLength(3);
    value.store.close();
    await rm(logPath(value.directory), { recursive: true });
    value.store = await openProfileStore(value.directory);
    expect(await logged(value.directory)).toEqual(value.store.readEvents('session'));
    const recovered = await readFile(logPath(value.directory), 'utf8');
    expect(value.store.append('session', accept())).toEqual([]);
    expect(await readFile(logPath(value.directory), 'utf8')).toBe(recovered);
  });

  it('does not repeat committed events when fsync fails after the bytes were written', async () => {
    const value = await fixture();
    const failure = vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
      throw new Error('Fixture disk synchronization failure');
    });
    try {
      expect(() =>
        value.store.append('session', [event('audit.saved', { committed: true })]),
      ).toThrow('SQLite changes are committed');
      expect(value.store.getSnapshot('session').snapshotSeq).toBe(2);
      expect(value.store.readEvents('session')).toHaveLength(2);
    } finally {
      failure.mockRestore();
    }
    const written = await readFile(logPath(value.directory), 'utf8');
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(await logged(value.directory)).toEqual(value.store.readEvents('session'));
    expect(await readFile(logPath(value.directory), 'utf8')).toBe(written);
  });

  it.each(['directory-symlink', 'file-symlink', 'file-hardlink', 'directory-replaced'])(
    'rejects %s before writing into an unowned target',
    async (kind) => {
      const value = await fixture();
      const other = join(value.directory, 'other');
      await mkdir(other);
      const sentinel = join(other, 'sentinel');
      await writeFile(sentinel, 'keep');
      if (kind === 'directory-symlink' || kind === 'directory-replaced') {
        await rename(logDirectory(value.directory), join(value.directory, 'original-sessions'));
        if (kind === 'directory-symlink') await symlink(other, logDirectory(value.directory));
        else await mkdir(logDirectory(value.directory));
      } else {
        await rm(logPath(value.directory));
        if (kind === 'file-symlink') await symlink(sentinel, logPath(value.directory));
        else await link(sentinel, logPath(value.directory));
      }
      expect(() => value.store.append('session', [event('audit.new', {})])).toThrow(
        'SQLite changes are committed',
      );
      expect(await readFile(sentinel, 'utf8')).toBe('keep');
      expect(value.store.readEvents('session')).toHaveLength(2);
    },
  );

  it('rejects path traversal IDs before creating any SQLite session or log file', async () => {
    const { directory, store } = await fixture();
    expect(() =>
      store.createSession({
        id: '../escape',
        branchId: 'escape-main',
        title: 'Unsafe',
        providerId: 'provider',
        modelId: 'model',
        thinkingLevel: 'off',
        workspaceId: null,
        approvalMode: 'ask',
        at: 2,
      }),
    ).toThrow('filename');
    expect(store.listSessions()).toHaveLength(1);
    await expect(lstat(join(directory, 'escape.jsonl'))).rejects.toHaveProperty('code', 'ENOENT');
  });
});
