import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryService } from '@my-pi-harness/memory';
import {
  SearchSourceWindowSchema,
  SearchSourceReadInputSchema,
  type MessageView,
  type SearchSourceSelection,
  type SearchScope,
} from '@my-pi-harness/protocol';
import type { SearchAccess } from '@my-pi-harness/protocol/internal';
import { Value } from 'typebox/value';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openProfileStore, type ProfileStore } from '../src/index';
import { createAgentSession, spawn, agentSettingsFixture } from './fixtures/agent-session';

interface Fixture {
  directory: string;
  store: ProfileStore;
  owner: string;
}
const fixtures: Fixture[] = [];
afterEach(async () => {
  for (const value of fixtures.splice(0)) {
    value.store.close();
    await rm(value.directory, { recursive: true, force: true });
  }
});

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
function authenticate(store: ProfileStore): string {
  store.auth.createLocalClient({
    id: 'client',
    tokenHash: hash('window-client'),
    csrfToken: 'csrf',
    createdAt: 1,
    expiresAt: 100,
  });
  return store.auth.completeLogin(
    {
      providerId: 'github',
      issuer: 'https://github.com',
      subject: 'window-owner',
      name: 'Window',
      avatarUrl: null,
    },
    'client',
    { id: 'login', tokenHash: hash('window-login'), createdAt: 2, expiresAt: 99 },
  ).user.id;
}
async function fixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-source-window-'));
  const store = await openProfileStore(directory);
  const value = { directory, store, owner: authenticate(store) };
  fixtures.push(value);
  session(value, 'session', 'main');
  return value;
}
function session(value: Fixture, id: string, branchId: string): void {
  value.store.createSession({
    id,
    branchId,
    title: id,
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: null,
    approvalMode: 'ask',
    at: 1,
  });
}
function message(
  value: Fixture,
  id: string,
  text: string,
  options: {
    sessionId?: string;
    branchId?: string;
    createdAt?: number;
    status?: MessageView['status'];
    runId?: string;
    role?: MessageView['role'];
  } = {},
): SearchSourceSelection {
  const sessionId = options.sessionId ?? 'session';
  const branchId = options.branchId ?? 'main';
  const data: MessageView = {
    id,
    sessionId,
    branchId,
    runId: options.runId ?? null,
    role: options.role ?? 'user',
    text,
    thinking: 'PRIVATE_THINKING_MUST_NOT_REACH_READER',
    createdAt: options.createdAt ?? 2,
    status: options.status ?? 'complete',
    stopReason: null,
  };
  value.store.append(sessionId, [
    {
      type: 'message.started',
      runId: data.runId,
      at: 2,
      data,
      privateData: { forbidden: 'PRIVATE_CODEC_MUST_NOT_REACH_READER' },
    },
  ]);
  return {
    source: { id: `message:${id}`, kind: 'message', contentHash: hash(text) },
    target: { kind: 'message', sessionId, branchId, messageId: id },
    start: 0,
    end: Math.min(text.length, 8000),
  };
}
function access(value: Fixture, scope: SearchScope = {}): SearchAccess {
  return { ownerUserId: value.owner, scope: { workspaceId: null, kind: 'message', ...scope } };
}
function finishBranch(value: Fixture): void {
  value.store.append('session', [
    {
      type: 'branch.created',
      runId: null,
      at: 3,
      data: {
        id: 'revision',
        sessionId: 'session',
        parentId: 'main',
        forkMessageId: 'fork',
        createdAt: 3,
      },
    },
    { type: 'branch.selected', runId: null, at: 3, data: { branchId: 'revision' } },
  ]);
}

describe('read-only exact source windows', () => {
  it('starts at the exact target and pages finite neighboring messages without snapshots or branch writes', async () => {
    const value = await fixture();
    let selected: SearchSourceSelection | undefined;
    for (let i = 0; i < 40; i++) {
      const current = message(value, `m-${i}`, `Persistent message ${i}`);
      if (i === 25) selected = current;
    }
    if (!selected) throw new Error('Missing target');
    const before = value.store.getSession('session');
    const events = value.store.readEvents('session');
    const snapshot = vi.spyOn(value.store, 'getSnapshot').mockImplementation(() => {
      throw new Error('Full snapshot is forbidden for source reads');
    });
    const result = value.store.search.sourceWindow(access(value), {
      selection: selected,
      before: 2,
      after: 2,
    });
    expect(
      result?.items.map((item) => (item.target.kind === 'message' ? item.target.messageId : null)),
    ).toEqual(['m-23', 'm-24', 'm-25', 'm-26', 'm-27']);
    expect(result?.previous).toEqual({ direction: 'before', messageId: 'm-23' });
    expect(result?.next).toEqual({ direction: 'after', messageId: 'm-27' });
    expect(Value.Check(SearchSourceWindowSchema, result)).toBe(true);
    if (!result?.previous || !result.next) throw new Error('Expected bounded cursors');
    const previous = value.store.search.sourceWindow(access(value), {
      selection: selected,
      cursor: result.previous,
    });
    expect(previous?.items.map((item) => item.text)).toEqual(
      Array.from({ length: 5 }, (_, i) => `Persistent message ${18 + i}`),
    );
    const next = value.store.search.sourceWindow(access(value), {
      selection: selected,
      cursor: result.next,
    });
    expect(next?.items.map((item) => item.text)).toEqual(
      Array.from({ length: 5 }, (_, i) => `Persistent message ${28 + i}`),
    );
    expect(value.store.getSession('session')).toEqual(before);
    expect(value.store.readEvents('session')).toEqual(events);
    expect(snapshot).not.toHaveBeenCalled();
    snapshot.mockRestore();
  });

  it('returns only bounded persistent plain text near a large-message hit and exact quotes never include context', async () => {
    const value = await fixture();
    message(value, 'before', 'Before');
    const text = 'x'.repeat(1_000_000) + 'TARGET😀' + 'z'.repeat(900_000);
    const selected = { ...message(value, 'large', text), start: 1_000_000, end: 1_000_008 };
    message(value, 'after', 'After');
    value.store.append('session', [
      {
        type: 'run.accepted',
        runId: 'live-run',
        at: 3,
        data: {
          requestId: 'live-request',
          run: {
            id: 'live-run',
            sessionId: 'session',
            branchId: 'main',
            providerId: 'provider',
            modelId: 'model',
            status: 'running',
            createdAt: 3,
            finishedAt: null,
            error: null,
          },
        },
      },
    ]);
    const live = message(value, 'live', 'LIVE_MUST_NOT_REACH_READER', {
      status: 'streaming',
      runId: 'live-run',
      role: 'assistant',
    });
    value.store.publishMessageDelta('session', {
      runId: 'live-run',
      messageId: 'live',
      text: 'NO_LIVE_DELTA',
      thinking: 'NO_LIVE_THINKING',
    });
    expect(value.store.search.readSelection(access(value), live)).toBeNull();
    const exact = value.store.search.readSelection(access(value), selected);
    expect(exact).toMatchObject({
      start: 1_000_000,
      end: 1_000_008,
      text: 'TARGET😀',
      totalLength: text.length,
    });
    const result = value.store.search.sourceWindow(access(value), { selection: selected });
    expect(result?.items).toHaveLength(3);
    expect(result?.items.find((item) => item.source.id === 'message:large')?.text).toContain(
      'TARGET😀',
    );
    expect(result?.items.every((item) => item.text.length <= 8000)).toBe(true);
    const rendered = JSON.stringify(result);
    for (const forbidden of ['PRIVATE_THINKING', 'PRIVATE_CODEC', 'NO_LIVE', 'LIVE_MUST'])
      expect(rendered).not.toContain(forbidden);
    expect(Value.Check(SearchSourceWindowSchema, result)).toBe(true);
  });

  it('aligns text page offsets on actual Unicode boundaries while preserving the original selection', async () => {
    const value = await fixture();
    const text = 'a'.repeat(7999) + '😀' + 'b'.repeat(7998) + '🪐' + 'tail';
    const selection = { ...message(value, 'astral', text), start: 0, end: 16 };
    const page = value.store.search.sourceWindow(access(value), { selection, textOffset: 8000 });
    expect(page?.selection).toEqual(selection);
    expect(page?.items).toHaveLength(1);
    const excerpt = page?.items[0];
    if (!excerpt) throw new Error('Expected text page');
    expect(excerpt).toMatchObject({ start: 7999, end: 15999, text: '😀' + 'b'.repeat(7998) });
    expect(
      value.store.search.readSelection(access(value), {
        source: excerpt.source,
        target: excerpt.target,
        start: excerpt.start,
        end: excerpt.end,
      })?.text,
    ).toBe(excerpt.text);
    const next = value.store.search.sourceWindow(access(value), { selection, textOffset: 16000 });
    expect(next?.items[0]).toMatchObject({ start: 15999, text: '🪐tail' });
    expect(Value.Check(SearchSourceWindowSchema, next)).toBe(true);
    expect(
      value.store.search.sourceWindow(access(value), { selection, textOffset: text.length + 1 }),
    ).toBeNull();
    const mixed = {
      selection,
      textOffset: 0,
      cursor: { direction: 'after' as const, messageId: 'astral' },
    };
    expect(Value.Check(SearchSourceReadInputSchema, mixed)).toBe(false);
    expect(value.store.search.sourceWindow(access(value), mixed)).toBeNull();
  });

  it('rejects mismatched IDs, hashes, target membership, owner and invalid UTF-16 ranges', async () => {
    const value = await fixture();
    const first = message(value, 'one', 'Same 😀 text');
    const second = message(value, 'two', 'Same 😀 text');
    expect(
      value.store.search.readSelection(access(value), { ...first, target: second.target }),
    ).toBeNull();
    expect(
      value.store.search.readSelection(access(value), {
        ...first,
        source: { ...first.source, contentHash: '0'.repeat(64) },
      }),
    ).toBeNull();
    expect(
      value.store.search.readSelection(access(value), {
        ...first,
        target: { kind: 'memory', memoryId: 'one' },
      }),
    ).toBeNull();
    for (const range of [
      { start: 0, end: 0 },
      { start: 0, end: 999 },
      { start: 5, end: 6 },
      { start: 6, end: 7 },
      { start: -1, end: 3 },
    ])
      expect(value.store.search.readSelection(access(value), { ...first, ...range })).toBeNull();
    expect(
      value.store.search.readSelection(access(value), { ...first, start: 5, end: 7 })?.text,
    ).toBe('😀');
    expect(() =>
      value.store.search.readSelection({ ...access(value), ownerUserId: 'foreign-owner' }, first),
    ).toThrow('profile owner');
    expect(
      value.store.search.readSelection(access(value, { workspaceId: 'foreign' }), first),
    ).toBeNull();
    expect(
      value.store.search.sourceWindow(access(value), {
        selection: first,
        cursor: { direction: 'after', messageId: 'missing' },
      }),
    ).toBeNull();
  });

  it('reads enabled current memory ranges without giving old hashes access after edits, disable or forgetting', async () => {
    const value = await fixture();
    const memory = new MemoryService(value.store.memory);
    const fact = memory.create(value.owner, {
      requestId: 'memory',
      scope: { kind: 'user' },
      category: 'fact',
      body: 'Only the chosen memory range',
      mode: 'relevant',
      enabled: true,
    }).entry;
    if (!fact) throw new Error('Memory missing');
    const selected: SearchSourceSelection = {
      source: { id: `memory:${fact.id}`, kind: 'memory', contentHash: hash(fact.body) },
      target: { kind: 'memory', memoryId: fact.id },
      start: 9,
      end: 15,
    };
    const legal = { ownerUserId: value.owner, scope: { workspaceId: null } };
    expect(value.store.search.readSelection(legal, selected)?.text).toBe('chosen');
    expect(value.store.search.sourceWindow(legal, { selection: selected })?.items).toHaveLength(1);
    memory.update(value.owner, fact.id, {
      requestId: 'edit',
      expectedRevision: 1,
      category: 'fact',
      body: 'New memory body',
      mode: 'relevant',
      enabled: true,
    });
    expect(value.store.search.readSelection(legal, selected)).toBeNull();
    const changed = {
      ...selected,
      source: { ...selected.source, contentHash: hash('New memory body') },
      start: 0,
      end: 3,
    };
    expect(value.store.search.readSelection(legal, changed)?.text).toBe('New');
    memory.update(value.owner, fact.id, {
      requestId: 'disable',
      expectedRevision: 2,
      category: 'fact',
      body: 'New memory body',
      mode: 'relevant',
      enabled: false,
    });
    expect(value.store.search.readSelection(legal, changed)).toBeNull();
    memory.forget(value.owner, fact.id, { requestId: 'forget', expectedRevision: 3 });
    expect(value.store.search.readSelection(legal, changed)).toBeNull();
  });

  it('opens historical branches and archived sources only under explicit read scope and never selects them', async () => {
    const value = await fixture();
    const prefix = message(value, 'prefix', 'Shared prefix');
    message(value, 'fork', 'Editable question');
    const old = message(value, 'old', 'Historical suffix');
    finishBranch(value);
    const state = value.store.getSession('session');
    expect(state?.activeBranchId).toBe('revision');
    expect(value.store.search.sourceWindow(access(value), { selection: old })).toBeNull();
    const historical = access(value, { includeHistoricalBranches: true });
    expect(value.store.search.sourceWindow(historical, { selection: old })?.historicalBranch).toBe(
      true,
    );
    expect(value.store.search.readSelection(historical, prefix)?.text).toBe('Shared prefix');
    expect(
      value.store.search.readSelection(
        access(value, { includeHistoricalBranches: true, branchId: 'revision' }),
        old,
      ),
    ).toBeNull();
    expect(value.store.getSession('session')).toEqual(state);
    value.store.append('session', [{ type: 'session.deleted', runId: null, at: 4, data: {} }]);
    expect(value.store.search.readSelection(historical, old)).toBeNull();
    const archived = value.store.search.sourceWindow(
      access(value, { includeHistoricalBranches: true, includeArchived: true }),
      { selection: old },
    );
    expect(archived).toMatchObject({ archived: true, historicalBranch: true });
    expect(value.store.getSession('session')).toBeUndefined();
    expect(value.store.listSessions()).toEqual([]);
  });

  it('reads one historical Task context through its retained root anchor without root or sibling messages', async () => {
    const created = await createAgentSession();
    const value = { ...created, owner: authenticate(created.store) };
    fixtures.push(value);
    spawn(value.store, 'child');
    spawn(value.store, 'sibling');
    const selected = message(value, 'child-answer', 'Exact child answer', {
      runId: 'run-child',
      role: 'assistant',
    });
    selected.target = {
      kind: 'message',
      sessionId: 'session',
      branchId: 'main',
      messageId: 'child-answer',
      taskId: 'child',
    };
    message(value, 'sibling-answer', 'SIBLING_MUST_NOT_LEAK', {
      runId: 'run-sibling',
      role: 'assistant',
    });
    expect(value.store.search.readSelection(access(value), selected)).toBeNull();
    const child = access(value, { includeTasks: true, taskId: 'child' });
    const result = value.store.search.sourceWindow(child, { selection: selected });
    expect(result?.items.map((item) => item.text)).toEqual(['Read child', 'Exact child answer']);
    expect(result?.items.map((item) => item.role)).toEqual(['user', 'assistant']);
    expect(
      value.store.search.readSelection(
        access(value, { includeTasks: true, taskId: 'sibling' }),
        selected,
      ),
    ).toBeNull();
    value.store.close();
    value.store = await openProfileStore(value.directory, {
      defaultAgentSettings: agentSettingsFixture,
    });
    value.store.append('session', [
      {
        type: 'branch.created',
        runId: null,
        at: 4,
        data: {
          id: 'revision',
          sessionId: 'session',
          parentId: 'main',
          forkMessageId: 'root-user',
          createdAt: 4,
        },
      },
      { type: 'branch.selected', runId: null, at: 4, data: { branchId: 'revision' } },
    ]);
    expect(value.store.search.readSelection(child, selected)).toBeNull();
    const old = value.store.search.sourceWindow(
      access(value, { includeTasks: true, taskId: 'child', branchId: 'main' }),
      { selection: selected },
    );
    expect(old?.items.map((item) => item.text)).toEqual(['Read child', 'Exact child answer']);
    expect(old?.historicalBranch).toBe(true);
    expect(value.store.getSession('session')?.activeBranchId).toBe('revision');
  });

  it('applies inclusive time and excluded-session filters before lexical limits, vector pages and scoped watermarks', async () => {
    const value = await fixture();
    const earlier = message(value, 'old', 'needle earlier', { createdAt: 10 });
    const middle = message(value, 'middle', 'needle middle', { createdAt: 20 });
    message(value, 'later', 'needle later', { createdAt: 30 });
    session(value, 'other', 'other-main');
    message(value, 'other-message', 'needle other', {
      sessionId: 'other',
      branchId: 'other-main',
      createdAt: 20,
    });
    for (const item of [
      earlier,
      middle,
      {
        source: {
          id: 'message:later',
          kind: 'message' as const,
          contentHash: hash('needle later'),
        },
      },
      {
        source: {
          id: 'message:other-message',
          kind: 'message' as const,
          contentHash: hash('needle other'),
        },
      },
    ]) {
      const snapshot = value.store.search.source(
        access(value, { includeHistoricalBranches: true }),
        item.source,
      );
      if (!snapshot) throw new Error('Source missing');
      value.store.search.replaceChunks({
        generation: 1,
        source: item.source,
        signature: 'window-index',
        chunks: [
          {
            ordinal: 0,
            start: 0,
            end: snapshot.text.length,
            text: snapshot.text,
            tokens: 'needle',
          },
        ],
      });
      value.store.search.putVectors({
        generation: 1,
        source: item.source,
        signature: 'window-index',
        modelSignature: 'window-model',
        dimensions: 2,
        vectors: [{ ordinal: 0, vector: [1, 0] }],
      });
    }
    const bounded = access(value, { createdFrom: 20, createdTo: 20 });
    expect(value.store.search.lexical(bounded, { tokens: ['needle'], limit: 1 })).toHaveLength(1);
    const first = value.store.search.vectors(bounded, {
      modelSignature: 'window-model',
      limit: 1,
    });
    expect(first.items.map((item) => item.source.id)).toEqual(['message:middle']);
    if (first.next === null) throw new Error('Expected another permitted vector page');
    expect(
      value.store.search.vectors(bounded, {
        modelSignature: 'window-model',
        limit: 1,
        after: first.next,
      }),
    ).toMatchObject({
      items: [{ source: { id: 'message:other-message' } }],
      next: null,
    });
    const other = { ...bounded, excludeSessionId: 'session' };
    expect(value.store.search.lexical(other, { tokens: ['needle'], limit: 1 })[0]?.source.id).toBe(
      'message:other-message',
    );
    expect(
      value.store.search.vectors(other, { modelSignature: 'window-model', limit: 1 }),
    ).toMatchObject({
      items: [{ source: { id: 'message:other-message' } }],
      next: null,
    });
    const before = value.store.search.watermark(other);
    message(value, 'current-extra', 'needle extra', { createdAt: 20 });
    expect(value.store.search.watermark(other)).toBe(before);
    expect(() =>
      value.store.search.lexical(access(value, { createdFrom: 30, createdTo: 20 }), {
        tokens: ['needle'],
      }),
    ).toThrow('time range');
  });
});
