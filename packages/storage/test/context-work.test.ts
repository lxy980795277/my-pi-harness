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
  privateData?: Record<string, unknown>,
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
      { marker: 'private-user-codec' },
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
  it('creates a session with empty work state and no extra work event', async () => {
    const { store } = await fixture();
    expect(store.getWorkState('session')).toEqual(initialWorkState('main'));
    const input: CreateSessionInput = {
      id: 'new-session',
      branchId: 'new-main',
      title: 'New session',
      providerId: 'provider',
      modelId: 'model',
      thinkingLevel: 'off',
      workspaceId: null,
      approvalMode: 'ask',
      at: 5,
    };
    const session = store.createSession(input);
    expect(session.snapshotSeq).toBe(1);
    expect(store.getWorkState(session.id)).toEqual(initialWorkState('new-main'));
    expect(store.readEvents(session.id).map(({ seq, type }) => ({ seq, type }))).toEqual([
      { seq: 1, type: 'session.created' },
    ]);
  });

  it('keeps branch state revision checked and rolls back a conflicting batch', async () => {
    const { store } = await fixture();
    expect(store.getWorkState('session')).toEqual(initialWorkState('main'));
    const state = { ...initialWorkState('main'), revision: 1 };
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
      todos: [
        {
          id: 'todo',
          title: 'Task',
          status: 'pending' as const,
          planStepId: null,
          evidenceToolCallIds: [],
          completionNote: null,
        },
      ],
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
          questions: [
            {
              id: 'q1',
              header: 'Choice',
              prompt: 'Which?',
              options: [{ id: 'one', label: 'One', description: '' }],
              multiSelect: false,
              allowCustomInput: true,
            },
          ],
          status: 'pending',
          answers: null,
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
    const value = await fixture();
    const { store } = value;
    start(store);
    const usage = {
      estimatedTokens: 10,
      windowTokens: 100,
      reservedOutput: 20,
      inputBudget: 80,
      trimmedMessages: 0,
      prunedMessages: 0,
      source: 'estimated',
      providerInputTokens: null,
      categories: {
        system: 0,
        rules: 0,
        tools: 0,
        messages: 10,
        attachments: 0,
        summary: 0,
        workingState: 0,
      },
    };
    store.append('session', [
      event('context.prepared', { branchId: 'main', usage, messageIds: ['user'] }, 'run', {
        version: 1,
        systemPrompt: 'private-rules',
        messages: [{ marker: 'private-codec' }],
      }),
    ]);
    expect(JSON.stringify(store.readEvents('session'))).not.toContain('private-rules');
    expect(() =>
      store.append('session', [
        event(
          'context.prepared',
          { branchId: 'main', usage, messageIds: ['user', 'user'] },
          'run',
          { version: 1, systemPrompt: '', messages: [] },
        ),
      ]),
    ).toThrow('ordered branch subset');
    expect(() =>
      store.append('session', [
        event('context.prepared', { branchId: 'main', usage, messageIds: [] }, 'run'),
      ]),
    ).toThrow('private request');
    const expectPreparedProjection = (): void => {
      const connection = new Database(join(value.directory, 'data.sqlite'), { readonly: true });
      try {
        expect(
          connection
            .prepare(
              "SELECT private_data FROM events WHERE session_id = ? AND type = 'context.prepared'",
            )
            .all('session'),
        ).toEqual([{ private_data: null }]);
      } finally {
        connection.close();
      }
      const prepared = value.store.readEvents('session').filter(({ type }) => {
        return type === 'context.prepared';
      });
      expect(prepared).toHaveLength(1);
      expect(prepared[0]?.data).toEqual({ branchId: 'main', usage, messageIds: ['user'] });
      expect(JSON.stringify(prepared)).not.toContain('private-rules');
    };
    expectPreparedProjection();
    store.close();
    value.store = await openProfileStore(value.directory);
    expectPreparedProjection();
  });

  it('retains immutable compaction versions and their parent chain across a restored branch', async () => {
    const value = await fixture();
    start(value.store);
    value.store.append('session', [
      event('run.finished', { status: 'completed', finishedAt: 3, error: null }, 'run'),
    ]);
    const first = {
      id: 'summary-one',
      throughMessageId: 'user',
      summary: 'First summary',
      structured: {
        objective: 'Task',
        constraints: [],
        decisions: [],
        completed: [],
        pending: ['Continue'],
        blockers: [],
        nextAction: 'Continue',
      },
      parentId: null,
      strategy: 'fallback' as const,
      beforeTokens: 100,
      afterTokens: 20,
      sourceMessages: 1,
      runId: null,
      createdAt: 4,
      reason: 'manual' as const,
    };
    const state = { ...initialWorkState('main'), revision: 1, compaction: first };
    value.store.append('session', [event('work.updated', { state })]);
    const second = {
      ...first,
      id: 'summary-two',
      parentId: first.id,
      summary: 'Second summary',
      createdAt: 5,
    };
    value.store.append('session', [
      event('work.updated', { state: { ...state, revision: 2, compaction: second } }),
    ]);
    expect(() =>
      value.store.append('session', [
        event('work.updated', {
          state: { ...state, revision: 3, compaction: { ...second, summary: 'Forged' } },
        }),
      ]),
    ).toThrow('cannot be rewritten');
    value.store.append('session', [
      event('branch.restored', {
        branch: {
          id: 'restored',
          sessionId: 'session',
          parentId: 'main',
          forkMessageId: 'user',
          createdAt: 6,
        },
        messageIds: ['user'],
      }),
      event('branch.selected', { branchId: 'restored' }),
      event('work.updated', { state: { ...state, branchId: 'restored', compaction: second } }),
    ]);
    expect(value.store.listCompactions('session').map((version) => version.id)).toEqual([
      first.id,
      second.id,
    ]);
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.listCompactions('session').map((version) => version.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(value.store.listCompactions('session', 'main')).toHaveLength(2);
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
});
