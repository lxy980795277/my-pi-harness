import type {
  ModelRequestDetail,
  ModelRequestSummary,
  TraceEntry,
  TraceEntryDetail,
  TracePage,
} from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchModelRequest,
  fetchTrace,
  fetchTraceEntry,
} from '../src/features/trace/services/trace';

const SUMMARY: ModelRequestSummary = {
  modelRequestId: 'request/one',
  sessionId: 'session/one',
  seq: 10,
  branchId: 'branch',
  runId: 'run',
  taskId: null,
  purpose: 'conversation',
  inputMessageId: 'input',
  answerInputMessageId: 'input',
  providerId: 'provider',
  modelId: 'model',
  preparedSeq: 9,
  queuedAt: 1,
  queueDurationMs: 1,
  startedAt: 2,
  finishedAt: 20,
  durationMs: 18,
  firstResponseMs: 4,
  status: 'completed',
  usage: null,
  error: null,
  responseId: null,
  pricingSource: 'unknown',
  pricingCatalogVersion: null,
  costEstimate: null,
  cacheWrite1h: null,
};
const ENTRY: TraceEntry = {
  id: 'request:one',
  seq: 10,
  kind: 'request',
  at: 2,
  runId: 'run',
  taskId: null,
  branchId: 'branch',
  status: 'completed',
  title: 'model',
  modelRequestId: 'request/one',
  toolCallId: null,
  durationMs: 18,
  error: null,
};

const respond = (value: unknown): ReturnType<typeof vi.fn<typeof globalThis.fetch>> => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }),
    );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bounded trace HTTP reads', () => {
  it('encodes opaque identities and retains cursor, watermark and subtree scope', async () => {
    const page: TracePage = { items: [ENTRY], nextCursor: 10, watermark: 100 };
    const fetch = respond(page);
    await expect(
      fetchTrace(
        'session/one',
        { cursor: 0, watermark: 100, limit: 50, taskId: 'task', includeDescendants: true },
        new AbortController().signal,
      ),
    ).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/session%2Fone/trace?cursor=0&watermark=100&limit=50&taskId=task&includeDescendants=true',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });

  it('continues within the same content item and rejects crossed model-request details', async () => {
    const detail: ModelRequestDetail = {
      summary: SUMMARY,
      section: 'messages',
      items: [
        { index: 2, offset: 60000, role: 'user', text: '剩余正文', images: 0, truncated: false },
      ],
      nextCursor: null,
      nextOffset: null,
    };
    const fetch = respond(detail);
    await expect(
      fetchModelRequest(
        'session/one',
        'request/one',
        { section: 'messages', cursor: 2, offset: 60000, limit: 10 },
        new AbortController().signal,
      ),
    ).resolves.toEqual(detail);
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/session%2Fone/trace/requests/request%2Fone?section=messages&cursor=2&offset=60000&limit=10',
      expect.objectContaining({ method: 'GET' }),
    );
    respond({ ...detail, summary: { ...SUMMARY, sessionId: 'another' } });
    await expect(
      fetchModelRequest('session/one', 'request/one', {}, new AbortController().signal),
    ).rejects.toThrow('与读取目标不一致');
  });

  it('validates tool details and does not turn malformed or oversized responses into empty success', async () => {
    const detail: TraceEntryDetail = {
      entry: ENTRY,
      items: [],
      nextCursor: null,
      nextOffset: null,
    };
    respond({ ...detail, entry: { ...ENTRY, id: 'crossed' } });
    await expect(
      fetchTraceEntry('session/one', ENTRY.id, {}, new AbortController().signal),
    ).rejects.toThrow('与读取目标不一致');
    respond({
      ...detail,
      items: [
        { index: 0, offset: 0, role: 'tool', text: 'x'.repeat(65537), images: 0, truncated: false },
      ],
    });
    await expect(
      fetchTraceEntry('session/one', ENTRY.id, {}, new AbortController().signal),
    ).rejects.toThrow();
    respond({ items: [], nextCursor: null, watermark: 'invalid' });
    await expect(fetchTrace('session/one', {}, new AbortController().signal)).rejects.toThrow();
  });
});
