import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  BranchView,
  FrozenMcpToolData,
  MessageView,
  ProviderConfig,
  QueueInput,
  RunView,
} from '@my-pi-harness/protocol';
import { openProfileStore, type EventInput, type ProfileStore } from '../src/index.js';

const fixtures: { directory: string; store: ProfileStore }[] = [];
const provider: ProviderConfig = {
  id: 'provider',
  name: 'Local fixture',
  kind: 'custom',
  builtinId: null,
  api: 'openai-completions',
  baseUrl: 'http://127.0.0.1:1',
  models: [
    {
      id: 'model',
      name: 'Fixture model',
      api: 'openai-completions',
      contextWindow: 4096,
      maxTokens: 512,
      reasoning: false,
      input: ['text'],
    },
  ],
  credentialRef: 'credential-fixture',
  enabled: true,
  requiresApiKey: true,
  legacy: false,
  configured: false,
  authSource: null,
  credentialPreview: null,
  revision: 1,
  hasCredential: true,
  credentialType: 'api_key',
};

async function fixture(): Promise<{ directory: string; store: ProfileStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-store-'));
  const store = await openProfileStore(directory);
  const value = { directory, store };
  fixtures.push(value);
  store.putProvider(provider);
  store.createSession({
    id: 'session',
    branchId: 'main',
    title: 'Fixture',
    providerId: provider.id,
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
  runId: string | null,
  data: Record<string, unknown>,
  privateData?: Record<string, unknown>,
): EventInput {
  return { type, runId, at: 2, data, ...(privateData === undefined ? {} : { privateData }) };
}

function run(id = 'run', branchId = 'main'): RunView {
  return {
    id,
    sessionId: 'session',
    branchId,
    providerId: provider.id,
    modelId: 'model',
    status: 'running',
    createdAt: 2,
    finishedAt: null,
    error: null,
  };
}

function user(id = 'user', runId = 'run', branchId = 'main', text = 'Question'): MessageView {
  return {
    id,
    sessionId: 'session',
    branchId,
    runId,
    role: 'user',
    text,
    thinking: '',
    createdAt: 2,
    status: 'complete',
    stopReason: null,
  };
}

function assistant(): MessageView {
  return { ...user('assistant'), role: 'assistant', text: '', status: 'streaming' };
}

function accept(store: ProfileStore, id = 'run', branchId = 'main'): void {
  store.append('session', [
    event(
      'run.accepted',
      id,
      { run: run(id, branchId), requestId: `request-${id}` },
      { marker: 'private frozen model' },
    ),
    event('message.started', id, user(`user-${id}`, id, branchId), { marker: `user-codec-${id}` }),
  ]);
}

function finish(store: ProfileStore, id = 'run'): void {
  store.append('session', [
    event('run.finished', id, { status: 'completed', finishedAt: 3, error: null }),
  ]);
}

function queueMetadata(requestId: string): Record<string, unknown> {
  return {
    version: 1,
    requestId,
    mcpBindings: [],
    candidateBindings: [],
    skillBindings: [],
    mentionedSkillBindings: [],
    inheritedSkillBindings: [],
    discoveryDiagnostics: [],
  };
}

afterEach(async () => {
  for (const value of fixtures.splice(0)) {
    value.store.close();
    await rm(value.directory, { recursive: true, force: true });
  }
});

describe('SQLite event and projection transactions', () => {
  it('commits ordered facts and projections together without exposing private codecs', async () => {
    const { store } = await fixture();
    accept(store);
    store.append('session', [event('message.started', 'run', assistant())]);
    store.publishMessageDelta('session', {
      runId: 'run',
      messageId: 'assistant',
      text: 'Answer',
      thinking: 'Reason',
    });
    const complete: MessageView = {
      ...assistant(),
      text: 'Answer',
      thinking: 'Reason',
      status: 'complete',
      stopReason: 'stop',
    };
    store.append('session', [
      event('message.completed', 'run', { message: complete }, { marker: 'assistant-codec' }),
      event('run.finished', 'run', { status: 'completed', finishedAt: 3, error: null }),
    ]);
    const snapshot = store.getSnapshot('session');
    expect(snapshot.session.activeRunId).toBeNull();
    expect(snapshot.messages.map((message) => message.text)).toEqual(['Question', 'Answer']);
    expect(snapshot.snapshotSeq).toBe(6);
    const events = store.readEvents('session');
    expect(events.map((value) => value.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(JSON.stringify(events)).not.toContain('private frozen model');
    expect(JSON.stringify(snapshot)).not.toContain('assistant-codec');
    expect(store.getModelContext('session', 'main')).toEqual([
      { marker: 'user-codec-run' },
      { marker: 'assistant-codec' },
    ]);
  });

  it('rolls back every accepted input when a later event in the command fails', async () => {
    const { store } = await fixture();
    expect(() =>
      store.append('session', [
        event('run.accepted', 'run', { run: run(), requestId: 'failed-command' }),
        event('message.started', 'run', { ...user(), branchId: 'foreign' }),
      ]),
    ).toThrow();
    expect(store.getSnapshot('session')).toMatchObject({ snapshotSeq: 1, messages: [], runs: [] });
    expect(store.findRequest('session', 'failed-command')).toBeUndefined();
    expect(store.readEvents('session')).toHaveLength(1);
  });

  it('accepts a repeated request once and prevents two active runs in one session', async () => {
    const { store } = await fixture();
    const inputs = [
      event('run.accepted', 'run', { run: run(), requestId: 'repeat' }),
      event('message.started', 'run', user(), { marker: 'user-codec' }),
    ];
    expect(store.append('session', inputs)).toHaveLength(2);
    expect(store.append('session', inputs)).toEqual([]);
    expect(store.findRequest('session', 'repeat')).toEqual({ runId: 'run', inputId: null });
    expect(() => accept(store, 'second')).toThrow('active run');
    expect(store.getSnapshot('session').snapshotSeq).toBe(3);
    finish(store);
    expect(
      store.append('session', [
        event('run.finished', 'run', { status: 'completed', finishedAt: 99, error: null }),
      ]),
    ).toEqual([]);
    expect(store.getSnapshot('session').runs[0]?.finishedAt).toBe(3);
  });

  it('does not rewrite terminal messages or mutate previously committed SDK payloads', async () => {
    const { store } = await fixture();
    const message = user();
    store.append('session', [
      event('run.accepted', 'run', { run: run(), requestId: 'immutable' }),
      event('message.started', 'run', message, { marker: 'user-codec' }),
    ]);
    message.text = 'Caller mutation';
    expect(store.getSnapshot('session').messages[0]?.text).toBe('Question');
    expect(() => store.append('session', [event('message.completed', 'run', { message })])).toThrow(
      'cannot be rewritten',
    );
    expect(store.getSnapshot('session').snapshotSeq).toBe(3);
  });

  it('fails on invalid JSON instead of silently dropping event fields', async () => {
    const { store } = await fixture();
    expect(() =>
      store.append('session', [event('audit.record', null, { invalid: undefined })]),
    ).toThrow('JSON');
    expect(() =>
      store.append('session', [event('audit.record', null, { invalid: Number.NaN })]),
    ).toThrow('JSON');
    expect(store.getSnapshot('session').snapshotSeq).toBe(1);
  });

  it('persists the event format version and refuses an unknown durable version', async () => {
    const { directory, store } = await fixture();
    accept(store);
    expect(store.readEvents('session').every(({ version }) => version === 1)).toBe(true);
    const connection = new Database(join(directory, 'data.sqlite'));
    try {
      expect(connection.prepare('SELECT DISTINCT version FROM events').all()).toEqual([
        { version: 1 },
      ]);
      const insert = connection.prepare(
        "INSERT INTO events (event_id, version, session_id, seq, run_id, type, at, data) VALUES ('unknown-version', 2, 'session', 99, NULL, 'audit.future', 5, '{}')",
      );
      expect(() => insert.run()).toThrow('CHECK constraint');
      // Deliberately damage durable input to exercise the reader, beyond the SQL writer guard.
      connection.pragma('ignore_check_constraints = ON');
      insert.run();
      expect(() => store.readEvents('session')).toThrow('failed validation');
    } finally {
      connection.close();
    }
  });

  it('refuses missing codecs for committed replayable messages instead of shortening context', async () => {
    const { store } = await fixture();
    store.append('session', [
      event('run.accepted', 'run', { run: run(), requestId: 'missing-codec' }),
      event('message.started', 'run', user()),
    ]);
    expect(() => store.getModelContext('session', 'main')).toThrow('missing its provider codec');
  });

  it('interrupts a surviving active run after reopen and retains durable messages and pending queue', async () => {
    const value = await fixture();
    accept(value.store);
    value.store.append('session', [
      event('message.started', 'run', assistant()),
      event('queue.added', 'run', queued(), queueMetadata('queued')),
    ]);
    value.store.publishMessageDelta('session', {
      runId: 'run',
      messageId: 'assistant',
      text: 'Partial',
    });
    expect(value.store.getSnapshot('session').messages[1]?.text).toBe('Partial');
    value.store.close();
    value.store = await openProfileStore(value.directory);
    const snapshot = value.store.getSnapshot('session');
    expect(snapshot.session.activeRunId).toBeNull();
    expect(snapshot.runs[0]?.status).toBe('interrupted');
    expect(snapshot.messages[1]).toMatchObject({ text: '', status: 'interrupted' });
    expect(snapshot.messages[1]?.finishedAt).toBe(snapshot.runs[0]?.finishedAt);
    expect(snapshot.messages[1]).not.toHaveProperty('usage');
    expect(snapshot.queue).toHaveLength(1);
    expect(value.store.recoverInterrupted()).toEqual([]);
    expect(value.store.getModelContext('session', 'main')).toEqual([{ marker: 'user-codec-run' }]);
  });
});

function queued(): QueueInput {
  return {
    id: 'queue',
    sessionId: 'session',
    text: 'Later',
    mode: 'follow-up',
    providerId: provider.id,
    modelId: 'model',
    createdAt: 2,
    updatedAt: 2,
    revision: 1,
  };
}

describe('persistent queue and revision branches', () => {
  it('updates, consumes and deletes inputs without losing original request acceptances', async () => {
    const { store } = await fixture();
    const input = queued();
    accept(store, 'original-run');
    store.append('session', [
      event('queue.added', 'original-run', input, queueMetadata('original')),
    ]);
    finish(store, 'original-run');
    store.append('session', [
      event('queue.updated', null, { ...input, text: 'Edited', updatedAt: 3, revision: 2 }),
    ]);
    expect(() =>
      store.append('session', [
        event('queue.updated', null, { ...input, text: 'Stale', revision: 2 }),
      ]),
    ).toThrow('modified');
    store.append('session', [
      event('run.accepted', 'run', { run: run(), requestId: 'queue:queue' }),
      event('queue.consumed', 'run', { inputId: input.id }),
      event('message.started', 'run', user('from-queue', 'run', 'main', 'Edited'), {
        marker: 'codec',
      }),
    ]);
    expect(store.getSnapshot('session').queue).toEqual([]);
    expect(store.findRequest('session', 'original')).toEqual({ runId: null, inputId: 'queue' });
    expect(store.findRequest('session', 'queue:queue')).toEqual({ runId: 'run', inputId: null });
    const second = { ...input, id: 'queue-second' };
    store.append('session', [
      event('queue.added', 'run', second, queueMetadata('removed')),
      event('queue.deleted', 'run', { inputId: second.id }),
    ]);
    expect(store.findRequest('session', 'removed')).toEqual({ runId: null, inputId: second.id });
  });

  it('consumes steer within its existing run without creating another run', async () => {
    const { store } = await fixture();
    accept(store);
    const input = { ...queued(), mode: 'steer' as const };
    store.append('session', [event('queue.added', 'run', input, queueMetadata('steer'))]);
    store.append('session', [
      event('queue.consumed', 'run', { inputId: input.id }),
      event('message.started', 'run', user('steered', 'run', 'main', 'Later'), {
        marker: 'steer-codec',
      }),
    ]);
    expect(store.getSnapshot('session').runs).toHaveLength(1);
    expect(store.getModelContext('session', 'main')).toEqual([
      { marker: 'user-codec-run' },
      { marker: 'steer-codec' },
    ]);
  });

  it('retains the accepting branch after queue revision, branch selection and restart', async () => {
    const value = await fixture();
    const { store } = value;
    accept(store);
    const input = queued();
    store.append('session', [event('queue.added', 'run', input, queueMetadata('provenance'))]);
    finish(store);
    store.append('session', [
      event('queue.updated', null, { ...input, text: 'Revised', revision: 2, updatedAt: 3 }),
      event('branch.created', null, {
        id: 'revision',
        sessionId: 'session',
        parentId: 'main',
        forkMessageId: 'user-run',
        createdAt: 3,
      }),
      event('branch.selected', null, { branchId: 'revision' }),
    ]);
    expect(store.getQueueBranch('session', input.id)).toBe('main');
    expect(store.getSnapshot('session').session.activeBranchId).toBe('revision');
    store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.getQueueBranch('session', input.id)).toBe('main');
    value.store.append('session', [event('queue.deleted', null, { inputId: input.id })]);
    expect(() => value.store.getQueueBranch('session', input.id)).toThrow('no longer exists');
  });

  it('refuses queued acceptance without the active run provenance', async () => {
    const { store } = await fixture();
    expect(() =>
      store.append('session', [
        event('queue.added', null, queued(), queueMetadata('invalid-origin')),
      ]),
    ).toThrow('requires a run ID');
    expect(store.getSnapshot('session').queue).toEqual([]);
    expect(store.findRequest('session', 'invalid-origin')).toBeUndefined();
  });

  it('keeps a queued input when consumption omits the corresponding committed message', async () => {
    const { store } = await fixture();
    accept(store);
    const input = queued();
    store.append('session', [
      event('queue.added', 'run', input, queueMetadata('must-commit-message')),
    ]);
    expect(() =>
      store.append('session', [event('queue.consumed', 'run', { inputId: input.id })]),
    ).toThrow('atomically');
    expect(store.getSnapshot('session').queue).toHaveLength(1);
  });

  it('forks before the edited user input and retains the complete original branch', async () => {
    const { store } = await fixture();
    accept(store);
    finish(store);
    accept(store, 'second');
    finish(store, 'second');
    const branch: BranchView = {
      id: 'revision',
      sessionId: 'session',
      parentId: 'main',
      forkMessageId: 'user-second',
      createdAt: 4,
    };
    store.append('session', [
      event('branch.created', null, branch),
      event('branch.selected', null, { branchId: branch.id }),
      event('run.accepted', 'edited', { run: run('edited', branch.id), requestId: 'edit' }),
      event('message.started', 'edited', user('edited-user', 'edited', branch.id, 'Replacement'), {
        marker: 'replacement-codec',
      }),
    ]);
    expect(store.getSnapshot('session').messages.map((message) => message.text)).toEqual([
      'Question',
      'Replacement',
    ]);
    expect(store.getModelContext('session', 'revision')).toEqual([
      { marker: 'user-codec-run' },
      { marker: 'replacement-codec' },
    ]);
    expect(store.getModelContext('session', 'main')).toEqual([
      { marker: 'user-codec-run' },
      { marker: 'user-codec-second' },
    ]);
    finish(store, 'edited');
    store.append('session', [event('branch.selected', null, { branchId: 'main' })]);
    expect(store.getSnapshot('session').messages.map((message) => message.id)).toEqual([
      'user-run',
      'user-second',
    ]);
  });
});

describe('provider metadata and migrations', () => {
  it('keeps credential flags out of facts and rejects stale configuration revisions', async () => {
    const { directory, store } = await fixture();
    expect(store.getProvider(provider.id)).toMatchObject({
      hasCredential: false,
      credentialType: null,
    });
    store.putProvider({ ...provider, name: 'Updated', revision: 2 }, 1);
    expect(() => store.putProvider({ ...provider, revision: 2 }, 1)).toThrow('revision');
    const connection = new Database(join(directory, 'data.sqlite'));
    try {
      expect(
        connection.prepare('SELECT revision FROM provider_versions ORDER BY revision').all(),
      ).toEqual([{ revision: 1 }, { revision: 2 }]);
    } finally {
      connection.close();
    }
  });

  it.each(['newer', 'modified'])(
    'rejects a %s migration without losing the profile lock on failure',
    async (kind) => {
      const value = await fixture();
      value.store.close();
      const connection = new Database(join(value.directory, 'data.sqlite'));
      if (kind === 'newer') connection.pragma('user_version = 99');
      else connection.prepare('UPDATE schema_migrations SET checksum = ?').run('modified');
      connection.close();
      await expect(openProfileStore(value.directory)).rejects.toThrow(/version|migration/);
      const lock = await import('../src/profile/profile-lock.js');
      const acquired = await lock.acquireProfileLock(value.directory);
      acquired.release();
    },
  );
});

describe('session archive facts', () => {
  it('hides archived sessions while retaining their immutable events and pending input', async () => {
    const { directory, store } = await fixture();
    accept(store);
    store.append('session', [
      event('queue.added', 'run', queued(), queueMetadata('archive-queue')),
    ]);
    finish(store);
    store.append('session', [event('session.deleted', null, {})]);
    expect(store.listSessions()).toEqual([]);
    expect(store.getSession('session')).toBeUndefined();
    expect(() => store.getSnapshot('session')).toThrow('archived');
    expect(store.append('session', [event('session.deleted', null, {})])).toEqual([]);
    expect(() => store.append('session', [event('audit.record', null, {})])).toThrow('archived');
    expect(store.readEvents('session').at(-1)?.type).toBe('session.deleted');
    const connection = new Database(join(directory, 'data.sqlite'));
    try {
      expect(connection.prepare('SELECT count(*) AS count FROM queued_inputs').get()).toEqual({
        count: 1,
      });
    } finally {
      connection.close();
    }
  });

  it('refuses an archive while a run is still owned by the session', async () => {
    const { store } = await fixture();
    accept(store);
    expect(() => store.append('session', [event('session.deleted', null, {})])).toThrow(
      'active run',
    );
    expect(store.getSession('session')?.activeRunId).toBe('run');
  });
});

describe('frozen queued MCP authority', () => {
  it('rejects incomplete or string-encoded bindings before accepting a queued input', async () => {
    const { store } = await fixture();
    accept(store);
    for (const metadata of [
      { version: 1, requestId: 'invalid-queue' },
      { ...queueMetadata('invalid-queue'), mcpBindings: '[]' },
    ]) {
      expect(() =>
        store.append('session', [event('queue.added', 'run', queued(), metadata)]),
      ).toThrow(expect.objectContaining({ code: 'INVALID_RECORD' }));
    }
    expect(store.getSnapshot('session').queue).toEqual([]);
    expect(store.findRequest('session', 'invalid-queue')).toBeUndefined();
  });

  it('retains private bindings through edits and projection rebuild without exposing them publicly', async () => {
    const value = await fixture();
    value.store.append('session', [
      event('run.accepted', 'run', { requestId: 'root', run: run() }),
    ]);
    const input = queued();
    const binding: FrozenMcpToolData = {
      selection: {
        serverId: 'server',
        serverRevision: 1,
        remoteToolName: 'read',
        definitionFingerprint: 'a'.repeat(64),
      },
      definition: { name: 'read', description: 'Read', parameters: {} },
      authorization: {
        ownerId: 'owner',
        identityEpoch: 1,
        accessEpoch: 1,
        credentialEpoch: 1,
        grantId: 'frozen-authority',
        workspaceId: 'workspace',
        workspaceRoot: '/fixture',
        scope: 'sandboxed',
        startupFingerprint: 'b'.repeat(64),
      },
    };
    const first = { ...queueMetadata('mcp-queue'), mcpBindings: [binding] };
    value.store.append('session', [event('queue.added', 'run', input, first)]);
    expect(value.store.getQueuePrivateData('session', input.id)).toEqual(first);
    const next = queueMetadata('mcp-queue');
    value.store.append('session', [
      event('queue.updated', 'run', { ...input, text: 'Edited', revision: 2 }, next),
    ]);
    expect(value.store.getQueuePrivateData('session', input.id)).toEqual(next);
    expect(JSON.stringify(value.store.getSnapshot('session'))).not.toContain('frozen-authority');
    expect(() =>
      value.store.append('session', [
        event('queue.updated', 'run', { ...input, revision: 3 }, queueMetadata('replacement')),
      ]),
    ).toThrow('acceptance identity');
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.getQueuePrivateData('session', input.id)).toEqual(next);
    expect(value.store.getSnapshot('session').queue[0]?.text).toBe('Edited');
  });
});
