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
import { buffer } from 'node:stream/consumers';
import Database from 'better-sqlite3';
import { initialWorkState, type MessageView, type RunView } from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openProfileStore,
  sessionLogDirectory,
  type EventInput,
  type ProfileStore,
} from '../src/index.js';
import { SessionBatchSchema, type SessionBatch } from '../src/sessions/session-jsonl.js';
import { checked } from '../src/shared/validation.js';

vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }));
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
function directory(profile: string): string {
  const canonical = fs.realpathSync(profile);
  return sessionLogDirectory(canonical, join(canonical, '.my-pi-harness'));
}
function logPath(profile: string, id = 'session'): string {
  return join(directory(profile), `${id}.jsonl`);
}
async function batches(profile: string): Promise<SessionBatch[]> {
  const text = await readFile(logPath(profile), 'utf8');
  expect(text.endsWith('\n')).toBe(true);
  return text
    .trimEnd()
    .split('\n')
    .map((line) => checked(SessionBatchSchema, JSON.parse(line)));
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
  thinking: '',
  createdAt: 2,
  status: 'complete',
  stopReason: null,
};
function accept(): EventInput[] {
  return [
    event('run.accepted', { run, requestId: 'request' }, 'run', 'private-model-codec'),
    event('message.started', user, 'run', 'private-user-codec'),
  ];
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const value of fixtures.splice(0)) {
    value.store.close();
    await rm(value.directory, { recursive: true, force: true });
  }
});

describe('authoritative host session journals', () => {
  it('downloads the exact durable prefix while later batches continue to append', async () => {
    const value = await fixture();
    value.store.append('session', accept());
    const persisted = await readFile(logPath(value.directory));
    const download = value.store.exportSessionLog('session');
    try {
      value.store.append('session', [event('audit.after-download', { saved: true })]);
      expect(download.byteLength).toBe(persisted.length);
      expect(await buffer(download.content)).toEqual(persisted);
      expect((await readFile(logPath(value.directory))).length).toBeGreaterThan(persisted.length);
    } finally {
      download.content.destroy();
    }
    value.store.close();
    value.store = await openProfileStore(value.directory);
    const reopened = value.store.exportSessionLog('session');
    try {
      expect(await buffer(reopened.content)).toEqual(await readFile(logPath(value.directory)));
    } finally {
      reopened.content.destroy();
    }
  });

  it('refuses log downloads after external modification instead of exporting uncommitted bytes', async () => {
    const value = await fixture();
    await fs.promises.appendFile(logPath(value.directory), '{"uncommitted":');
    expect(() => value.store.exportSessionLog('session')).toThrow('changed outside its owner');
    expect(() => value.store.exportSessionLog('missing')).toThrow('does not exist');
    expect(() => value.store.exportSessionLog('../outside')).toThrow('does not exist');
  });

  it('refuses linked log files during download', async () => {
    const value = await fixture();
    const path = logPath(value.directory);
    const target = join(value.directory, 'outside.jsonl');
    await rename(path, target);
    await symlink(target, path);
    expect(() => value.store.exportSessionLog('session')).toThrow('cannot be downloaded safely');
  });

  it('replays assistant step usage and completion time without rewriting journals or inventing missing usage', async () => {
    const value = await fixture();
    const assistant: MessageView = {
      ...user,
      id: 'assistant',
      role: 'assistant',
      text: '',
      status: 'streaming',
    };
    const completed: MessageView = {
      ...assistant,
      text: 'Answer',
      status: 'complete',
      stopReason: 'stop',
      finishedAt: 4,
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 80,
        cacheWriteTokens: 10,
        totalTokens: 120,
      },
    };
    value.store.append('session', [
      ...accept(),
      event('message.started', assistant, 'run'),
      event('message.completed', { message: completed }, 'run', 'private-assistant-codec'),
      event('run.finished', { status: 'completed', finishedAt: 5, error: null }, 'run'),
    ]);
    const journal = await readFile(logPath(value.directory), 'utf8');
    expect(value.store.getSnapshot('session').messages.at(-1)).toEqual(completed);
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.getSnapshot('session').messages.at(-1)).toEqual(completed);
    expect(value.store.getSnapshot('session').messages[0]).not.toHaveProperty('usage');
    expect(await readFile(logPath(value.directory), 'utf8')).toBe(journal);
    expect(JSON.stringify(value.store.getSnapshot('session'))).not.toContain('private-');
  });

  it.each([
    { inputTokens: -1 },
    { outputTokens: 0.5 },
    { cacheReadTokens: Number.MAX_SAFE_INTEGER + 1 },
    { cacheWriteTokens: '10' },
    { totalTokens: -1 },
    { unrecognized: 1 },
  ])('rejects invalid reported usage %o before appending a journal batch', async (invalid) => {
    const value = await fixture();
    const assistant: MessageView = {
      ...user,
      id: 'assistant',
      role: 'assistant',
      status: 'streaming',
    };
    value.store.append('session', [...accept(), event('message.started', assistant, 'run')]);
    const journal = await readFile(logPath(value.directory), 'utf8');
    expect(() =>
      value.store.append('session', [
        event(
          'message.completed',
          {
            message: {
              ...assistant,
              status: 'complete',
              finishedAt: 3,
              usage: {
                inputTokens: 100,
                outputTokens: 20,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 120,
                ...invalid,
              },
            },
          },
          'run',
        ),
      ]),
    ).toThrow('validation');
    expect(await readFile(logPath(value.directory), 'utf8')).toBe(journal);
    expect(value.store.getSnapshot('session').messages.at(-1)).toEqual(assistant);
  });

  it.each(['user', 'streaming-assistant'])(
    'rejects completion statistics on a %s message before appending it',
    async (kind) => {
      const value = await fixture();
      value.store.append('session', accept());
      const journal = await readFile(logPath(value.directory), 'utf8');
      const message: MessageView = {
        ...user,
        id: 'invalid-statistics',
        role: kind === 'user' ? 'user' : 'assistant',
        status: kind === 'user' ? 'complete' : 'streaming',
        finishedAt: 3,
      };
      expect(() =>
        value.store.append('session', [event('message.started', message, 'run')]),
      ).toThrow('terminal assistant');
      expect(await readFile(logPath(value.directory), 'utf8')).toBe(journal);
    },
  );

  it('persists one complete batch with private replay material while public APIs omit it', async () => {
    const value = await fixture();
    value.store.append('session', accept());
    const logged = await batches(value.directory);
    expect(logged).toHaveLength(2);
    expect(logged[1]?.records).toHaveLength(2);
    expect(logged[1]?.records[0]?.privateData).toBe('private-model-codec');
    expect(logged.flatMap((batch) => batch.records.map((record) => record.event))).toEqual(
      value.store.readEvents('session'),
    );
    expect(JSON.stringify(value.store.readEvents('session'))).not.toContain('private-');
    expect(JSON.stringify(value.store.getSnapshot('session'))).not.toContain('private-');
    if (process.platform !== 'win32') {
      expect((await stat(logPath(value.directory))).mode & 0o777).toBe(0o600);
      expect((await stat(directory(value.directory))).mode & 0o777).toBe(0o700);
    }
  });

  it('validates the entire command before writing and deduplicates accepted requests', async () => {
    const value = await fixture();
    const before = await readFile(logPath(value.directory), 'utf8');
    expect(() =>
      value.store.append('session', [
        ...accept(),
        event('message.started', { ...user, id: 'bad', branchId: 'foreign' }, 'run'),
      ]),
    ).toThrow();
    expect(await readFile(logPath(value.directory), 'utf8')).toBe(before);
    expect(value.store.findRequest('session', 'request')).toBeUndefined();
    value.store.append('session', accept());
    const accepted = await readFile(logPath(value.directory), 'utf8');
    expect(value.store.append('session', accept())).toEqual([]);
    expect(await readFile(logPath(value.directory), 'utf8')).toBe(accepted);
  });

  it('rolls back nested Plan creation without writing an initial partial session', async () => {
    const value = await fixture();
    const sql = new Database(join(value.directory, 'data.sqlite'));
    try {
      sql.exec(
        "CREATE TRIGGER reject_work BEFORE INSERT ON work_states BEGIN SELECT RAISE(ABORT, 'reject mode'); END",
      );
      expect(() =>
        value.store.createSession({
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
      await expect(lstat(logPath(value.directory, 'bad-plan'))).rejects.toHaveProperty(
        'code',
        'ENOENT',
      );
      expect(value.store.getSession('bad-plan')).toBeUndefined();
    } finally {
      sql.close();
    }
  });

  it('rebuilds corrupted SQLite session projections and private codecs without changing configuration', async () => {
    const value = await fixture();
    value.store.putSettings({
      expectedRevision: 1,
      defaultModel: { providerId: 'provider', modelId: 'model', thinkingLevel: 'off' },
    });
    value.store.append('session', [
      ...accept(),
      event('run.finished', { status: 'completed', finishedAt: 3, error: null }, 'run'),
    ]);
    const events = value.store.readEvents('session');
    value.store.close();
    const sql = new Database(join(value.directory, 'data.sqlite'));
    try {
      sql.prepare('UPDATE messages SET data = ?, private_data = ?').run('{}', 'forged-codec');
      sql.prepare('UPDATE sessions SET snapshot_seq = 999, data = ?').run('{}');
      sql.prepare('DELETE FROM events').run();
    } finally {
      sql.close();
    }
    value.store = await openProfileStore(value.directory);
    expect(value.store.readEvents('session')).toEqual(events);
    expect(value.store.getModelContext('session', 'main')).toEqual(['private-user-codec']);
    expect(value.store.getSettings().revision).toBe(2);
    expect(value.store.getSnapshot('session').messages[0]?.text).toBe('Question');
  });

  it('recovers a durable journal after SQLite commit fails, and freezes writes until restart', async () => {
    const value = await fixture();
    // A deferred constraint is activated by a test-owned SQL trigger inside the event transaction.
    const control = new Database(join(value.directory, 'data.sqlite'));
    try {
      control.exec(`CREATE TABLE deferred_parent(id TEXT PRIMARY KEY);
        CREATE TABLE deferred_child(id TEXT REFERENCES deferred_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER fail_commit AFTER INSERT ON events WHEN NEW.type = 'audit.commit-failure'
        BEGIN INSERT INTO deferred_child(id) VALUES ('missing'); END;`);
    } finally {
      control.close();
    }
    expect(() =>
      value.store.append('session', [event('audit.commit-failure', { committed: true })]),
    ).toThrow('journal is committed');
    expect(value.store.readEvents('session')).toHaveLength(1);
    expect(await batches(value.directory)).toHaveLength(2);
    expect(() => value.store.append('session', [event('audit.retry', {})])).toThrow(
      'Restart before retrying',
    );
    expect(() => value.store.exportSessionLog('session')).toThrow('Restart before retrying');
    expect(value.store.getSettings()).toEqual({ revision: 1, defaultModel: null });
    expect(() => value.store.putSettings({ expectedRevision: 1, defaultModel: null })).toThrow(
      'Restart before retrying',
    );
    expect(() => value.store.deleteProvider('provider')).toThrow('Restart before retrying');
    value.store.close();
    const repair = new Database(join(value.directory, 'data.sqlite'));
    repair.exec('DROP TRIGGER fail_commit');
    repair.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.readEvents('session').at(-1)?.type).toBe('audit.commit-failure');
    expect(value.store.putSettings({ expectedRevision: 1, defaultModel: null }).revision).toBe(2);
  });

  it('freezes writes after uncertain fsync; restart replays the complete written batch once', async () => {
    const value = await fixture();
    const failure = vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
      throw new Error('Fixture fsync failure');
    });
    try {
      expect(() =>
        value.store.append('session', [event('audit.saved', { committed: true })]),
      ).toThrow('commit outcome may be unknown');
      expect(value.store.readEvents('session')).toHaveLength(1);
      expect(() => value.store.append('session', [event('audit.retry', {})])).toThrow(
        'Restart before retrying',
      );
      expect(() => value.store.exportSessionLog('session')).toThrow('Restart before retrying');
    } finally {
      failure.mockRestore();
    }
    const written = await readFile(logPath(value.directory), 'utf8');
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.readEvents('session')).toHaveLength(2);
    expect(await readFile(logPath(value.directory), 'utf8')).toBe(written);
  });

  it.each(['fragment', 'missing-newline'])(
    'repairs only an incomplete final batch or its missing newline (%s)',
    async (kind) => {
      const value = await fixture();
      value.store.append('session', [event('audit.one', {}), event('audit.two', {})]);
      const full = await readFile(logPath(value.directory), 'utf8');
      value.store.close();
      await writeFile(
        logPath(value.directory),
        kind === 'fragment' ? `${full}{"version":2,"records":[` : full.trimEnd(),
      );
      value.store = await openProfileStore(value.directory);
      expect(value.store.readEvents('session')).toHaveLength(3);
      expect(await readFile(logPath(value.directory), 'utf8')).toBe(full);
    },
  );

  it.each(['changed-record', 'duplicate-batch', 'invalid-line', 'unknown-version'])(
    'rejects %s without rewriting journal history',
    async (kind) => {
      const value = await fixture();
      const full = await readFile(logPath(value.directory), 'utf8');
      value.store.close();
      let damaged = full.replace('Logs', 'forged');
      if (kind === 'duplicate-batch') damaged = full + full;
      if (kind === 'invalid-line') damaged = '{not json}\n';
      if (kind === 'unknown-version') damaged = full.replace('"version":2', '"version":99');
      await writeFile(logPath(value.directory), damaged);
      await expect(openProfileStore(value.directory)).rejects.toMatchObject({
        code: 'SESSION_LOG_INVALID',
      });
      expect(await readFile(logPath(value.directory), 'utf8')).toBe(damaged);
    },
  );

  it('rejects a missing authoritative journal instead of recreating facts from SQLite', async () => {
    const value = await fixture();
    value.store.close();
    await rm(logPath(value.directory));
    await expect(openProfileStore(value.directory)).rejects.toThrow(
      'authoritative session journal is missing',
    );
  });

  it('replays records spanning read chunks and interrupts active runs once', async () => {
    const value = await fixture();
    value.store.append('session', [
      ...accept(),
      event('audit.large', { text: '项目资料\n'.repeat(16000) }, 'run'),
    ]);
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.getSnapshot('session').runs[0]?.status).toBe('interrupted');
    const before = await readFile(logPath(value.directory), 'utf8');
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(await readFile(logPath(value.directory), 'utf8')).toBe(before);
    expect(value.store.recoverInterrupted()).toEqual([]);
  });

  it('interrupts pending question and plan review in the same recovery command', async () => {
    const value = await fixture();
    value.store.append('session', [
      ...accept(),
      event(
        'work.updated',
        {
          state: {
            ...initialWorkState('main'),
            revision: 1,
            plan: {
              id: 'plan',
              runId: 'run',
              title: 'Plan',
              content: 'Do work',
              steps: [],
              status: 'draft',
              review: 'pending',
              feedback: null,
              updatedAt: 2,
            },
            questions: [
              {
                id: 'question',
                runId: 'run',
                branchId: 'main',
                toolCallId: 'call',
                questions: [
                  {
                    id: 'q1',
                    header: 'Continue',
                    prompt: 'Continue?',
                    options: [],
                    multiSelect: false,
                    allowCustomInput: true,
                  },
                ],
                status: 'pending',
                answers: null,
                createdAt: 2,
              },
            ],
          },
        },
        'run',
      ),
    ]);
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.getWorkState('session')).toMatchObject({
      plan: { review: 'interrupted' },
      questions: [{ status: 'interrupted' }],
    });
    expect(
      (await batches(value.directory)).at(-1)?.records.map((record) => record.event.type),
    ).toEqual(['work.updated', 'run.finished']);
  });

  it.each(['directory-symlink', 'file-symlink', 'file-hardlink', 'directory-replaced'])(
    'rejects %s before committing SQL or modifying an unowned target',
    async (kind) => {
      const value = await fixture();
      const other = join(value.directory, 'other');
      await mkdir(other);
      const sentinel = join(other, 'sentinel');
      await writeFile(sentinel, 'keep');
      if (kind === 'directory-symlink' || kind === 'directory-replaced') {
        await rename(directory(value.directory), join(value.directory, 'original-sessions'));
        if (kind === 'directory-symlink') await symlink(other, directory(value.directory));
        else await mkdir(directory(value.directory));
      } else {
        await rm(logPath(value.directory));
        if (kind === 'file-symlink') await symlink(sentinel, logPath(value.directory));
        else await link(sentinel, logPath(value.directory));
      }
      expect(() => value.store.append('session', [event('audit.new', {})])).toThrow(
        'commit outcome may be unknown',
      );
      expect(await readFile(sentinel, 'utf8')).toBe('keep');
      expect(value.store.readEvents('session')).toHaveLength(1);
    },
  );

  it('rejects path traversal before creating SQL projections or files', async () => {
    const value = await fixture();
    expect(() =>
      value.store.createSession({
        id: '../escape',
        branchId: 'bad',
        title: 'Bad',
        providerId: 'provider',
        modelId: 'model',
        thinkingLevel: 'off',
        workspaceId: null,
        approvalMode: 'ask',
        at: 2,
      }),
    ).toThrow('filename');
    expect(value.store.listSessions()).toHaveLength(1);
  });
});
