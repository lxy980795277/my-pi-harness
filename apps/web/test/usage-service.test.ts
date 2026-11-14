import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUsage } from '../src/features/usage/services/usage';
import { usageFixture } from './fixtures/usage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request-set usage HTTP', () => {
  it('keeps exact answer identity and explicit subtree scope on read-only requests', async () => {
    const data = usageFixture();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify(data)));
    vi.stubGlobal('fetch', fetch);
    await expect(
      fetchUsage(
        'session/one',
        { branchId: 'branch', inputMessageId: 'input', includeDescendants: true },
        new AbortController().signal,
      ),
    ).resolves.toEqual(data);
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/session%2Fone/usage?branchId=branch&inputMessageId=input&includeDescendants=true',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });

  it('preserves false for own-task scope and rejects malformed accounting instead of inventing zero', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify(usageFixture({ estimatedCostUsd: null }))));
    vi.stubGlobal('fetch', fetch);
    await fetchUsage(
      'session',
      { taskId: 'task', includeDescendants: false },
      new AbortController().signal,
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/session/usage?taskId=task&includeDescendants=false',
      expect.objectContaining({ method: 'GET' }),
    );
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ ...usageFixture(), tokens: { totalTokens: -1 } })),
    );
    await expect(fetchUsage('session', {}, new AbortController().signal)).rejects.toThrow();
  });
});
