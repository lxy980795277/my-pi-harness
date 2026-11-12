import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import {
  SearchQueryResultSchema,
  SearchSourceWindowSchema,
  type SearchHit,
  type SearchSourceSelection,
} from '@my-pi-harness/protocol';
import { createMemoryCredentialStore } from '@my-pi-harness/storage';
import { Value } from 'typebox/value';
import { expect, it } from 'vitest';
import { startTestModel } from '../../../tests/e2e/model-server';
import { createApplicationServices } from '../src/application/services';
import { loadDaemonConfig } from '../src/application/config';
import { createDaemonApplication } from '../src/http/server';
import { SessionSearchService } from '../src/search/runtime';
import { loginFixture } from './support/login';

function selection(hit: SearchHit): SearchSourceSelection {
  if (!hit.sessionId || !hit.branchId || !hit.messageId) throw new Error('Expected message hit');
  return {
    source: hit.source,
    target: {
      kind: 'message',
      sessionId: hit.sessionId,
      branchId: hit.branchId,
      messageId: hit.messageId,
      ...(hit.taskId === undefined ? {} : { taskId: hit.taskId }),
    },
    start: hit.start,
    end: hit.end,
  };
}

it('reads exact bounded history without changing a live run, and validates human quotations over real Pi HTTP', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-search-sources-api-'));
  const model = await startTestModel();
  let closeServices: (() => Promise<void>) | undefined;
  let closeApplication: (() => Promise<void>) | undefined;
  try {
    const config = loadDaemonConfig({
      MY_PI_HARNESS_PORT: '0',
      MY_PI_HARNESS_PROFILE_DIRECTORY: join(directory, 'profile'),
      MY_PI_HARNESS_SESSION_LOG_ROOT: join(directory, '.my-pi-harness'),
    });
    const services = await createApplicationServices(config, {
      credentials: createMemoryCredentialStore(),
    });
    closeServices = () => services.close();
    const app = await createDaemonApplication(config, undefined, services);
    closeApplication = () => app.server.close();
    const origin = await app.server.listen({ host: '127.0.0.1', port: 0 });
    expect((await fetch(`${origin}/api/search/source`, { method: 'POST' })).status).toBe(403);
    const grant = await loginFixture(origin, services);
    const headers = {
      Cookie: grant.cookie,
      Origin: origin,
      'X-CSRF-Token': grant.csrf,
      'Content-Type': 'application/json',
    };
    const post = async (path: string, body: unknown) =>
      await fetch(`${origin}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    const provider = await services.gateway.saveProvider({
      name: 'Synthetic source provider',
      kind: 'custom',
      builtinId: null,
      api: 'openai-completions',
      baseUrl: `${model.origin}/v1`,
      enabled: true,
      requiresApiKey: true,
      models: [
        {
          id: 'source-model',
          name: 'Source',
          api: 'openai-completions',
          contextWindow: 32768,
          maxTokens: 1024,
          reasoning: false,
          input: ['text'],
        },
      ],
    });
    await services.gateway.setApiKey(provider.id, 'synthetic-source-key');
    const createSession = (title: string, workspaceId: string | null = null) =>
      services.runtime.createSession({
        title,
        providerId: provider.id,
        modelId: 'source-model',
        thinkingLevel: 'off',
        workspaceId,
        approvalMode: 'full-access',
      });
    const idle = async (id: string) => {
      const signal = AbortSignal.timeout(12000);
      for (;;) {
        const snapshot = services.runtime.getSnapshot(id);
        if (snapshot.session.activeRunId === null) return snapshot;
        signal.throwIfAborted();
        await wait(20, undefined, { signal });
      }
    };
    const sourceSession = createSession('Exact old discussion');
    const sourceText = '唯一定位 SOURCE_EXACT_731：周三先完成数据库迁移，再发布。';
    await services.runtime.send(sourceSession.id, {
      text: sourceText,
      requestId: 'original-source',
      mode: 'send',
    });
    const original = await idle(sourceSession.id);
    const workspacePath = join(directory, 'workspace');
    await mkdir(workspacePath);
    const workspace = await services.workspaces.create({ rootPath: workspacePath });
    const external = createSession('Same words, another workspace', workspace.id);
    await services.runtime.send(external.id, {
      text: sourceText,
      requestId: 'external-source',
      mode: 'send',
    });
    await idle(external.id);
    services.search.rebuild();
    const indexed = AbortSignal.timeout(8000);
    while (services.search.indexStatus().state !== 'ready') {
      indexed.throwIfAborted();
      await wait(20, undefined, { signal: indexed });
    }
    const response = await post('/api/search', {
      query: 'SOURCE_EXACT_731',
      scope: { workspaceId: null, kind: 'message' },
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (!Value.Check(SearchQueryResultSchema, result)) throw new Error('Invalid search result');
    const hit = result.hits.find((entry) => entry.origin === 'user');
    if (!hit) throw new Error('Missing exact user hit');
    const chosen = selection(hit);
    const globalResponse = await post('/api/search', {
      query: 'SOURCE_EXACT_731',
      scope: { allWorkspaces: true, kind: 'message' },
    });
    const globalResult: unknown = await globalResponse.json();
    if (!Value.Check(SearchQueryResultSchema, globalResult))
      throw new Error('Invalid global results');
    const externalHit = globalResult.hits.find(
      (entry) => entry.sessionId === external.id && entry.origin === 'user',
    );
    if (!externalHit) throw new Error('Missing explicit cross-workspace hit');
    const externalSelection = selection(externalHit);
    expect(externalSelection.source.id).not.toBe(chosen.source.id);
    expect(externalSelection.source.contentHash).toBe(chosen.source.contentHash);
    const windowResponse = await post('/api/search/source', { selection: chosen });
    expect(windowResponse.status).toBe(200);
    const window: unknown = await windowResponse.json();
    if (!Value.Check(SearchSourceWindowSchema, window)) throw new Error('Invalid source window');
    expect(window.items.find((entry) => entry.source.id === hit.source.id)?.text).toBe(sourceText);
    expect(window.items.length).toBeLessThanOrEqual(9);
    expect(services.store.getSession(sourceSession.id)?.snapshotSeq).toBe(original.snapshotSeq);
    expect(
      (
        await post('/api/search/source', {
          selection: { ...chosen, source: { ...chosen.source, contentHash: '0'.repeat(64) } },
        })
      ).status,
    ).toBe(404);
    expect(
      (await post('/api/search/source', { selection: { ...chosen, end: chosen.start } })).status,
    ).toBe(422);
    expect((await post('/api/search/source', { selection: chosen, before: 5 })).status).toBe(400);
    expect(
      (
        await post('/api/search/source', {
          selection: { ...chosen, target: externalSelection.target },
        })
      ).status,
    ).toBe(404);
    expect(
      (await post('/api/search', { query: '原文', scope: { createdFrom: 2, createdTo: 1 } }))
        .status,
    ).toBe(422);

    const current = createSession('Ongoing conversation');
    const acceptance = await services.runtime.send(current.id, {
      text: '慢速 当前对话继续执行。',
      requestId: 'active-run',
      mode: 'send',
    });
    const active = services.runtime.getSnapshot(current.id);
    if (!acceptance.runId) throw new Error('Expected active root run');
    expect(active.session.activeRunId).toBe(acceptance.runId);
    expect((await post('/api/search/source', { selection: chosen })).status).toBe(200);
    expect(services.runtime.getSnapshot(current.id).session.activeRunId).toBe(acceptance.runId);
    const port = new SessionSearchService(services.store, services.search);
    const context = {
      sessionId: current.id,
      branchId: current.activeBranchId,
      workspaceId: current.workspaceId,
      runId: acceptance.runId,
    };
    const toolResult = await port.searchSessions(
      context,
      'SOURCE_EXACT_731',
      8,
      new AbortController().signal,
    );
    expect(
      toolResult.hits.every(
        (entry) => entry.sessionId !== current.id && entry.taskId === undefined,
      ),
    ).toBe(true);
    expect(toolResult.hits.some((entry) => entry.source.id === chosen.source.id)).toBe(true);
    expect(toolResult.hits.some((entry) => entry.sessionId === external.id)).toBe(false);
    expect(
      await port.readSearchSource(
        context,
        chosen,
        { kind: 'search', selection: chosen },
        new AbortController().signal,
      ),
    ).toMatchObject({ text: sourceText });
    expect(
      await port.readSearchSource(
        context,
        externalSelection,
        {
          kind: 'quote',
          selection: externalSelection,
        },
        new AbortController().signal,
      ),
    ).toMatchObject({ text: sourceText });
    await expect(
      async () =>
        await port.readSearchSource(
          context,
          externalSelection,
          {
            kind: 'search',
            selection: externalSelection,
          },
          new AbortController().signal,
        ),
    ).rejects.toMatchObject({ code: 'SEARCH_SOURCE_NOT_FOUND' });
    const partial = { ...chosen, end: chosen.start + 4 };
    await expect(
      async () =>
        await port.readSearchSource(
          context,
          chosen,
          { kind: 'quote', selection: partial },
          new AbortController().signal,
        ),
    ).rejects.toMatchObject({ code: 'SEARCH_SOURCE_NOT_FOUND' });
    await expect(
      port.searchSessions(
        { ...context, taskId: 'ungranted-child' },
        'SOURCE_EXACT_731',
        8,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'SEARCH_SCOPE_CONFLICT' });
    await idle(current.id);

    const quoted = await post(`/api/sessions/${current.id}/inputs`, {
      text: '请参考所选片段回答。',
      requestId: 'quote-exact',
      mode: 'send',
      searchQuotes: [externalSelection],
    });
    expect(quoted.status).toBe(200);
    const quotedSnapshot = await idle(current.id);
    expect(quotedSnapshot.runs.at(-1)?.status).toBe('completed');
    const lastUser = quotedSnapshot.messages.filter((entry) => entry.role === 'user').at(-1);
    expect(lastUser?.text).toContain(sourceText);
    expect(JSON.stringify(model.requests.at(-1)?.body['messages']).split(sourceText)).toHaveLength(
      2,
    );
    const count = model.requests.length;
    expect(
      (
        await post(`/api/sessions/${current.id}/inputs`, {
          text: '不要发送陈旧正文。',
          requestId: 'stale-quote',
          mode: 'send',
          searchQuotes: [{ ...chosen, source: { ...chosen.source, contentHash: '0'.repeat(64) } }],
        })
      ).status,
    ).toBe(404);
    expect(model.requests).toHaveLength(count);
    await services.runtime.deleteSession(sourceSession.id);
    expect((await post('/api/search/source', { selection: chosen })).status).toBe(200);
    expect(services.store.getSession(sourceSession.id)).toBeUndefined();
    await services.memory.create({
      requestId: 'archived-memory',
      scope: { kind: 'workspace', workspaceId: workspace.id },
      category: 'fact',
      mode: 'relevant',
      body: '已归档工作区记忆 ARCHIVED_MEMORY_19',
      enabled: true,
    });
    await services.runtime.deleteSession(external.id);
    services.workspaces.archive(workspace.id);
    services.search.rebuild();
    const rebuilt = AbortSignal.timeout(8000);
    while (services.search.indexStatus().state !== 'ready') {
      rebuilt.throwIfAborted();
      await wait(20, undefined, { signal: rebuilt });
    }
    const archivedResult: unknown = await (
      await post('/api/search', {
        query: 'ARCHIVED_MEMORY_19',
        scope: { allWorkspaces: true, includeArchived: true, kind: 'memory' },
      })
    ).json();
    if (!Value.Check(SearchQueryResultSchema, archivedResult))
      throw new Error('Invalid archived result');
    const archivedMemory = archivedResult.hits[0];
    if (!archivedMemory?.memoryId) throw new Error('Missing archived memory');
    expect(
      (
        await post('/api/search/source', {
          selection: {
            source: archivedMemory.source,
            target: { kind: 'memory', memoryId: archivedMemory.memoryId },
            start: archivedMemory.start,
            end: archivedMemory.end,
          },
        })
      ).status,
    ).toBe(200);
  } finally {
    const failures: unknown[] = [];
    for (const close of [closeApplication ?? closeServices, () => model.close()]) {
      try {
        await close?.();
      } catch (error) {
        failures.push(error);
      }
    }
    await rm(directory, { recursive: true, force: true });
    if (failures.length) throw new AggregateError(failures, 'Source API fixture cleanup failed');
  }
});
