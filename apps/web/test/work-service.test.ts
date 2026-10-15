import { initialWorkState, type WorkSnapshot } from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWork, patchWork } from '../src/features/work/services/work';

const snapshot = (branchId: string): WorkSnapshot => {
  return { state: initialWorkState(branchId), checkpoints: [] };
};
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('branch-scoped work transport', () => {
  it('requests the expected branch and rejects an otherwise valid response for another branch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify(snapshot('other-branch')), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(
      fetchWork('session', 'expected/branch', new AbortController().signal),
    ).rejects.toThrow('请求分支不一致');
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/session/work?branchId=expected%2Fbranch',
      expect.any(Object),
    );
  });

  it('binds a revision update to its branch and rejects a crossed response before caching', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify(snapshot('other-branch')), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const patch = { expectedBranchId: 'original', revision: 0, mode: 'plan' as const };
    await expect(patchWork('session', patch, new AbortController().signal)).rejects.toThrow(
      '原分支不一致',
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/session/work',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(patch) }),
    );
  });
});
