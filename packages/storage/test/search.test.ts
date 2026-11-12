import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { MemoryService } from '@my-pi-harness/memory';
import type { MessageView, SearchScope } from '@my-pi-harness/protocol';
import type { SearchSourceSnapshot } from '@my-pi-harness/protocol/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { openProfileStore, type ProfileStore } from '../src/index';
import { createAgentSession, spawn } from './fixtures/agent-session';
import { MEMORY_PROPOSALS_SQL } from '../src/sqlite/migrations/0014-memory-proposals';

interface Fixture {
  directory: string;
  store: ProfileStore;
  owner: string;
}
const fixtures: Fixture[] = [];
const signature = 'test-tokenizer-v1';
const model = 'test-vector-v1';

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.store.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

function authenticate(store: ProfileStore): string {
  const token = createHash('sha256').update('search-test-client').digest('hex');
  store.auth.createLocalClient({
    id: 'client',
    tokenHash: token,
    csrfToken: 'csrf',
    createdAt: 1,
    expiresAt: 100,
  });
  return store.auth.completeLogin(
    {
      providerId: 'github',
      issuer: 'https://github.com',
      subject: 'search-owner',
      name: 'Search fixture',
      avatarUrl: null,
    },
    'client',
    {
      id: 'login',
      tokenHash: createHash('sha256').update('search-test-login').digest('hex'),
      createdAt: 2,
      expiresAt: 99,
    },
  ).user.id;
}

async function fixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-search-'));
  const store = await openProfileStore(directory);
  const value = { directory, store, owner: authenticate(store) };
  fixtures.push(value);
  return value;
}

function workspace(value: Fixture, id: string): void {
  value.store.createWorkspace({
    id,
    name: id,
    icon: 'folder',
    rootPath: `/tmp/search-${id}`,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  });
}

function session(value: Fixture, id: string, workspaceId: string | null = null): void {
  value.store.createSession({
    id,
    branchId: `branch-${id}`,
    title: id,
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId,
    approvalMode: 'ask',
    at: 1,
  });
}

function message(
  value: Fixture,
  sessionId: string,
  id: string,
  text: string,
  status: MessageView['status'] = 'complete',
  branchId = `branch-${sessionId}`,
): void {
  value.store.append(sessionId, [
    {
      type: 'message.started',
      runId: null,
      at: 2,
      data: {
        id,
        sessionId,
        branchId,
        runId: null,
        role: 'user',
        text,
        thinking: 'NEVER_INDEX_PRIVATE_THINKING',
        createdAt: 2,
        status,
        stopReason: null,
      },
      privateData: { forbidden: 'NEVER_INDEX_CODEC' },
    },
  ]);
}

function all(value: Fixture): SearchSourceSnapshot[] {
  const result: SearchSourceSnapshot[] = [];
  let after: string | undefined;
  do {
    const page = value.store.search.sources({
      limit: 2,
      ...(after === undefined ? {} : { after }),
    });
    result.push(...page.items);
    after = page.next ?? undefined;
  } while (after !== undefined);
  return result;
}

function index(
  value: Fixture,
  source: SearchSourceSnapshot,
  tokens = source.text,
  generation = 1,
): void {
  expect(
    value.store.search.replaceChunks({
      generation,
      source: source.source,
      signature,
      chunks: [{ ordinal: 0, start: 0, end: source.text.length, text: source.text, tokens }],
    }),
  ).toBe(true);
  expect(
    value.store.search.putVectors({
      generation,
      source: source.source,
      signature,
      modelSignature: model,
      dimensions: 2,
      vectors: [{ ordinal: 0, vector: [1, 0] }],
    }),
  ).toBe(true);
}

function access(value: Fixture, scope: SearchScope = {}) {
  return { ownerUserId: value.owner, scope };
}

function sql<T>(value: Fixture, operation: (db: Database.Database) => T): T {
  const db = new Database(join(value.directory, 'data.sqlite'));
  try {
    return operation(db);
  } finally {
    db.close();
  }
}

describe('persistent search sources and derived index', () => {
  it('installs the cursor index on an existing profile without replacing facts or vectors', async () => {
    const value = await fixture();
    session(value, 'existing');
    message(value, 'existing', 'saved', 'Existing source remains searchable');
    const memory = new MemoryService(value.store.memory);
    const saved = memory.create(value.owner, {
      requestId: 'existing-memory',
      scope: { kind: 'user' },
      category: 'fact',
      body: 'Existing independent memory',
      enabled: true,
    });
    for (const source of all(value)) index(value, source);
    expect(value.store.search.activate(1, value.store.search.watermark())).toBe(true);
    value.store.close();
    sql(value, (db) => {
      db.exec('DROP INDEX search_chunks_generation_cursor');
      db.prepare('DELETE FROM schema_migrations WHERE version>=15').run();
      db.exec(
        MEMORY_PROPOSALS_SQL.slice(MEMORY_PROPOSALS_SQL.indexOf('CREATE TABLE memory_proposals')),
      );
      db.pragma('user_version=14');
    });
    value.store = await openProfileStore(value.directory);
    expect(
      sql(value, (db) => db.pragma('index_info(search_chunks_generation_cursor)')),
    ).toMatchObject([{ name: 'generation' }, { name: 'id' }]);
    expect(sql(value, (db) => db.pragma('user_version', { simple: true }))).toBe(16);
    expect(value.store.search.lexical(access(value), { tokens: ['Existing'] })).toHaveLength(2);
    const page = value.store.search.vectors(access(value), { modelSignature: model });
    expect(page.items.map((item) => item.source.id).sort()).toEqual(
      ['message:saved', `memory:${saved.receipt.memoryId}`].sort(),
    );
    expect(page.items.every((item) => item.vector[0] === 1 && item.vector[1] === 0)).toBe(true);
    expect(page.next).toBeNull();
    expect(new MemoryService(value.store.memory).list(value.owner).items[0]?.body).toBe(
      'Existing independent memory',
    );
  });

  it('expands a concrete workspace to user memories only after an explicit scope selection', async () => {
    const value = await fixture();
    workspace(value, 'a');
    session(value, 'assigned', 'a');
    session(value, 'unassigned');
    message(value, 'assigned', 'project-message', 'Shared project signal');
    message(value, 'unassigned', 'unassigned-message', 'Shared unassigned signal');
    const memory = new MemoryService(value.store.memory);
    memory.create(value.owner, {
      requestId: 'user',
      scope: { kind: 'user' },
      category: 'preference',
      body: 'Shared user signal',
      enabled: true,
    });
    memory.create(value.owner, {
      requestId: 'project',
      scope: { kind: 'workspace', workspaceId: 'a' },
      category: 'fact',
      body: 'Shared workspace signal',
      enabled: true,
    });
    const sources = all(value);
    for (const source of sources) index(value, source);
    const userSource = sources.find((source) => source.text === 'Shared user signal');
    if (!userSource) throw new Error('user memory missing');
    const project = access(value, { workspaceId: 'a' });
    expect(value.store.search.lexical(project, { tokens: ['Shared'] })).toHaveLength(2);
    expect(value.store.search.source(project, userSource.source)).toBeNull();
    const expanded = access(value, { workspaceId: 'a', includeUserMemories: true });
    expect(value.store.search.lexical(expanded, { tokens: ['Shared'] })).toHaveLength(3);
    expect(value.store.search.source(expanded, userSource.source)?.text).toBe('Shared user signal');
    expect(
      value.store.search.lexical(access(value, { workspaceId: null }), { tokens: ['Shared'] }),
    ).toHaveLength(2);
    expect(
      value.store.search.source(access(value, { workspaceId: null }), userSource.source)?.text,
    ).toBe('Shared user signal');
    expect(value.store.search.lexical(access(value), { tokens: ['Shared'] })).toHaveLength(4);
  });

  it('repairs an absent lexical table even when the legal corpus is empty', async () => {
    const value = await fixture();
    expect(value.store.search.activate(1, value.store.search.watermark())).toBe(true);
    expect(value.store.search.queryReadiness()).toEqual({ generation: 1, complete: true });
    sql(value, (db) => db.exec('DROP TABLE search_fts'));
    expect(value.store.search.queryReadiness()).toEqual({ generation: 1, complete: false });
    expect(value.store.search.status()).toMatchObject({
      lexicalReady: false,
      state: 'catching-up',
    });
    expect(value.store.search.activate(1, value.store.search.watermark())).toBe(true);
    expect(value.store.search.queryReadiness()).toEqual({ generation: 1, complete: true });
    expect(value.store.search.status()).toMatchObject({ lexicalReady: true, state: 'ready' });
    expect(value.store.search.lexical(access(value), { tokens: ['absent'] })).toEqual([]);
  });

  it('retains only the latest usable semantic cache during a lexical downgrade and clears it after recovery', async () => {
    const value = await fixture();
    session(value, 'one');
    message(value, 'one', 'old', 'Existing message');
    const memory = new MemoryService(value.store.memory);
    const saved = memory.create(value.owner, {
      requestId: 'save',
      scope: { kind: 'user' },
      category: 'fact',
      body: 'Original remembered fact',
      enabled: true,
    });
    const initial = all(value);
    for (const source of initial) index(value, source);
    expect(value.store.search.activate(1, value.store.search.watermark())).toBe(true);
    const lexicalSignature = 'lexical-only';
    const lexical = value.store.search.beginRebuild(lexicalSignature);
    for (const source of initial)
      expect(
        value.store.search.replaceChunks({
          generation: lexical,
          source: source.source,
          signature: lexicalSignature,
          chunks: [
            {
              ordinal: 0,
              start: 0,
              end: source.text.length,
              text: source.text,
              tokens: source.text,
            },
          ],
        }),
      ).toBe(true);
    expect(value.store.search.activate(lexical, value.store.search.watermark())).toBe(true);
    expect(value.store.search.collectInactive(16, signature)).toBe(0);
    const oldMessage = initial.find((source) => source.messageId === 'old');
    if (!oldMessage) throw new Error('old message missing');
    expect(value.store.search.indexed(oldMessage.source, 1, signature, model).vectors).toBe(true);
    memory.update(value.owner, saved.receipt.memoryId, {
      requestId: 'edit',
      expectedRevision: 1,
      category: 'fact',
      body: 'New remembered fact',
      enabled: true,
    });
    expect(value.store.search.collectInactive(16, signature)).toBe(1);
    const oldMemory = initial.find((source) => source.memoryId !== null);
    if (!oldMemory) throw new Error('old memory missing');
    expect(value.store.search.indexed(oldMemory.source, 1, signature, model).chunks).toBe(false);
    const recovered = value.store.search.beginRebuild(signature);
    expect(value.store.search.reuseSource(oldMessage.source, recovered, signature)).toBe(true);
    expect(value.store.search.indexed(oldMessage.source, recovered, signature, model).vectors).toBe(
      true,
    );
    const edited = all(value).find((source) => source.memoryId !== null);
    if (!edited) throw new Error('edited source missing');
    expect(value.store.search.reuseSource(edited.source, recovered, signature)).toBe(false);
    index(value, edited, edited.text, recovered);
    expect(value.store.search.activate(recovered, value.store.search.watermark())).toBe(true);
    expect(value.store.search.collectInactive(16, signature)).toBeGreaterThan(0);
    expect(value.store.search.collectInactive(16, signature)).toBe(0);
    expect(value.store.search.generationSignature(1)).toBeNull();
    expect(value.store.search.generationSignature(lexical)).toBeNull();
    const recoveredVectors = value.store.search.vectors(access(value), { modelSignature: model });
    expect(recoveredVectors.items.map((entry) => entry.source.id).sort()).toEqual(
      [oldMessage.source.id, edited.source.id].sort(),
    );
    expect(recoveredVectors.next).toBeNull();
  });

  it('invalidates query watermarks only for permitted source changes and rejects a different owner', async () => {
    const value = await fixture();
    workspace(value, 'a');
    workspace(value, 'b');
    session(value, 'selected', 'a');
    session(value, 'other', 'b');
    message(value, 'selected', 'selected-first', 'Selected workspace content');
    const selected = access(value, { workspaceId: 'a', includeUserMemories: false });
    const beforeScoped = value.store.search.watermark(selected);
    const beforeGlobal = value.store.search.watermark();
    message(value, 'other', 'other-completed', 'Another workspace completed while querying');
    expect(value.store.search.watermark(selected)).toBe(beforeScoped);
    expect(value.store.search.watermark()).not.toBe(beforeGlobal);
    expect(() =>
      value.store.search.watermark({ ...selected, ownerUserId: 'another-owner' }),
    ).toThrow('another profile');
    message(value, 'selected', 'selected-completed', 'Selected workspace changed');
    expect(value.store.search.watermark(selected)).not.toBe(beforeScoped);
  });

  it('does not recycle cancelled generation identities or let an active completion replace a newer build', async () => {
    const value = await fixture();
    const previous = value.store.search.beginRebuild(signature);
    const current = value.store.search.beginRebuild(signature);
    expect(current).toBeGreaterThan(previous);
    expect(value.store.search.generationSignature(current)).toBe(signature);
    expect(value.store.search.generationSignature(previous)).toBeNull();
    expect(value.store.search.activate(1, value.store.search.watermark())).toBe(false);
    expect(value.store.search.status(model).buildingGeneration).toBe(current);
    expect(value.store.search.queryReadiness().complete).toBe(false);
    expect(value.store.search.activate(current, value.store.search.watermark())).toBe(true);
    expect(value.store.search.queryReadiness()).toEqual({ generation: current, complete: true });
  });

  it('rejects query completeness after source changes, missing lexical rows or an index failure', async () => {
    const value = await fixture();
    session(value, 'one');
    message(value, 'one', 'first', 'First source');
    const first = all(value)[0];
    if (!first) throw new Error('Expected the first source');
    index(value, first);
    expect(value.store.search.activate(1, value.store.search.watermark())).toBe(true);
    expect(value.store.search.queryReadiness().complete).toBe(true);
    message(value, 'one', 'second', 'Second source');
    expect(value.store.search.queryReadiness().complete).toBe(false);
    const second = all(value).find((source) => source.messageId === 'second');
    if (!second) throw new Error('Expected the second source');
    index(value, second);
    expect(value.store.search.status().pendingSources).toBe(0);
    expect(value.store.search.queryReadiness().complete).toBe(false);
    expect(value.store.search.activate(1, value.store.search.watermark())).toBe(true);
    expect(value.store.search.queryReadiness().complete).toBe(true);
    sql(value, (db) =>
      db.prepare('DELETE FROM search_fts WHERE rowid=(SELECT MIN(id) FROM search_chunks)').run(),
    );
    expect(value.store.search.queryReadiness().complete).toBe(false);
    expect(value.store.search.status()).toMatchObject({ state: 'catching-up', pendingSources: 1 });
    index(value, first);
    expect(value.store.search.activate(1, value.store.search.watermark())).toBe(true);
    expect(value.store.search.queryReadiness().complete).toBe(true);
    value.store.search.setFailure('Source indexing failed');
    expect(value.store.search.queryReadiness().complete).toBe(false);
    expect(value.store.search.status().state).toBe('failed');
    value.store.search.setFailure(null);
    expect(value.store.search.queryReadiness().complete).toBe(true);
  });

  it('allows independent forgetting with a missing FTS index and then repairs remaining derived rows', async () => {
    const value = await fixture();
    const memory = new MemoryService(value.store.memory);
    const saved = memory.create(value.owner, {
      requestId: 'create',
      scope: { kind: 'user' },
      category: 'fact',
      body: 'Forgotten cached body',
      enabled: true,
    });
    session(value, 'one');
    message(value, 'one', 'retained', 'Retained message');
    const sources = all(value);
    for (const source of sources) index(value, source);
    expect(value.store.search.activate(1, value.store.search.watermark())).toBe(true);
    sql(value, (db) => db.exec('DROP TABLE search_fts'));
    expect(
      memory.forget(value.owner, saved.receipt.memoryId, {
        requestId: 'forget',
        expectedRevision: 1,
      }).entry,
    ).toBeNull();
    expect(value.store.search.status(model)).toMatchObject({
      lexicalReady: false,
      pendingSources: 1,
      state: 'catching-up',
    });
    const retained = all(value)[0];
    if (!retained) throw new Error('retained source missing');
    expect(value.store.search.indexed(retained.source, 1, signature, model).chunks).toBe(false);
    const generation = value.store.search.beginRebuild(signature);
    expect(value.store.search.reuseSource(retained.source, generation, signature)).toBe(false);
    index(value, retained, retained.text, generation);
    expect(value.store.search.activate(generation, value.store.search.watermark())).toBe(true);
    expect(value.store.search.collectInactive(1)).toBe(1);
    expect(value.store.search.collectInactive(1)).toBe(0);
    expect(value.store.search.generationSignature(1)).toBeNull();
    expect(value.store.search.lexical(access(value), { tokens: ['Retained'] })).toHaveLength(1);
    expect(value.store.search.lexical(access(value), { tokens: ['Forgotten'] })).toEqual([]);
  });

  it('resumes partial vector batches from durable chunks and rejects Float32 overflow', async () => {
    const value = await fixture();
    session(value, 'one');
    message(value, 'one', 'saved', 'First.Second.');
    const source = all(value)[0];
    if (!source) throw new Error('source missing');
    expect(
      value.store.search.replaceChunks({
        generation: 1,
        source: source.source,
        signature,
        chunks: [
          { ordinal: 0, start: 0, end: 6, text: 'First.', tokens: 'First' },
          { ordinal: 1, start: 6, end: 13, text: 'Second.', tokens: 'Second' },
        ],
      }),
    ).toBe(true);
    expect(
      value.store.search.putVectors({
        generation: 1,
        source: source.source,
        signature,
        modelSignature: model,
        dimensions: 2,
        vectors: [{ ordinal: 0, vector: [1, 0] }],
      }),
    ).toBe(true);
    expect(value.store.search.activate(1, value.store.search.watermark())).toBe(true);
    expect(value.store.search.queryReadiness()).toEqual({ generation: 1, complete: true });
    expect(value.store.search.queryReadiness(model)).toEqual({
      generation: 1,
      complete: true,
      vectorsComplete: false,
    });
    expect(value.store.search.pendingVectorChunks(source.source, 1, signature, model)).toEqual([
      { ordinal: 1, start: 6, end: 13, text: 'Second.' },
    ]);
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.search.pendingVectorChunks(source.source, 1, signature, model)).toHaveLength(
      1,
    );
    expect(() =>
      value.store.search.putVectors({
        generation: 1,
        source: source.source,
        signature,
        modelSignature: model,
        dimensions: 2,
        vectors: [{ ordinal: 1, vector: [1e300, 0] }],
      }),
    ).toThrow('vector');
    expect(
      value.store.search.putVectors({
        generation: 1,
        source: source.source,
        signature,
        modelSignature: model,
        dimensions: 2,
        vectors: [{ ordinal: 1, vector: [0, 1] }],
      }),
    ).toBe(true);
    expect(value.store.search.queryReadiness(model)).toEqual({
      generation: 1,
      complete: true,
      vectorsComplete: true,
    });
    expect(value.store.search.queryReadiness('different-model')).toMatchObject({
      complete: true,
      vectorsComplete: false,
    });
  });

  it('reads bounded persistent text only, and shares one body across explicit branch memberships', async () => {
    const value = await fixture();
    session(value, 'one');
    message(value, 'one', 'first', '北京 GDP read_file');
    message(value, 'one', 'second', 'Persisted failed text', 'failed');
    message(value, 'one', 'live', 'NOT_TERMINAL', 'streaming');
    const sources = all(value);
    expect(sources.map((source) => source.text)).toEqual([
      '北京 GDP read_file',
      'Persisted failed text',
    ]);
    expect(JSON.stringify(sources)).not.toContain('NEVER_INDEX');
    expect(() => value.store.search.sources({ limit: 17 })).toThrow('allocation');
    const first = sources.find((source) => source.messageId === 'first');
    if (!first) throw new Error('source missing');
    index(value, first, '北京 北 京 GDP read file');
    value.store.append('one', [
      {
        type: 'branch.created',
        runId: null,
        at: 3,
        data: {
          id: 'edited',
          sessionId: 'one',
          parentId: 'branch-one',
          forkMessageId: 'second',
          createdAt: 3,
        },
      },
    ]);
    value.store.append('one', [
      { type: 'branch.selected', runId: null, at: 3, data: { branchId: 'edited' } },
    ]);
    expect(value.store.search.source(access(value), first.source)?.memberships).toEqual([
      { branchId: 'edited', taskId: null, ordinal: 1 },
    ]);
    expect(
      value.store.search.source(access(value, { branchId: 'branch-one' }), first.source)
        ?.memberships,
    ).toEqual([{ branchId: 'branch-one', taskId: null, ordinal: 1 }]);
    expect(value.store.search.indexed(first.source, 1, signature, model)).toEqual({
      chunks: true,
      vectors: true,
    });
    expect(
      sql(value, (db) => db.prepare('SELECT count(*) AS count FROM search_chunks').get()),
    ).toEqual({ count: 1 });
  });

  it('filters scopes before lexical TopK and vector paging, including single CJK terms and identifiers', async () => {
    const value = await fixture();
    workspace(value, 'a');
    workspace(value, 'b');
    session(value, 'other', 'b');
    session(value, 'target', 'a');
    for (let index = 0; index < 12; index += 1)
      message(value, 'other', `other-${index}`, '北京 read_file query');
    message(value, 'target', 'target', '北京 read_file query');
    message(value, 'target', 'target-second', '北京 read_file query');
    for (const source of all(value)) index(value, source, '北京 北 京 read file query');
    const scoped = access(value, { workspaceId: 'a', includeUserMemories: false });
    expect(
      value.store.search.lexical(scoped, { tokens: ['北'], limit: 1 }).map((hit) => hit.source.id),
    ).toEqual(['message:target']);
    expect(
      value.store.search.lexical(scoped, { tokens: ['北京', 'read_file'], limit: 1 }),
    ).toHaveLength(1);
    expect(value.store.search.lexical(scoped, { tokens: ['" OR "'], limit: 1 })).toEqual([]);
    const first = value.store.search.vectors(scoped, { modelSignature: model, limit: 1 });
    expect(first.items).toMatchObject([{ source: { id: 'message:target' }, vector: [1, 0] }]);
    if (first.next === null) throw new Error('Expected another permitted vector page');
    const second = value.store.search.vectors(scoped, {
      modelSignature: model,
      limit: 1,
      after: first.next,
    });
    expect(second).toMatchObject({
      items: [{ source: { id: 'message:target-second' }, vector: [1, 0] }],
      next: null,
    });
    const last = second.items[0];
    if (last === undefined) throw new Error('Expected the final permitted vector');
    expect(
      value.store.search.vectors(scoped, {
        modelSignature: model,
        limit: 1,
        after: last.chunkId,
      }),
    ).toEqual({
      items: [],
      next: null,
    });
    expect(() =>
      value.store.search.lexical({ ...scoped, ownerUserId: 'another' }, { tokens: ['query'] }),
    ).toThrow('another profile');
  });

  it('retains historical vectors while default archival and branch filters revoke their visibility', async () => {
    const value = await fixture();
    session(value, 'old');
    message(value, 'old', 'saved', 'Archived exact source');
    const source = all(value)[0];
    if (!source) throw new Error('source missing');
    index(value, source);
    const before = value.store.search.watermark();
    value.store.append('old', [{ type: 'session.deleted', runId: null, at: 3, data: {} }]);
    expect(value.store.search.watermark()).not.toBe(before);
    expect(value.store.search.source(access(value), source.source)).toBeNull();
    expect(value.store.search.lexical(access(value), { tokens: ['Archived'] })).toEqual([]);
    expect(value.store.search.vectors(access(value), { modelSignature: model })).toEqual({
      items: [],
      next: null,
    });
    expect(
      value.store.search.source(access(value, { includeArchived: true }), source.source)?.text,
    ).toBe(source.text);
    expect(
      value.store.search.vectors(access(value, { includeArchived: true }), {
        modelSignature: model,
      }),
    ).toMatchObject({ items: [{ source: source.source }], next: null });
    expect(
      value.store.search.putVectors({
        generation: 1,
        source: source.source,
        signature,
        modelSignature: model,
        dimensions: 2,
        vectors: [{ ordinal: 0, vector: [0, 1] }],
      }),
    ).toBe(true);
  });

  it('requires explicit task membership and drops children when their delegation anchor is absent', async () => {
    const base = await createAgentSession();
    const value = { ...base, owner: authenticate(base.store) };
    fixtures.push(value);
    spawn(value.store, 'child');
    const child = all(value).find((source) => source.messageId === 'user-child');
    if (!child) throw new Error('child missing');
    index(value, child, 'Read child');
    expect(value.store.search.source(access(value), child.source)).toBeNull();
    expect(
      value.store.search.source(access(value, { includeTasks: true }), child.source)?.memberships,
    ).toEqual([{ branchId: 'main', taskId: 'child', ordinal: 1 }]);
    expect(value.store.search.lexical(access(value), { tokens: ['child'] })).toEqual([]);
    expect(
      value.store.search.lexical(access(value, { taskId: 'child' }), { tokens: ['child'] }),
    ).toHaveLength(1);
    sql(value, (db) =>
      db.prepare('DELETE FROM branch_messages WHERE message_id=?').run('delegate-child'),
    );
    expect(value.store.search.source(access(value, { taskId: 'child' }), child.source)).toBeNull();
    expect(
      value.store.search.vectors(access(value, { includeTasks: true }), { modelSignature: model }),
    ).toEqual({ items: [], next: null });
    expect(
      value.store.search.putVectors({
        generation: 1,
        source: child.source,
        signature,
        modelSignature: model,
        dimensions: 2,
        vectors: [{ ordinal: 0, vector: [0, 1] }],
      }),
    ).toBe(false);
  });

  it('rejects late memory vectors and forgotten-generation text while explicit new human facts remain possible', async () => {
    const value = await fixture();
    const memory = new MemoryService(value.store.memory);
    const saved = memory.create(value.owner, {
      requestId: 'create',
      scope: { kind: 'user' },
      category: 'fact',
      body: 'Secret preference',
      enabled: true,
    });
    const source = all(value)[0];
    if (!source) throw new Error('source missing');
    index(value, source);
    const generation = value.store.search.beginRebuild(signature);
    expect(value.store.search.reuseSource(source.source, generation, signature)).toBe(true);
    memory.forget(value.owner, saved.receipt.memoryId, {
      requestId: 'forget',
      expectedRevision: 1,
    });
    expect(value.store.search.lexical(access(value), { tokens: ['Secret'] })).toEqual([]);
    expect(value.store.search.source(access(value), source.source)).toBeNull();
    expect(
      value.store.search.putVectors({
        generation,
        source: source.source,
        signature,
        modelSignature: model,
        dimensions: 2,
        vectors: [{ ordinal: 0, vector: [1, 0] }],
      }),
    ).toBe(false);
    expect(
      sql(value, (db) => db.prepare('SELECT count(*) AS count FROM search_fts').get()),
    ).toEqual({ count: 0 });
    expect(
      sql(value, (db) => db.prepare('SELECT count(*) AS count FROM search_chunks').get()),
    ).toEqual({ count: 0 });
  });

  it('switches only a complete caught-up generation, rejects superseded jobs and reuses vectors across restart', async () => {
    const value = await fixture();
    session(value, 'one');
    message(value, 'one', 'saved', 'One source');
    const source = all(value)[0];
    if (!source) throw new Error('source missing');
    index(value, source);
    expect(value.store.search.activate(1, value.store.search.watermark())).toBe(true);
    expect(value.store.search.status(model)).toMatchObject({
      state: 'ready',
      lexicalReady: true,
      sourceCount: 1,
      chunkCount: 1,
      vectorCount: 1,
    });
    const oldWatermark = value.store.search.watermark();
    const generation = value.store.search.beginRebuild(signature);
    expect(value.store.search.activeGeneration()).toBe(1);
    expect(value.store.search.activate(generation, oldWatermark)).toBe(false);
    expect(value.store.search.reuseSource(source.source, generation, signature)).toBe(true);
    message(value, 'one', 'added', 'Added while building');
    expect(value.store.search.activate(generation, oldWatermark)).toBe(false);
    const added = all(value).find((entry) => entry.messageId === 'added');
    if (!added) throw new Error('added missing');
    index(value, added, added.text, generation);
    expect(value.store.search.activate(generation, value.store.search.watermark())).toBe(true);
    expect(value.store.search.activeGeneration()).toBe(generation);
    expect(
      value.store.search.putVectors({
        generation: 1,
        source: source.source,
        signature,
        modelSignature: model,
        dimensions: 2,
        vectors: [{ ordinal: 0, vector: [1, 0] }],
      }),
    ).toBe(false);
    const prior = value.store.search.status(model);
    value.store.close();
    value.store = await openProfileStore(value.directory);
    expect(value.store.search.status(model)).toEqual(prior);
    expect(value.store.search.indexed(source.source, generation, signature, model)).toEqual({
      chunks: true,
      vectors: true,
    });
    const recoveredVectors = value.store.search.vectors(access(value), { modelSignature: model });
    expect(recoveredVectors.items).toHaveLength(2);
    expect(recoveredVectors.next).toBeNull();
  });

  it('rejects malformed durable vector bytes and non-finite values before returning a page', async () => {
    const value = await fixture();
    session(value, 'one');
    message(value, 'one', 'saved', 'Validated vector source');
    const source = all(value)[0];
    if (!source) throw new Error('Expected a saved source');
    index(value, source);
    expect(
      value.store.search.vectors(access(value), { modelSignature: model }).items[0]?.vector,
    ).toEqual([1, 0]);
    const nonFinite = Buffer.alloc(8);
    nonFinite.writeFloatLE(Infinity, 0);
    for (const bytes of [Buffer.alloc(4), 'invalid binary data', nonFinite]) {
      sql(value, (db) => db.prepare('UPDATE search_vectors SET vector=?').run(bytes));
      expect(() => value.store.search.vectors(access(value), { modelSignature: model })).toThrow(
        'vector',
      );
    }
  });

  it('validates exact source offsets and an entire vector batch before writing any rows', async () => {
    const value = await fixture();
    session(value, 'one');
    message(value, 'one', 'saved', '😀 source');
    const source = all(value)[0];
    if (!source) throw new Error('source missing');
    expect(() =>
      value.store.search.replaceChunks({
        generation: 1,
        source: source.source,
        signature,
        chunks: [
          {
            ordinal: 0,
            start: 1,
            end: source.text.length,
            text: source.text.slice(1),
            tokens: 'source',
          },
        ],
      }),
    ).toThrow('UTF-16');
    index(value, source, 'source');
    expect(
      value.store.search.putVectors({
        generation: 1,
        source: source.source,
        signature,
        modelSignature: 'partial',
        dimensions: 2,
        vectors: [
          { ordinal: 0, vector: [1, 0] },
          { ordinal: 1, vector: [0, 1] },
        ],
      }),
    ).toBe(false);
    expect(value.store.search.vectors(access(value), { modelSignature: 'partial' })).toEqual({
      items: [],
      next: null,
    });
    expect(() =>
      value.store.search.putVectors({
        generation: 1,
        source: source.source,
        signature,
        modelSignature: 'invalid',
        dimensions: 2,
        vectors: [{ ordinal: 0, vector: [NaN, 0] }],
      }),
    ).toThrow('vector');
  });
});
