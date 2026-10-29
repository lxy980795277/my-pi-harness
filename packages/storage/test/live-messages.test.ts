import * as fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageView, RunView } from '@my-pi-harness/protocol';
import { openProfileStore, sessionLogDirectory, type ProfileStore } from '../src/index.js';

interface Fixture {
  directory: string;
  store: ProfileStore;
}

vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }));

const fixtures: Fixture[] = [];
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
const message: MessageView = {
  id: 'assistant',
  sessionId: 'session',
  branchId: 'main',
  runId: 'run',
  role: 'assistant',
  text: '',
  thinking: '',
  createdAt: 2,
  status: 'streaming',
  stopReason: null,
};

async function fixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-live-messages-'));
  const store = await openProfileStore(directory);
  const value = { directory, store };
  fixtures.push(value);
  store.createSession({
    id: 'session',
    branchId: 'main',
    title: 'Live output',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: null,
    approvalMode: 'ask',
    at: 1,
  });
  store.append('session', [
    {
      type: 'run.accepted',
      runId: run.id,
      at: 2,
      data: { run, requestId: 'request' },
    },
    { type: 'message.started', runId: run.id, at: 2, data: message },
  ]);
  return value;
}

function logPath(directory: string): string {
  const canonical = fs.realpathSync(directory);
  return join(sessionLogDirectory(canonical, join(canonical, '.my-pi-harness')), 'session.jsonl');
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const value of fixtures.splice(0)) {
    value.store.close();
    await rm(value.directory, { recursive: true, force: true });
  }
});

describe('live message output', () => {
  it('writes the same number of durable records and JSONL batches for one chunk and a thousand chunks', async () => {
    const single = await fixture();
    const streamed = await fixture();
    const text = 'x'.repeat(1000);
    single.store.publishMessageDelta('session', { runId: 'run', messageId: message.id, text });
    for (let index = 0; index < 1000; index += 1)
      streamed.store.publishMessageDelta('session', {
        runId: 'run',
        messageId: message.id,
        text: 'x',
      });
    expect(streamed.store.getSnapshot('session').liveRevision).toBe(1000);
    for (const value of [single, streamed])
      value.store.append('session', [
        {
          type: 'message.completed',
          runId: 'run',
          at: 3,
          data: { message: { ...message, text, status: 'complete', stopReason: 'stop' } },
          privateData: { final: text },
        },
        {
          type: 'run.finished',
          runId: 'run',
          at: 3,
          data: { status: 'completed', finishedAt: 3, error: null },
        },
      ]);
    const singleLog = await readFile(logPath(single.directory), 'utf8');
    const streamedLog = await readFile(logPath(streamed.directory), 'utf8');
    expect(singleLog.trimEnd().split('\n')).toHaveLength(3);
    expect(streamedLog.trimEnd().split('\n')).toHaveLength(3);
    expect(single.store.readEvents('session').map(({ type }) => type)).toEqual(
      streamed.store.readEvents('session').map(({ type }) => type),
    );
    expect(single.store.getSnapshot('session')).toEqual(streamed.store.getSnapshot('session'));
  });

  it('updates reconnect snapshots without writing SQLite, advancing durable sequence or changing JSONL', async () => {
    const { store, directory } = await fixture();
    const before = store.getSnapshot('session');
    const persisted = await readFile(logPath(directory));
    const observer = new Database(join(directory, 'data.sqlite'));
    try {
      const version = observer.pragma('data_version', { simple: true });
      observer.exec('BEGIN IMMEDIATE');
      try {
        store.publishMessageDelta('session', {
          runId: 'run',
          messageId: message.id,
          text: 'Hello',
        });
      } finally {
        observer.exec('ROLLBACK');
      }
      const first = store.getSnapshot('session');
      store.publishMessageDelta('session', {
        runId: 'run',
        messageId: message.id,
        text: ' world',
        thinking: 'A reason',
      });
      const second = store.getSnapshot('session');
      expect(first.messages[0]).toMatchObject({ text: 'Hello', thinking: '' });
      expect(second.messages[0]).toMatchObject({ text: 'Hello world', thinking: 'A reason' });
      expect(first.liveRevision).toBe(1);
      expect(second.liveRevision).toBe(2);
      expect(second.snapshotSeq).toBe(before.snapshotSeq);
      expect(second.session.snapshotSeq).toBe(before.snapshotSeq);
      expect(store.getSession('session')).toEqual(before.session);
      expect(store.readEvents('session').map(({ seq }) => seq)).toEqual([1, 2, 3]);
      expect(store.getModelContext('session', 'main')).toEqual([]);
      expect(observer.pragma('data_version', { simple: true })).toBe(version);
      expect(observer.prepare('SELECT data FROM messages WHERE id = ?').get(message.id)).toEqual({
        data: JSON.stringify(message),
      });
      expect(await readFile(logPath(directory))).toEqual(persisted);
    } finally {
      observer.close();
    }
  });

  it('retains other active partials when durable facts reset the live revision, then persists exact terminal output', async () => {
    const { store } = await fixture();
    store.publishMessageDelta('session', { runId: 'run', messageId: message.id, text: 'Partial' });
    store.append('session', [{ type: 'audit.frozen', runId: 'run', at: 3, data: {} }]);
    expect(store.getSnapshot('session')).toMatchObject({
      snapshotSeq: 4,
      liveRevision: 0,
      messages: [{ text: 'Partial' }],
    });
    store.publishMessageDelta('session', { runId: 'run', messageId: message.id, thinking: 'More' });
    const terminal: MessageView = {
      ...message,
      text: 'Exact final',
      thinking: 'Exact thinking',
      status: 'complete',
      stopReason: 'stop',
      finishedAt: 4,
    };
    store.append('session', [
      {
        type: 'message.completed',
        runId: 'run',
        at: 4,
        data: { message: terminal },
        privateData: { final: true },
      },
    ]);
    expect(store.getSnapshot('session')).toMatchObject({
      snapshotSeq: 5,
      liveRevision: 0,
      messages: [terminal],
    });
    expect(store.getModelContext('session', 'main')).toEqual([{ final: true }]);
    expect(() =>
      store.publishMessageDelta('session', { runId: 'run', messageId: message.id, text: 'Late' }),
    ).toThrow('no longer accepts');
  });

  it('keeps live output when a durable command rolls back instead of publishing premature cleanup', async () => {
    const { store } = await fixture();
    store.publishMessageDelta('session', { runId: 'run', messageId: message.id, text: 'Retained' });
    expect(() =>
      store.append('session', [
        {
          type: 'message.completed',
          runId: 'run',
          at: 3,
          data: { message: { ...message, text: 'Final', status: 'failed' } },
        },
        { type: 'run.started', runId: 'missing', at: 3, data: {} },
      ]),
    ).toThrow('does not belong');
    expect(store.getSnapshot('session')).toMatchObject({
      snapshotSeq: 3,
      liveRevision: 1,
      messages: [{ text: 'Retained', status: 'streaming' }],
    });
  });

  it('keeps the last live snapshot on an uncertain journal failure and refuses further deltas', async () => {
    const { store } = await fixture();
    store.publishMessageDelta('session', { runId: 'run', messageId: message.id, text: 'Retained' });
    vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
      throw new Error('Fixture fsync failure');
    });
    expect(() =>
      store.append('session', [
        {
          type: 'message.completed',
          runId: 'run',
          at: 3,
          data: { message: { ...message, text: 'Final', status: 'cancelled' } },
        },
      ]),
    ).toThrow('outcome may be unknown');
    expect(store.getSnapshot('session')).toMatchObject({
      snapshotSeq: 3,
      liveRevision: 1,
      messages: [{ text: 'Retained', status: 'streaming' }],
    });
    expect(() =>
      store.publishMessageDelta('session', { runId: 'run', messageId: message.id, text: 'Lost' }),
    ).toThrow('outcome may be unknown');
    expect(() => store.getVisibleTool('session', 'unused')).toThrow('outcome may be unknown');
  });

  it('rejects durable delta writes and unrelated stream targets without changing either cursor', async () => {
    const { store, directory } = await fixture();
    const persisted = await readFile(logPath(directory));
    expect(() =>
      store.append('session', [
        { type: 'audit.before-invalid', runId: 'run', at: 3, data: {} },
        {
          type: 'message.delta',
          runId: 'run',
          at: 3,
          data: { messageId: message.id, text: 'Never durable' },
        },
      ]),
    ).toThrow('must not enter');
    expect(() =>
      store.publishMessageDelta('session', { runId: 'foreign', messageId: message.id, text: 'No' }),
    ).toThrow('no longer accepts');
    expect(() =>
      store.publishMessageDelta('missing', { runId: 'run', messageId: message.id, text: 'No' }),
    ).toThrow('does not exist');
    expect(store.getSnapshot('session')).toMatchObject({ snapshotSeq: 3, liveRevision: 0 });
    expect(await readFile(logPath(directory))).toEqual(persisted);
  });

  it('rejects cross-session, non-assistant and oversized output without replacing the last live snapshot', async () => {
    const { store } = await fixture();
    store.createSession({
      id: 'other-session',
      branchId: 'other-branch',
      title: 'Other conversation',
      providerId: 'provider',
      modelId: 'model',
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'ask',
      at: 1,
    });
    store.append('session', [
      {
        type: 'message.started',
        runId: 'run',
        at: 2,
        data: { ...message, id: 'user', role: 'user', text: 'Question', status: 'complete' },
      },
    ]);
    store.publishMessageDelta('session', {
      runId: 'run',
      messageId: message.id,
      text: 'Already shown',
    });
    const before = store.getSnapshot('session');
    expect(() =>
      store.publishMessageDelta('other-session', {
        runId: 'run',
        messageId: message.id,
        text: 'Wrong session',
      }),
    ).toThrow('no longer accepts');
    expect(() =>
      store.publishMessageDelta('session', { runId: 'run', messageId: 'user', text: 'No' }),
    ).toThrow('no longer accepts');
    expect(() =>
      store.publishMessageDelta('session', { runId: 'run', messageId: message.id }),
    ).toThrow('failed validation');
    expect(() =>
      store.publishMessageDelta('session', {
        runId: 'run',
        messageId: message.id,
        text: 'x'.repeat(2_000_000),
      }),
    ).toThrow('failed validation');
    expect(store.getSnapshot('session')).toEqual(before);
    expect(store.getSnapshot('other-session').liveRevision).toBe(0);
  });

  it('drops process-local output on close and advances the durable cursor when interrupting the reopened run', async () => {
    const value = await fixture();
    value.store.publishMessageDelta('session', {
      runId: 'run',
      messageId: message.id,
      text: 'Only in this process',
    });
    const before = value.store.getSnapshot('session');
    value.store.close();
    expect(() =>
      value.store.publishMessageDelta('session', {
        runId: 'run',
        messageId: message.id,
        text: 'No',
      }),
    ).toThrow('closed');
    value.store = await openProfileStore(value.directory);
    const recovered = value.store.getSnapshot('session');
    expect(recovered.liveRevision).toBe(0);
    expect(recovered.snapshotSeq).toBeGreaterThan(before.snapshotSeq);
    expect(recovered.messages).toMatchObject([{ text: '', status: 'interrupted' }]);
    expect(recovered.session.activeRunId).toBeNull();
    expect(value.store.recoverInterrupted()).toEqual([]);
  });
});
