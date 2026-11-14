import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionProjection } from '../../../tests/fixtures/session-projection';
import {
  bindImportedSession,
  fetchArchiveAccess,
} from '../src/features/archives/services/archive-access';
import {
  cancelArchiveJob,
  commitSessionArchive,
  downloadSessionArchive,
  fetchArchiveJob,
  fetchArchiveJobs,
  startArchiveExport,
  uploadSessionArchive,
} from '../src/features/archives/services/archives';
import { setCsrfToken } from '../src/services/base-request';
import { archiveJobFixture } from './fixtures/archives';

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('archive wire transport', () => {
  it('sends the original gzip File with cookie/CSRF protection and no JSON or base64 copy', async () => {
    const file = new File([new Uint8Array([0x1f, 0x8b, 8, 0])], 'fixture.tar.gz', {
      type: 'application/gzip',
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(archiveJobFixture(), { status: 202 }));
    vi.stubGlobal('fetch', fetch);
    setCsrfToken('csrf-fixture');
    await uploadSessionArchive('archive-op', file, new AbortController().signal);
    expect(fetch).toHaveBeenCalledWith(
      '/api/session-archives/imports/archive-op/upload',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: file,
        headers: { 'Content-Type': 'application/gzip', 'X-CSRF-Token': 'csrf-fixture' },
      }),
    );
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(file);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('separates export, preflight publication, bounded history and cancellation by explicit operation IDs', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json(
          archiveJobFixture({ kind: 'export', sessionId: 'source/session', preview: null }),
          { status: 202 },
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await startArchiveExport('source/session', 'archive-op', signal);
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/session-archives/exports',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ operationId: 'archive-op', sessionId: 'source/session' }),
      }),
    );
    fetch.mockResolvedValueOnce(
      Response.json(archiveJobFixture({ status: 'publishing', phase: 'publishing' }), {
        status: 202,
      }),
    );
    await commitSessionArchive('archive-op', 'a'.repeat(64), signal);
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/session-archives/imports/archive-op/commit',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ archiveSha256: 'a'.repeat(64) }),
      }),
    );
    fetch.mockResolvedValueOnce(Response.json(archiveJobFixture()));
    await fetchArchiveJob('archive-op', signal);
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/session-archives/operations/archive-op',
      expect.objectContaining({ method: 'GET' }),
    );
    fetch.mockResolvedValueOnce(
      Response.json({ items: [archiveJobFixture({ preview: null })], nextCursor: 'opaque/next' }),
    );
    await fetchArchiveJobs({ cursor: 'opaque/previous', limit: 20 }, signal);
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/session-archives/operations?cursor=opaque%2Fprevious&limit=20',
      expect.objectContaining({ method: 'GET' }),
    );
    fetch.mockResolvedValueOnce(
      Response.json(archiveJobFixture({ status: 'cancelled', phase: 'cancelled' })),
    );
    await cancelArchiveJob('archive-op', signal);
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/session-archives/operations/archive-op/cancel',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });

  it('rejects a changed operation, digest, or non-gzip download instead of claiming restoration', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(archiveJobFixture({ operationId: 'wrong' })));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await expect(fetchArchiveJob('archive-op', signal)).rejects.toThrow('不一致');
    fetch.mockResolvedValueOnce(
      Response.json(archiveJobFixture({ archiveSha256: 'b'.repeat(64) })),
    );
    await expect(commitSessionArchive('archive-op', 'a'.repeat(64), signal)).rejects.toThrow(
      '不一致',
    );
    fetch.mockResolvedValueOnce(
      new Response('<html>gateway</html>', { headers: { 'Content-Type': 'text/html' } }),
    );
    await expect(downloadSessionArchive('archive-op', signal)).rejects.toThrow('文件类型');
  });

  it('uses explicit current execution binding with ask mode and validates the host response', async () => {
    const current = {
      ...sessionProjection().session,
      approvalMode: 'ask' as const,
      providerId: 'current-provider',
      modelId: 'current-model',
      workspaceId: null,
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ importedThroughSeq: 10, bound: false }))
      .mockResolvedValueOnce(Response.json(current));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await expect(fetchArchiveAccess(current.id, signal)).resolves.toMatchObject({ bound: false });
    await bindImportedSession(
      current.id,
      {
        providerId: 'current-provider',
        modelId: 'current-model',
        thinkingLevel: 'off',
        workspaceId: null,
      },
      signal,
    );
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/sessions/session/archive-binding',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          providerId: 'current-provider',
          modelId: 'current-model',
          thinkingLevel: 'off',
          workspaceId: null,
        }),
      }),
    );
    fetch.mockResolvedValueOnce(Response.json({ ...current, approvalMode: 'full-access' }));
    await expect(
      bindImportedSession(
        current.id,
        {
          providerId: 'current-provider',
          modelId: 'current-model',
          thinkingLevel: 'off',
          workspaceId: null,
        },
        signal,
      ),
    ).rejects.toThrow('不一致');
  });
});
