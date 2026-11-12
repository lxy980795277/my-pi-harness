import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import {
  SearchIndexStatusSchema,
  SearchModelStatusSchema,
  SearchRerankerStatusSchema,
  SearchQueryResultSchema,
} from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { expect, it } from 'vitest';
import { createApplicationServices } from '../src/application/services';
import { loadDaemonConfig } from '../src/application/config';
import { createDaemonApplication } from '../src/http/server';
import { loginFixture } from './support/login';

it('keeps status inert and lexical search usable without a prepared model, with authenticated scopes and exact sources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-search-api-'));
  const config = loadDaemonConfig({
    MY_PI_HARNESS_PORT: '0',
    MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
    MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
  });
  const services = await createApplicationServices(config, {
    credentials: createMemoryCredentialStore(),
  });
  const app = await createDaemonApplication(config, undefined, services);
  try {
    const origin = await app.server.listen({ host: '127.0.0.1', port: 0 });
    expect((await fetch(`${origin}/api/search/model`)).status).toBe(401);
    const grant = await loginFixture(origin, services);
    const headers = {
      Cookie: grant.cookie,
      Origin: origin,
      'X-CSRF-Token': grant.csrf,
      'Content-Type': 'application/json',
    };
    const call = async (path: string, method = 'GET', body?: unknown) =>
      await fetch(`${origin}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const initial: unknown = await (await call('/api/search/model')).json();
    expect(Value.Check(SearchModelStatusSchema, initial)).toBe(true);
    expect(initial).toMatchObject({ state: 'unprepared', progress: null });
    const verifier: unknown = await (await call('/api/search/reranker')).json();
    expect(Value.Check(SearchRerankerStatusSchema, verifier)).toBe(true);
    expect(verifier).toMatchObject({ state: 'unprepared', progress: null });
    expect(
      (await call('/api/search/reranker/prepare', 'POST', { modelId: 'arbitrary' })).status,
    ).toBe(400);
    expect(await (await call('/api/search/reranker/cancel', 'POST', {})).json()).toEqual(verifier);

    const bad = await call('/api/search/model/prepare', 'POST', { modelId: 'arbitrary' });
    expect(bad.status).toBe(400);
    expect((await call('/api/search', 'POST', { query: ' ' })).status).toBe(422);
    expect(
      (
        await call('/api/search', 'POST', {
          query: '资料',
          scope: { allWorkspaces: true, workspaceId: null },
        })
      ).status,
    ).toBe(422);
    await services.memory.create({
      requestId: 'search-memory',
      scope: { kind: 'user' },
      category: 'fact',
      body: '记忆数据库使用 PostgreSQL，查询标识符 tool_search。',
      enabled: true,
    });
    expect((await call('/api/search/index/rebuild', 'POST', {})).status).toBe(200);
    const deadline = Date.now() + 8000;
    for (;;) {
      const index: unknown = await (await call('/api/search/index')).json();
      if (!Value.Check(SearchIndexStatusSchema, index)) throw new Error('Invalid index state');
      if (index.state === 'ready' && index.sourceCount === 1) break;
      if (Date.now() > deadline)
        throw new Error(`Index did not become ready: ${JSON.stringify(index)}`);
      await delay(20);
    }
    for (const query of ['记忆', '库', 'TOOL_SEARCH']) {
      const response = await call('/api/search', 'POST', { query });
      expect(response.status).toBe(200);
      const result: unknown = await response.json();
      if (!Value.Check(SearchQueryResultSchema, result)) throw new Error('Invalid search result');
      expect(result.mode).toBe('lexical');
      expect(result.hits).toHaveLength(1);
      expect(result.hits[0]).toMatchObject({
        origin: 'memory',
        text: '记忆数据库使用 PostgreSQL，查询标识符 tool_search。',
      });
    }
    await services.memory.create({
      requestId: 'pending-source',
      scope: { kind: 'user' },
      category: 'fact',
      body: '新增资料用于检查索引覆盖。',
      enabled: true,
    });
    const pending: unknown = await (
      await call('/api/search', 'POST', { query: '新增资料' })
    ).json();
    if (!Value.Check(SearchQueryResultSchema, pending)) throw new Error('Invalid coverage result');
    if (pending.hits.length === 0) expect(pending.truncated).toBe(true);
    const pendingEntry = services.memory
      .list()
      .items.find((entry) => entry.body.startsWith('新增资料'));
    if (!pendingEntry) throw new Error('Missing pending source');
    services.memory.forget(pendingEntry.id, {
      requestId: 'forget-pending',
      expectedRevision: pendingEntry.revision,
    });
    const after: unknown = await (await call('/api/search/model')).json();
    expect(after).toEqual(initial);
    expect(await (await call('/api/search/reranker')).json()).toEqual(verifier);
    const memories = services.memory.list();
    const memory = memories.items[0];
    if (!memory) throw new Error('Expected memory');
    services.memory.forget(memory.id, {
      requestId: 'forget-search',
      expectedRevision: memory.revision,
    });
    const empty: unknown = await (await call('/api/search', 'POST', { query: '记忆' })).json();
    expect(empty).toMatchObject({ mode: 'lexical', hits: [] });
  } finally {
    await app.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
