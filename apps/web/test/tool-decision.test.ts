import type { SessionSnapshot } from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decideTool } from '../src/features/sessions/services/sessions';

const snapshot: SessionSnapshot = {
  session: {
    id: 'session',
    title: 'Conversation',
    providerId: 'provider',
    modelId: 'model',
    thinkingLevel: 'off',
    workspaceId: 'workspace',
    approvalMode: 'ask',
    createdAt: 0,
    updatedAt: 10,
    activeBranchId: 'branch',
    activeRunId: 'run',
    snapshotSeq: 4,
  },
  branches: [],
  messages: [],
  runs: [],
  queue: [],
  tools: [],
  snapshotSeq: 4,
};

const response = (body: unknown): Response => {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tool decision acknowledgement', () => {
  it('accepts the exact acknowledgement then reads the committed session through the existing service', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    fetch.mockResolvedValueOnce(response({ ok: true })).mockResolvedValueOnce(response(snapshot));
    vi.stubGlobal('fetch', fetch);
    const result = await decideTool(
      'session',
      'tool/id',
      { decision: 'allow' },
      new AbortController().signal,
    );
    expect(result).toEqual(snapshot);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/sessions/session/tools/tool%2Fid/decision',
      expect.objectContaining({ method: 'POST', body: '{"decision":"allow"}' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/sessions/session',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects invalid or broadened acknowledgements before reading a session', async () => {
    for (const acknowledgement of [{ ok: false }, { ok: true, extra: true }, {}]) {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response(acknowledgement));
      vi.stubGlobal('fetch', fetch);
      await expect(
        decideTool('session', 'tool', { decision: 'deny' }, new AbortController().signal),
      ).rejects.toThrow('不兼容的数据');
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
});
