import type { MemoryEntry, MemoryMutationResult, MemoryUsage } from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMemory,
  fetchMemoryPage,
  fetchMemoryStatuses,
  fetchMemoryUsage,
  forgetMemory,
  updateMemory,
} from '../src/features/memory/services/memory';

const ENTRY: MemoryEntry = {
  id: 'memory',
  scope: { kind: 'workspace', workspaceId: 'workspace/a' },
  category: 'preference',
  body: '使用中文回答。',
  revision: 1,
  enabled: true,
  mode: 'fixed',
  source: { kind: 'manual' },
  createdAt: 1,
  updatedAt: 1,
};
const USAGE: MemoryUsage = {
  sessionId: 'session',
  runId: 'run',
  preparedSeq: 5,
  preparedAt: 2,
  entries: [
    {
      id: ENTRY.id,
      scope: ENTRY.scope,
      category: ENTRY.category,
      body: ENTRY.body,
      revision: ENTRY.revision,
      source: ENTRY.source,
    },
  ],
};

const respond = (body: unknown) => {
  const request = vi.fn<typeof globalThis.fetch>().mockImplementation(() => {
    return Promise.resolve(
      new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
    );
  });
  vi.stubGlobal('fetch', request);
  return request;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scoped memory transport', () => {
  it('requests a stable workspace and rejects a valid response from another scope', async () => {
    const request = respond({
      items: [{ ...ENTRY, scope: { kind: 'user' } }],
      nextCursor: null,
      total: 1,
    });
    await expect(
      fetchMemoryPage(
        ENTRY.scope,
        { mode: 'fixed', cursor: 'before', limit: 20 },
        new AbortController().signal,
      ),
    ).rejects.toThrow('请求范围或采用方式不一致');
    expect(request).toHaveBeenCalledWith(
      '/api/memories?scope=workspace&workspaceId=workspace%2Fa&mode=fixed&cursor=before&limit=20',
      expect.any(Object),
    );
  });

  it('does not publish another mode or a cursor which cannot advance', async () => {
    respond({ items: [ENTRY], nextCursor: null, total: 1 });
    await expect(
      fetchMemoryPage(ENTRY.scope, { mode: 'relevant', limit: 20 }, new AbortController().signal),
    ).rejects.toThrow('采用方式不一致');
    respond({ items: [ENTRY], nextCursor: 'memory', total: 2 });
    await expect(
      fetchMemoryPage(ENTRY.scope, { cursor: 'memory', limit: 20 }, new AbortController().signal),
    ).rejects.toThrow('游标没有前进');
  });

  it('filters effective profile entries and categories on the server before paginating', async () => {
    const fetch = respond({ items: [ENTRY], nextCursor: 'memory', total: 45 });
    await fetchMemoryPage(
      ENTRY.scope,
      { enabled: true, category: 'preference', limit: 20 },
      new AbortController().signal,
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/memories?scope=workspace&workspaceId=workspace%2Fa&limit=20&enabled=true&category=preference',
      expect.objectContaining({ method: 'GET' }),
    );
    respond({ items: [{ ...ENTRY, enabled: false }], nextCursor: null, total: 1 });
    await expect(
      fetchMemoryPage(ENTRY.scope, { enabled: true }, new AbortController().signal),
    ).rejects.toThrow('请求范围');
    respond({ items: [ENTRY], nextCursor: null, total: 1 });
    await expect(
      fetchMemoryPage(ENTRY.scope, { category: 'fact' }, new AbortController().signal),
    ).rejects.toThrow('请求范围');
  });

  it('reads exact current statuses rather than treating an absent page as forgotten', async () => {
    const ids = Array.from({ length: 108 }, (_, index) => {
      return `memory-${index}`;
    });
    const statuses = ids.map((id) => {
      return { id, revision: 1, enabled: true, mode: 'fixed' };
    });
    const request = respond(statuses);
    await expect(fetchMemoryStatuses(ids, new AbortController().signal)).resolves.toHaveLength(108);
    expect(request).toHaveBeenCalledWith(
      '/api/memories/statuses',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ ids }) }),
    );
    respond([{ id: ids[0], revision: null, enabled: false, mode: null }]);
    await expect(fetchMemoryStatuses(ids, new AbortController().signal)).rejects.toThrow(
      '请求的条目不一致',
    );
  });

  it('rejects a crossed write acknowledgement instead of publishing success', async () => {
    const result: MemoryMutationResult = {
      entry: ENTRY,
      receipt: {
        requestId: 'other',
        operation: 'create',
        memoryId: ENTRY.id,
        revision: 1,
        status: 'applied',
      },
    };
    respond(result);
    await expect(
      createMemory(
        {
          requestId: 'write',
          scope: ENTRY.scope,
          category: ENTRY.category,
          body: ENTRY.body,
          enabled: true,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('原请求不一致');
  });

  it('preserves the edited revision and accepts a forgotten idempotent retry without resurrecting it', async () => {
    const result: MemoryMutationResult = {
      entry: null,
      receipt: {
        requestId: 'retry',
        operation: 'update',
        memoryId: ENTRY.id,
        revision: 2,
        status: 'applied',
      },
    };
    const request = respond(result);
    const input = {
      requestId: 'retry',
      expectedRevision: 1,
      category: ENTRY.category,
      body: '更正后的偏好',
      enabled: false,
    };
    await expect(updateMemory(ENTRY.id, input, new AbortController().signal)).resolves.toEqual(
      result,
    );
    expect(request).toHaveBeenCalledWith(
      '/api/memories/memory',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(input) }),
    );
  });

  it('requires forgetting to acknowledge the requested memory and return no live entry', async () => {
    respond({
      entry: ENTRY,
      receipt: {
        requestId: 'forget',
        operation: 'forget',
        memoryId: ENTRY.id,
        revision: 2,
        status: 'forgotten',
      },
    });
    await expect(
      forgetMemory(
        ENTRY.id,
        { requestId: 'forget', expectedRevision: 1 },
        new AbortController().signal,
      ),
    ).rejects.toThrow('遗忘结果');
  });

  it('reads only the exact Run snapshot and rejects another Run', async () => {
    respond(USAGE);
    const signal = new AbortController().signal;
    await expect(fetchMemoryUsage('session', 'run', signal)).resolves.toEqual(USAGE);
    await expect(fetchMemoryUsage('session', 'other', signal)).rejects.toThrow('请求的运行不一致');
  });

  it('distinguishes no dispatched request from a request which adopted no entries', async () => {
    respond(null);
    await expect(
      fetchMemoryUsage('session', 'run', new AbortController().signal),
    ).resolves.toBeNull();
    respond({ ...USAGE, entries: [] });
    await expect(
      fetchMemoryUsage('session', 'run', new AbortController().signal),
    ).resolves.toMatchObject({ entries: [] });
  });
});
