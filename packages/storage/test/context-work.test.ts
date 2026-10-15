import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initialWorkState, type WorkState } from '@my-pi-harness/protocol';
import {
  openProfileStore,
  type ProfileStore,
  type EventInput,
  type CreateSessionInput,
} from '../src/index.js';
import { FOUNDATION_SQL } from '../src/migrations/0001-foundation.js';
import { MODEL_SETTINGS_SQL } from '../src/migrations/0002-model-settings.js';
import { WORKSPACES_SQL } from '../src/migrations/0003-workspaces.js';
import { WORKSPACE_ICONS_SQL } from '../src/migrations/0004-workspace-icons.js';

const fixtures: { directory: string; store: ProfileStore }[] = [];
async function fixture(): Promise<{ directory: string; store: ProfileStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-work-'));
  const store = await openProfileStore(directory);
  const value = { directory, store };
  fixtures.push(value);
  store.createSession({
    id: 'session',
    branchId: 'main',
    title: 'Work',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: null,
    approvalMode: 'ask',
    at: 1,
  });
  return value;
}
function event(
  type: string,
  data: Record<string, unknown>,
  runId: string | null = null,
  privateData?: string,
): EventInput {
  return { type, data, runId, at: 2, ...(privateData === undefined ? {} : { privateData }) };
}
function start(store: ProfileStore): void {
  store.append('session', [
    event(
      'run.accepted',
      {
        requestId: 'request',
        run: {
          id: 'run',
          sessionId: 'session',
          branchId: 'main',
          providerId: 'provider',
          modelId: 'model',
          status: 'running',
          createdAt: 2,
          finishedAt: null,
          error: null,
        },
      },
      'run',
    ),
    event(
      'message.started',
      {
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
      },
      'run',
      'private-user-codec',
    ),
  ]);
}
afterEach(async () => {
  for (const value of fixtures.splice(0)) {
    value.store.close();
    await rm(value.directory, { recursive: true, force: true });
  }
});

describe('M3 durable work state', () => {
  it('commits first-session Plan mode atomically and preserves execute defaults', async () => {
    const { directory, store } = await fixture();
    expect(store.getWorkState('session')).toMatchObject({ revision: 0, mode: 'execute' });
    expect(store.getSession('session')?.snapshotSeq).toBe(1);
    const input: CreateSessionInput = {
      id: 'planning',
      branchId: 'planning-main',
      title: 'Plan first',
      providerId: 'provider',
      modelId: 'model',
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'ask',
      workMode: 'plan',
      at: 5,
    };
    const connection = new Database(join(directory, 'data.sqlite'));
    try {
      connection.exec(
        "CREATE TRIGGER reject_initial_work BEFORE INSERT ON work_states BEGIN SELECT RAISE(ABORT, 'initial mode rejected'); END",
      );
      expect(() => store.createSession(input)).toThrow();
      expect(store.getSession('planning')).toBeUndefined();
      expect(
        connection
          .prepare("SELECT count(*) AS count FROM branches WHERE id = 'planning-main'")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        connection
          .prepare("SELECT count(*) AS count FROM events WHERE session_id = 'planning'")
          .get(),
      ).toEqual({ count: 0 });
      connection.exec('DROP TRIGGER reject_initial_work');
      const session = store.createSession(input);
      expect(session.snapshotSeq).toBe(2);
      expect(store.getWorkState(session.id)).toMatchObject({
        revision: 1,
        mode: 'plan',
        branchId: 'planning-main',
      });
      expect(store.readEvents(session.id).map(({ seq, type }) => ({ seq, type }))).toEqual([
        { seq: 1, type: 'session.created' },
        { seq: 2, type: 'work.updated' },
      ]);
      const execute = store.createSession({
        ...input,
        id: 'executing',
        branchId: 'executing-main',
        workMode: 'execute',
      });
      expect(execute.snapshotSeq).toBe(1);
      expect(store.getWorkState(execute.id)).toMatchObject({ revision: 0, mode: 'execute' });
    } finally {
      connection.close();
    }
  });

  it('keeps branch state revision checked and rolls back a conflicting batch', async () => {
    const { store } = await fixture();
    expect(store.getWorkState('session')).toEqual(initialWorkState('main'));
    const state = { ...initialWorkState('main'), revision: 1, mode: 'plan' as const };
    store.append('session', [event('work.updated', { state })]);
    expect(store.getWorkState('session')).toEqual(state);
    expect(() => store.append('session', [event('work.updated', { state })])).toThrow('revision');
    expect(() =>
      store.append('session', [
        event('work.updated', { state: { ...state, revision: 2 } }),
        event('work.updated', { state: { ...state, revision: 4 } }),
      ]),
    ).toThrow('revision');
    expect(store.getWorkState('session').revision).toBe(1);
    expect(store.readEvents('session')).toHaveLength(2);
  });

  it('freezes checkpoints and restores empty or complete parent prefixes into independent branches', async () => {
    const value = await fixture();
    start(value.store);
    value.store.append('session', [
      event('run.finished', { status: 'completed', finishedAt: 3, error: null }, 'run'),
    ]);
    const state = {
      ...initialWorkState('main'),
      revision: 1,
      todos: [{ id: 'todo', title: 'Task', status: 'pending' as const }],
    };
    value.store.append('session', [
      event('work.updated', { state }),
      event('checkpoint.created', {
        checkpoint: {
          id: 'checkpoint',
          sessionId: 'session',
          branchId: 'main',
          label: 'Before',
          createdAt: 4,
          messageIds: ['user'],
          state,
        },
      }),
    ]);
    for (const [id, messageIds] of [
      ['empty', []],
      ['restored', ['user']],
    ] as const) {
      value.store.append('session', [
        event('branch.restored', {
          branch: {
            id,
            sessionId: 'session',
            parentId: 'main',
            forkMessageId: messageIds.at(-1) ?? null,
            createdAt: 5,
          },
          messageIds: [...messageIds],
        }),
      ]);
    }
    value.store.append('session', [event('branch.selected', { branchId: 'restored' })]);
    expect(value.store.getSnapshot('session').messages.map((message) => message.id)).toEqual([
      'user',
    ]);
    expect(value.store.getWorkState('session')).toEqual(initialWorkState('restored'));
    expect(value.store.getWorkState('session', 'main').todos).toHaveLength(1);
    expect(value.store.listCheckpoints('session')).toHaveLength(1);
    expect(() =>
      value.store.append('session', [
        event('branch.restored', {
          branch: {
            id: 'invalid',
            sessionId: 'session',
            parentId: 'main',
            forkMessageId: 'foreign',
            createdAt: 6,
          },
          messageIds: ['foreign'],
        }),
      ]),
    ).toThrow('ordered parent prefix');
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.listCheckpoints('session')[0]?.state.todos).toHaveLength(1);
    expect(value.store.getSnapshot('session').messages.map((message) => message.id)).toEqual([
      'user',
    ]);
  });

  it('appends interruption for pending questions after reopen and never rewrites the prior event', async () => {
    const value = await fixture();
    start(value.store);
    const state: WorkState = {
      ...initialWorkState('main'),
      revision: 1,
      questions: [
        {
          id: 'question',
          runId: 'run',
          branchId: 'main',
          toolCallId: 'call',
          prompt: 'Which?',
          options: ['One'],
          status: 'pending',
          answer: null,
          createdAt: 3,
        },
      ],
    };
    value.store.append('session', [event('work.updated', { state }, 'run')]);
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.getWorkState('session')).toMatchObject({
      revision: 2,
      questions: [{ status: 'interrupted' }],
    });
    const updates = value.store
      .readEvents('session')
      .filter((entry) => entry.type === 'work.updated');
    expect(updates).toHaveLength(2);
    expect(updates[0]?.data).toEqual({ state });
    expect(value.store.getSnapshot('session').runs[0]?.status).toBe('interrupted');
    expect(value.store.recoverInterrupted()).toEqual([]);
  });

  it('requires prepared context to match an active branch and keeps request codecs private', async () => {
    const { store } = await fixture();
    start(store);
    const usage = {
      estimatedTokens: 10,
      windowTokens: 100,
      reservedOutput: 20,
      inputBudget: 80,
      trimmedMessages: 0,
    };
    store.append('session', [
      event(
        'context.prepared',
        { branchId: 'main', usage, messageIds: ['user'] },
        'run',
        JSON.stringify({ version: 1, systemPrompt: 'private-rules', messages: ['private-codec'] }),
      ),
    ]);
    expect(JSON.stringify(store.readEvents('session'))).not.toContain('private-rules');
    expect(() =>
      store.append('session', [
        event(
          'context.prepared',
          { branchId: 'main', usage, messageIds: ['user', 'user'] },
          'run',
          JSON.stringify({ version: 1, systemPrompt: '', messages: [] }),
        ),
      ]),
    ).toThrow('ordered branch subset');
    expect(() =>
      store.append('session', [
        event('context.prepared', { branchId: 'main', usage, messageIds: [] }, 'run'),
      ]),
    ).toThrow('private request');
  });

  it('preserves private attachment content across reopen and rejects identity replacement', async () => {
    const value = await fixture();
    const content = {
      attachment: {
        id: 'file',
        name: 'file.txt',
        mediaType: 'text/plain',
        kind: 'text' as const,
        byteLength: 7,
        preview: 'private',
        sourcePath: null,
        createdAt: 1,
      },
      text: 'private',
      imageData: null,
    };
    value.store.putAttachment(content);
    expect(() => value.store.putAttachment(content)).toThrow('already exists');
    expect(JSON.stringify(value.store.readEvents('session'))).not.toContain('private');
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.getAttachment('file')).toEqual(content);
    expect(value.store.getAttachment('missing')).toBeUndefined();
  });

  it('upgrades a released schema-four database without editing old events or migration checksums', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-migrate-work-'));
    const database = new Database(join(directory, 'data.sqlite'));
    const sqls = [FOUNDATION_SQL, MODEL_SETTINGS_SQL, WORKSPACES_SQL, WORKSPACE_ICONS_SQL];
    database.exec(
      'CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)',
    );
    for (const [index, sql] of sqls.entries()) {
      database.exec(sql);
      database
        .prepare('INSERT INTO schema_migrations VALUES (?, ?, 1)')
        .run(index + 1, createHash('sha256').update(sql).digest('hex'));
    }
    database.pragma('user_version = 4');
    const original = database.prepare('SELECT * FROM schema_migrations').all();
    database.close();
    const store = await openProfileStore(directory);
    fixtures.push({ directory, store });
    const check = new Database(join(directory, 'data.sqlite'));
    try {
      expect(check.pragma('user_version', { simple: true })).toBe(5);
      expect(check.prepare('SELECT * FROM schema_migrations WHERE version <= 4').all()).toEqual(
        original,
      );
      expect(
        check
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('work_states', 'attachments', 'checkpoints')",
          )
          .all(),
      ).toHaveLength(3);
    } finally {
      check.close();
    }
  });
});
