import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  initialWorkState,
  type MessageView,
  type ToolCallRecord,
  type ApprovalMode,
} from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { openProfileStore } from '../src/index.js';
import {
  createAgentSession,
  codec,
  event,
  run,
  spawn,
  user,
  type AgentSessionFixture,
} from './fixtures/agent-session.js';
import { storedToolCallId } from '../src/sessions/projections/tool-intents.js';

const fixtures: AgentSessionFixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.store.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

async function fixture(approvalMode: ApprovalMode = 'ask'): Promise<AgentSessionFixture> {
  const value = await createAgentSession(approvalMode);
  fixtures.push(value);
  return value;
}

describe('durable agent tasks', () => {
  it('keeps root and child live output isolated while unrelated durable commits preserve partials', async () => {
    const { store } = await fixture();
    spawn(store, 'first');
    spawn(store, 'second');
    const root: MessageView = {
      ...user('root-stream', 'root', ''),
      role: 'assistant',
      status: 'streaming',
    };
    const child: MessageView = {
      ...user('child-stream', 'run-first', ''),
      role: 'assistant',
      status: 'streaming',
    };
    store.append('session', [
      event('message.started', root, 'root'),
      event('message.started', child, 'run-first'),
    ]);
    const durable = store.getSnapshot('session').snapshotSeq;
    store.publishMessageDelta('session', {
      runId: 'root',
      messageId: root.id,
      text: 'Root partial',
    });
    store.publishMessageDelta('session', {
      runId: 'run-first',
      messageId: child.id,
      text: 'Child partial',
      thinking: 'Child reasoning',
    });
    expect(store.getSnapshot('session')).toMatchObject({ snapshotSeq: durable, liveRevision: 2 });
    expect(store.getSnapshot('session').messages.at(-1)?.text).toBe('Root partial');
    expect(store.getSnapshot('session').messages.some((message) => message.id === child.id)).toBe(
      false,
    );
    expect(store.getTaskSnapshot('session', 'first').messages.at(-1)).toMatchObject({
      text: 'Child partial',
      thinking: 'Child reasoning',
    });
    expect(store.getAgentTaskDetail('session', 'first', 1, 1)).toMatchObject({
      liveRevision: 2,
      messages: [{ id: child.id, text: 'Child partial' }],
    });
    expect(store.getTaskSnapshot('session', 'second').messages).toHaveLength(1);
    expect(store.getTaskModelContext('session', 'first')).toEqual([codec('Read first')]);
    store.append('session', [event('audit.other-child', {}, 'run-second')]);
    expect(store.getAgentTaskDetail('session', 'first')).toMatchObject({
      snapshotSeq: durable + 1,
      liveRevision: 0,
    });
    expect(store.getTaskSnapshot('session', 'first').messages.at(-1)?.text).toBe('Child partial');
    store.append('session', [
      event(
        'message.completed',
        { message: { ...child, text: 'Child final', status: 'cancelled' } },
        'run-first',
      ),
    ]);
    expect(store.getTaskSnapshot('session', 'first').messages.at(-1)?.text).toBe('Child final');
    expect(store.getSnapshot('session').messages.at(-1)?.text).toBe('Root partial');
  });

  it('keeps child messages, work state and codecs outside the root conversation', async () => {
    const { store } = await fixture();
    spawn(store, 'first');
    spawn(store, 'second');
    store.append('session', [
      event(
        'work.updated',
        {
          taskId: 'first',
          state: {
            ...initialWorkState('main'),
            revision: 1,
            todos: [
              {
                id: 'todo',
                title: 'Only first',
                status: 'pending',
                planStepId: null,
                evidenceToolCallIds: [],
                completionNote: null,
              },
            ],
          },
        },
        'run-first',
      ),
    ]);
    expect(store.getSnapshot('session').session.activeRunId).toBe('root');
    expect(store.getSnapshot('session').messages.map((message) => message.id)).toEqual([
      'root-user',
      'delegate-first',
      'delegate-second',
    ]);
    expect(store.getSnapshot('session').runs.map((value) => value.id)).toEqual(['root']);
    expect(store.getTaskSnapshot('session', 'first').messages.map((message) => message.id)).toEqual(
      ['user-first'],
    );
    expect(store.getTaskModelContext('session', 'first')).toEqual([codec('Read first')]);
    expect(store.getWorkState('session').todos).toEqual([]);
    expect(store.getTaskWorkState('session', 'first').todos[0]?.title).toBe('Only first');
    expect(store.getTaskWorkState('session', 'second').todos).toEqual([]);
    expect(() => store.getTaskModelContext('session', 'first', ['user-second'])).toThrow(
      'Context messages',
    );
    expect(() =>
      store.append('session', [
        event('work.updated', { state: { ...initialWorkState('main'), revision: 1 } }, 'run-first'),
      ]),
    ).toThrow('event run');
  });

  it('derives nested ancestry and refuses parent completion before child settlement', async () => {
    const { store } = await fixture();
    spawn(store, 'first');
    spawn(store, 'nested', 'run-first');
    expect(store.getAgentTask('session', 'nested')).toMatchObject({
      parentTaskId: 'first',
      parentRunId: 'run-first',
      rootRunId: 'root',
    });
    expect(() =>
      store.append('session', [
        event('run.finished', { status: 'completed', finishedAt: 3, error: null }, 'run-first'),
      ]),
    ).toThrow('descendants');
    expect(() =>
      store.append('session', [
        event('task.closed', { taskId: 'first', reason: 'cancelled', closedAt: 3 }),
      ]),
    ).toThrow('resources');
    expect(
      store
        .recoverInterrupted()
        .filter((value) => value.type === 'run.finished')
        .map((value) => value.runId),
    ).toEqual(['run-nested', 'run-first', 'root']);
    expect(store.listAgentTasks('session').every((task) => task.status === 'interrupted')).toBe(
      true,
    );
    expect(store.recoverInterrupted()).toEqual([]);
  });

  it('consumes messages only with their exact target model input and preserves undelivered messages', async () => {
    const { store } = await fixture();
    spawn(store, 'first');
    store.append('session', [
      event(
        'task.message_queued',
        {
          message: {
            id: 'mail',
            sourceRunId: 'root',
            target: { kind: 'task', taskId: 'first' },
            text: 'New facts',
            createdAt: 2,
          },
        },
        'root',
      ),
    ]);
    expect(() =>
      store.append('session', [
        event(
          'task.message_consumed',
          { messageId: 'mail', consumedRunId: 'run-first' },
          'run-first',
        ),
      ]),
    ).toThrow('exact model input');
    store.append('session', [
      event(
        'task.message_consumed',
        { messageId: 'mail', consumedRunId: 'run-first' },
        'run-first',
      ),
      event(
        'message.started',
        { ...user('mail-input', 'run-first', 'New facts'), agentMessageId: 'mail' },
        'run-first',
        codec('New facts'),
      ),
    ]);
    expect(store.listAgentMessages('session', { kind: 'task', taskId: 'first' })[0]?.status).toBe(
      'consumed',
    );
    expect(() =>
      store.append('session', [
        event(
          'task.message_consumed',
          { messageId: 'mail', consumedRunId: 'run-first' },
          'run-first',
        ),
        event(
          'message.started',
          { ...user('duplicate-mail', 'run-first', 'New facts'), agentMessageId: 'mail' },
          'run-first',
          codec('New facts'),
        ),
      ]),
    ).toThrow('active consumer');
    store.append('session', [
      event(
        'task.message_queued',
        {
          message: {
            id: 'pending',
            sourceRunId: 'root',
            target: { kind: 'task', taskId: 'first' },
            text: 'Later',
            createdAt: 2,
          },
        },
        'root',
      ),
    ]);
    store.recoverInterrupted();
    expect(
      store.listAgentMessages('session').find((message) => message.id === 'pending')?.status,
    ).toBe('undelivered');
  });

  it('rebuilds task facts, messages and root isolation solely from the session journal', async () => {
    const value = await fixture();
    spawn(value.store, 'first');
    value.store.recoverInterrupted();
    const expected = value.store.getAgentTaskDetail('session', 'first');
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.getAgentTaskDetail('session', 'first')).toEqual(expected);
    expect(
      value.store.getSnapshot('session').messages.some((message) => message.id === 'user-first'),
    ).toBe(false);
  });

  it('requires an explicit one-to-one communication origin instead of matching user text', async () => {
    const { store } = await fixture();
    spawn(store, 'first');
    store.append('session', [
      event(
        'task.message_queued',
        {
          message: {
            id: 'same-text',
            sourceRunId: 'root',
            target: { kind: 'task', taskId: 'first' },
            text: 'Identical',
            createdAt: 2,
          },
        },
        'root',
      ),
    ]);
    const consumed = event(
      'task.message_consumed',
      { messageId: 'same-text', consumedRunId: 'run-first' },
      'run-first',
    );
    expect(() =>
      store.append('session', [
        consumed,
        event(
          'message.started',
          user('real-user', 'run-first', 'Identical'),
          'run-first',
          codec('Identical'),
        ),
      ]),
    ).toThrow('exact model input');
    const origin = { ...user('origin', 'run-first', 'Identical'), agentMessageId: 'same-text' };
    expect(() =>
      store.append('session', [event('message.started', origin, 'run-first', codec('Identical'))]),
    ).toThrow('matching communication');
    expect(() =>
      store.append('session', [
        consumed,
        event('message.started', origin, 'run-first', codec('Identical')),
        event(
          'message.started',
          { ...origin, id: 'duplicate-origin' },
          'run-first',
          codec('Identical'),
        ),
      ]),
    ).toThrow('exact model input');
    expect(store.listAgentMessages('session')[0]?.status).toBe('queued');
  });

  it('filters task visibility by the retained delegation message rather than the root run', async () => {
    const { store } = await fixture();
    spawn(store, 'first');
    store.append('session', [
      event(
        'message.started',
        user('later-input', 'root', 'Later request'),
        'root',
        codec('Later request'),
      ),
    ]);
    spawn(store, 'second');
    store.recoverInterrupted();
    store.append('session', [
      event('branch.created', {
        id: 'fork',
        sessionId: 'session',
        parentId: 'main',
        forkMessageId: 'later-input',
        createdAt: 4,
      }),
      event('branch.selected', { branchId: 'fork' }),
    ]);
    expect(store.listAgentTasks('session').map((task) => task.id)).toEqual(['first']);
    expect(store.listAgentBoard({}).tasks.map((task) => task.id)).toEqual(['first']);
  });

  it('persists role settings independently and rejects stale revisions and duplicate IDs', async () => {
    const value = await fixture();
    const settings = value.store.getAgentSettings();
    const saved = value.store.putAgentSettings({ ...settings, enabled: false });
    expect(saved.revision).toBe(1);
    expect(() => value.store.putAgentSettings(settings)).toThrow('another client');
    expect(() =>
      value.store.putAgentSettings({
        ...saved,
        roles: [settings.roles[0], settings.roles[0]].filter((role) => role !== undefined),
      }),
    ).toThrow(expect.objectContaining({ code: 'AGENT_SETTINGS_INVALID' }));
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.getAgentSettings()).toEqual(saved);
  });

  it('filters the global board before pagination and pages task messages by their own ordinals', async () => {
    const { store } = await fixture();
    spawn(store, 'active');
    spawn(store, 'ended');
    store.append('session', [
      event('run.finished', { status: 'completed', finishedAt: 3, error: null }, 'run-ended'),
      event('task.closed', { taskId: 'ended', reason: 'completed', closedAt: 3 }),
    ]);
    expect(
      store.listAgentBoard({ filter: 'ended', limit: 1 }).tasks.map((task) => task.id),
    ).toEqual(['ended']);
    expect(
      store.listAgentBoard({ filter: 'active', limit: 1 }).tasks.map((task) => task.id),
    ).toEqual(['active']);
    expect(store.listAgentBoard({ filter: 'pending' }).tasks).toEqual([]);
    store.append('session', [
      event(
        'message.started',
        user('second-child-message', 'run-active', 'Another input'),
        'run-active',
        codec('Another input'),
      ),
    ]);
    const first = store.getAgentTaskDetail('session', 'active', 0, 1);
    expect(first.messages.map((message) => message.id)).toEqual(['user-active']);
    expect(first.nextCursor).toBe(1);
    expect(
      store.getAgentTaskDetail('session', 'active', 1, 1).messages.map((message) => message.id),
    ).toEqual(['second-child-message']);
    expect(store.getAgentTaskDetail('session', 'active', 1, 1).nextCursor).toBeNull();
  });

  it('rejects damaged persisted role semantics independently from user configuration errors', async () => {
    const value = await fixture();
    const saved = value.store.putAgentSettings(value.store.getAgentSettings());
    const role = saved.roles[0];
    if (!role) throw new Error('Default role is required');
    value.store.close();
    const database = new Database(join(value.directory, 'data.sqlite'));
    try {
      database
        .prepare('UPDATE agent_settings SET data = ? WHERE id = 1')
        .run(JSON.stringify({ ...saved, roles: [role, role] }));
    } finally {
      database.close();
    }
    value.store = await openProfileStore(value.directory);
    expect(() => value.store.getAgentSettings()).toThrow(
      expect.objectContaining({ code: 'INVALID_RECORD' }),
    );
  });

  it('keeps AI review running and exposes a later-page user approval from every detail page', async () => {
    const { store } = await fixture('auto');
    spawn(store, 'review', 'root', 'worker');
    store.append(
      'session',
      Array.from({ length: 100 }, (_, index) =>
        event(
          'message.started',
          user(`history-${index}`, 'run-review', `Archived input ${index}`),
          'run-review',
          codec(`Archived input ${index}`),
        ),
      ),
    );
    const callId = 'fetch-review';
    const anchor = 'late-review-assistant';
    const args = { url: 'https://example.com/reference' };
    const tool: ToolCallRecord = {
      id: storedToolCallId('run-review', anchor, callId),
      sessionId: 'session',
      runId: 'run-review',
      branchId: 'main',
      name: 'web_fetch',
      arguments: args,
      binding: { kind: 'accepted', source: { kind: 'session' }, fingerprint: 'a'.repeat(64) },
      dispatch: { state: 'not_applicable' },
      status: 'reviewing',
      summary: 'Review reference access',
      result: null,
      diff: null,
      createdAt: 2,
      updatedAt: 2,
    };
    store.append('session', [
      event(
        'message.started',
        { ...user(anchor, 'run-review', ''), role: 'assistant', stopReason: 'toolUse' },
        'run-review',
        {
          codecVersion: 1,
          sdkVersion: '1.1.0',
          message: {
            role: 'assistant',
            content: [{ type: 'toolCall', id: callId, name: 'web_fetch', arguments: args }],
          },
        },
      ),
      event('tool.requested', { tool }, 'run-review'),
    ]);
    expect(store.getAgentTask('session', 'review')).toMatchObject({
      status: 'running',
      waiting: null,
    });
    expect(store.listAgentBoard({ filter: 'pending' }).tasks).toEqual([]);
    expect(store.listAgentBoard({ filter: 'active' }).tasks.map((task) => task.id)).toEqual([
      'review',
    ]);
    const duringReview = store.getAgentTaskDetail('session', 'review', 0, 100);
    expect(duringReview.messages.some((message) => message.id === anchor)).toBe(false);
    expect(duringReview.tools.map((entry) => entry.id)).toEqual([tool.id]);
    store.append('session', [
      event(
        'tool.updated',
        { tool: { ...tool, status: 'awaiting_approval', updatedAt: 3 } },
        'run-review',
      ),
    ]);
    expect(store.getAgentTask('session', 'review')).toMatchObject({
      status: 'waiting',
      waiting: 'approval',
    });
    expect(
      store.listAgentBoard({ filter: 'pending', limit: 1 }).tasks.map((task) => task.id),
    ).toEqual(['review']);
    const first = store.getAgentTaskDetail('session', 'review', 0, 100);
    expect(first.nextCursor).toBe(100);
    expect(first.messages.some((message) => message.id === anchor)).toBe(false);
    expect(first.tools).toHaveLength(1);
    expect(first.tools[0]?.status).toBe('awaiting_approval');
    const last = store.getAgentTaskDetail('session', 'review', 100, 100);
    expect(last.messages.some((message) => message.id === anchor)).toBe(true);
    expect(last.tools.map((entry) => entry.id)).toEqual([tool.id]);
  });

  it('rejects forged sources and simultaneous runs on one task without changing the root cursor', async () => {
    const { store } = await fixture();
    const task = spawn(store, 'first');
    const cursor = store.getSnapshot('session').snapshotSeq;
    expect(() =>
      store.append('session', [
        event(
          'task.created',
          { task: { ...task, id: 'forged', sourceToolCallId: 'missing' } },
          'root',
        ),
      ]),
    ).toThrow('delegation');
    expect(() =>
      store.append('session', [
        event(
          'run.accepted',
          { run: run('duplicate', 'first'), requestId: 'duplicate' },
          'duplicate',
        ),
      ]),
    ).toThrow('active run');
    expect(store.getSnapshot('session').snapshotSeq).toBe(cursor);
  });
});
