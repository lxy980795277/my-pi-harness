import type { ModelRequestDetail, TraceEntryDetail, TracePage } from '@my-pi-harness/protocol';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { refreshLiveTrace } from '../src/features/trace/queries/cache';

const entryDetail = (status: string): TraceEntryDetail => {
  return {
    entry: {
      id: 'tool:one',
      seq: 1,
      kind: 'tool',
      at: 1,
      runId: 'run',
      taskId: 'child',
      branchId: 'main',
      status,
      title: 'tool',
      modelRequestId: null,
      toolCallId: 'one',
      durationMs: null,
      error: null,
    },
    items: [],
    nextCursor: null,
    nextOffset: null,
  };
};

const requestDetail = (status: 'running' | 'completed'): ModelRequestDetail => {
  return {
    summary: {
      modelRequestId: 'request',
      sessionId: 'session',
      seq: 1,
      branchId: 'main',
      runId: 'run',
      taskId: 'child',
      purpose: 'conversation',
      inputMessageId: 'input',
      answerInputMessageId: 'input',
      providerId: 'provider',
      modelId: 'model',
      preparedSeq: 1,
      queuedAt: 1,
      queueDurationMs: 0,
      startedAt: 1,
      finishedAt: null,
      durationMs: null,
      firstResponseMs: null,
      status,
      usage: null,
      error: null,
      responseId: null,
      pricingSource: 'unknown',
      pricingCatalogVersion: null,
      costEstimate: null,
      cacheWrite1h: null,
    },
    section: 'messages',
    items: [],
    nextCursor: null,
    nextOffset: null,
  };
};

describe('trace SSE cache refresh', () => {
  it('leaves frozen history and completed bodies static while child completion settles live details once', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const counts = { live: 0, frozen: 0, completed: 0, child: 0, approval: 0, other: 0 };
    let childStatus: 'running' | 'completed' = 'running';
    let approvalStatus = 'awaiting_approval';
    const live = new QueryObserver<TracePage>(client, {
      queryKey: ['trace', 'session', 0, { cursor: 0 }],
      meta: { traceLivePage: true },
      queryFn: () => {
        counts.live++;
        return Promise.resolve({ items: [], nextCursor: null, watermark: counts.live });
      },
    });
    const frozen = new QueryObserver<TracePage>(client, {
      queryKey: ['trace', 'session', 0, { cursor: 10, watermark: 20 }],
      meta: { traceLivePage: false },
      queryFn: () => {
        counts.frozen++;
        return Promise.resolve({ items: [], nextCursor: null, watermark: 20 });
      },
    });
    const completed = new QueryObserver(client, {
      queryKey: ['trace-content', 'session', 'completed'],
      queryFn: () => {
        counts.completed++;
        return Promise.resolve(requestDetail('completed'));
      },
    });
    const child = new QueryObserver(client, {
      queryKey: ['trace-content', 'session', 'child'],
      queryFn: () => {
        counts.child++;
        return Promise.resolve(requestDetail(childStatus));
      },
    });
    const approval = new QueryObserver(client, {
      queryKey: ['trace-content', 'session', 'approval'],
      queryFn: () => {
        counts.approval++;
        return Promise.resolve(entryDetail(approvalStatus));
      },
    });
    const other = new QueryObserver<TracePage>(client, {
      queryKey: ['trace', 'other', 0, { cursor: 0 }],
      meta: { traceLivePage: true },
      queryFn: () => {
        counts.other++;
        return Promise.resolve({ items: [], nextCursor: null, watermark: counts.other });
      },
    });
    const observers = [live, frozen, completed, child, approval, other];
    const unsubscribe = observers.map((observer) =>
      observer.subscribe(() => {
        return;
      }),
    );
    try {
      await Promise.all(observers.map((observer) => observer.refetch()));
      childStatus = 'completed';
      approvalStatus = 'approved';
      await refreshLiveTrace(client, 'session');
      expect(counts).toEqual({ live: 2, frozen: 1, completed: 1, child: 2, approval: 2, other: 1 });
      expect(child.getCurrentResult().data?.summary.status).toBe('completed');
      expect(approval.getCurrentResult().data?.entry.status).toBe('approved');
      await refreshLiveTrace(client);
      expect(counts).toEqual({ live: 3, frozen: 1, completed: 1, child: 2, approval: 2, other: 2 });
      await frozen.refetch();
      expect(counts.frozen).toBe(2);
    } finally {
      for (const close of unsubscribe) close();
      client.clear();
    }
  });
});
