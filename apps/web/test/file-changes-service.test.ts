import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelFileChangeBatch,
  fetchFileChange,
  fetchFileChangeBatch,
  fetchFileChangeBatches,
  fetchFileChanges,
  fileChangeWasNotAccepted,
  submitFileChangeBatch,
} from '../src/features/file-changes/services/file-changes';
import { RequestError } from '../src/services/base-request';
import { fileBatchFixture, fileChangeFixture } from './fixtures/file-changes';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('file-change HTTP ownership', () => {
  it('uses host cursors and exact root answer IDs without adding the viewed branch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [fileChangeFixture({ sessionId: 'session/one' })],
          nextCursor: 7,
          canOperate: true,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(
      fetchFileChanges(
        'session/one',
        { inputMessageId: 'root-input', cursor: 20, limit: 50 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ nextCursor: 7 });
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/session%2Fone/file-changes?inputMessageId=root-input&cursor=20&limit=50',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });

  it('continues bounded snapshot offsets and rejects an incorrect identity or oversized payload', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            change: fileChangeFixture(),
            side: 'diff',
            text: '<script>inert</script>',
            offset: 100,
            nextOffset: 120,
          }),
        ),
      );
    });
    vi.stubGlobal('fetch', fetch);
    await expect(
      fetchFileChange(
        'session',
        'change-one',
        { side: 'diff', offset: 100, maxBytes: 61440 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ nextOffset: 120 });
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/session/file-changes/change-one?side=diff&offset=100&maxBytes=61440',
      expect.objectContaining({ method: 'GET' }),
    );
    await expect(
      fetchFileChange('session', 'wrong-change', {}, new AbortController().signal),
    ).rejects.toThrow('不一致');
    fetch.mockImplementation(() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            change: fileChangeFixture(),
            side: 'diff',
            text: 'x'.repeat(65537),
            offset: 0,
            nextOffset: null,
          }),
        ),
      );
    });
    await expect(
      fetchFileChange('session', 'change-one', {}, new AbortController().signal),
    ).rejects.toThrow();
  });

  it('submits IDs only, accepts 202, and retrieves or cancels the durable operation explicitly', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => {
      return Promise.resolve(new Response(JSON.stringify(fileBatchFixture()), { status: 202 }));
    });
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await submitFileChangeBatch(
      'session',
      {
        operationId: 'operation-one',
        action: 'undo',
        selection: { kind: 'answer', inputMessageId: 'input' },
      },
      signal,
    );
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/sessions/session/file-changes/operations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          operationId: 'operation-one',
          action: 'undo',
          selection: { kind: 'answer', inputMessageId: 'input' },
        }),
      }),
    );
    await fetchFileChangeBatch('session', 'operation-one', signal);
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/sessions/session/file-changes/operations/operation-one',
      expect.objectContaining({ method: 'GET' }),
    );
    await cancelFileChangeBatch('session', 'operation-one', signal);
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/sessions/session/file-changes/operations/operation-one/cancel',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
    fetch.mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null })));
    await fetchFileChangeBatches('session', { cursor: 42, limit: 20 }, signal);
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/sessions/session/file-changes/operations?cursor=42&limit=20',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('retains validated preacceptance error codes without treating ID conflicts or lost transport as rejection', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: 'FILE_CHANGE_LIMIT', message: '超出 50 项上限。' }), {
        status: 400,
      }),
    );
    vi.stubGlobal('fetch', fetch);
    let failure: unknown;
    try {
      await submitFileChangeBatch(
        'session',
        {
          operationId: 'operation-one',
          action: 'undo',
          selection: { kind: 'answer', inputMessageId: 'input' },
        },
        new AbortController().signal,
      );
    } catch (error: unknown) {
      failure = error;
    }
    expect(fileChangeWasNotAccepted(failure)).toBe(true);
    expect(
      fileChangeWasNotAccepted(
        new RequestError('ID conflict', 409, 'FILE_CHANGE_OPERATION_CONFLICT'),
      ),
    ).toBe(false);
    expect(fileChangeWasNotAccepted(new RequestError('not found', 404))).toBe(false);
    expect(fileChangeWasNotAccepted(new Error('socket closed'))).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
