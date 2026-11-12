import type { MemoryCurrentStatus } from '@my-pi-harness/protocol';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { refreshMemoryFacts } from '../src/features/memory/queries/cache';

describe('memory write acknowledgement and pending reads', () => {
  it('refreshes memory search after writes without changing historical message results or accepting late old text', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const old = Promise.withResolvers<string[]>();
    let oldSignal: AbortSignal | undefined;
    let memoryCalls = 0;
    let messageCalls = 0;
    let current = ['记忆原文'];
    const memoryKey = ['search-results', 'owner', { scope: { kind: 'memory' } }];
    const messageKey = ['search-results', 'owner', { scope: { kind: 'message' } }];
    const memory = new QueryObserver(client, {
      queryKey: memoryKey,
      meta: { memorySource: true },
      queryFn: ({ signal }): Promise<string[]> => {
        memoryCalls += 1;
        if (memoryCalls === 3) {
          oldSignal = signal;
          return old.promise;
        }
        return Promise.resolve([...current]);
      },
    });
    const message = new QueryObserver(client, {
      queryKey: messageKey,
      meta: { memorySource: false },
      queryFn: (): Promise<string[]> => {
        messageCalls += 1;
        return Promise.resolve(['历史回答仍包含当时内容']);
      },
    });
    const offMemory = memory.subscribe(() => {
      return;
    });
    const offMessage = message.subscribe(() => {
      return;
    });
    try {
      await Promise.all([memory.refetch(), message.refetch()]);
      expect(client.getQueryData(memoryKey)).toEqual(['记忆原文']);
      current = ['修改后的记忆'];
      await refreshMemoryFacts(client);
      expect(memoryCalls).toBe(2);
      expect(client.getQueryData(memoryKey)).toEqual(current);

      const pending = memory.refetch();
      expect(memoryCalls).toBe(3);
      current = [];
      await refreshMemoryFacts(client);
      expect(oldSignal?.aborted).toBe(true);
      expect(memoryCalls).toBe(4);
      expect(client.getQueryData(memoryKey)).toEqual([]);
      old.resolve(['被遗忘的旧正文']);
      await pending;
      expect(client.getQueryData(memoryKey)).toEqual([]);
      expect(messageCalls).toBe(1);
      expect(client.getQueryData(messageKey)).toEqual(['历史回答仍包含当时内容']);
    } finally {
      offMemory();
      offMessage();
      old.resolve([]);
      client.clear();
    }
  });

  it('supersedes an empty initial status read so a late pre-forget result cannot revive current state', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let releaseOld: ((value: MemoryCurrentStatus[]) => void) | undefined;
    let oldSignal: AbortSignal | undefined;
    const old = new Promise<MemoryCurrentStatus[]>((resolve) => {
      releaseOld = resolve;
    });
    const forgotten: MemoryCurrentStatus[] = [
      { id: 'memory', revision: null, enabled: false, mode: null },
    ];
    let calls = 0;
    const key = ['memory-current', ['memory']];
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: ({ signal }): Promise<MemoryCurrentStatus[]> => {
        calls += 1;
        if (calls === 1) {
          oldSignal = signal;
          return old;
        }
        return Promise.resolve(forgotten);
      },
    });
    const unsubscribe = observer.subscribe(() => {
      return;
    });
    try {
      expect(calls).toBe(1);
      expect(client.getQueryData(key)).toBeUndefined();
      await refreshMemoryFacts(client);
      expect(oldSignal?.aborted).toBe(true);
      expect(calls).toBe(2);
      expect(client.getQueryData(key)).toEqual(forgotten);
      releaseOld?.([{ id: 'memory', revision: 1, enabled: true, mode: 'fixed' }]);
      await old;
      expect(client.getQueryData(key)).toEqual(forgotten);
    } finally {
      unsubscribe();
      releaseOld?.([]);
      client.clear();
    }
  });
});
