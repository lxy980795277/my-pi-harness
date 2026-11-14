import type { SessionArchiveJob } from '@my-pi-harness/protocol';
import { createElement, type EffectCallback, type FC } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useArchiveTransfer } from '../src/features/archives/hooks/use-archive-transfer';
import { useArchiveStore } from '../src/features/archives/stores/archives';
import type * as ArchivesStore from '../src/features/archives/stores/archives';
import { archiveJobFixture } from './fixtures/archives';

interface QueryRead {
  queryFn: (input: { signal: AbortSignal }) => Promise<SessionArchiveJob>;
  retry: boolean;
  refetchInterval: (input: { state: { data: SessionArchiveJob | undefined } }) => number | false;
}

const owned = vi.hoisted(() => {
  return {
    effects: [] as EffectCallback[],
    job: undefined as SessionArchiveJob | undefined,
    query: undefined as QueryRead | undefined,
    setData: vi.fn(),
    invalidate: vi.fn<() => Promise<void>>(),
  };
});

vi.mock('react', async (original) => {
  const react = await original<typeof React>();
  return {
    ...react,
    useEffect: (effect: EffectCallback): void => {
      owned.effects.push(effect);
    },
  };
});
// Reopening a browser dialog reads the current intent rather than SSR's initial Zustand snapshot.
vi.mock('../src/features/archives/stores/archives', async (original) => {
  const actual = await original<typeof ArchivesStore>();
  const store = actual.useArchiveStore;
  const read = <Result>(selector: (state: ReturnType<typeof store.getState>) => Result): Result => {
    return selector(store.getState());
  };
  return { ...actual, useArchiveStore: Object.assign(read, store) };
});
vi.mock('@tanstack/react-query', () => {
  return {
    useQuery: (options: QueryRead) => {
      owned.query = options;
      return { data: owned.job, refetch: vi.fn() };
    },
    useQueryClient: () => {
      return {
        getQueryData: () => {
          return owned.job;
        },
        setQueryData: owned.setData,
        invalidateQueries: owned.invalidate,
      };
    },
  };
});

function mount(): { state: ReturnType<typeof useArchiveTransfer>; close: () => void } {
  let state: ReturnType<typeof useArchiveTransfer> | undefined;
  const Probe: FC = () => {
    state = useArchiveTransfer();
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  const cleanups = owned.effects.splice(0).map((effect) => {
    return effect();
  });
  if (state === undefined) throw new Error('Missing archive hook');
  return {
    state,
    close: (): void => {
      for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup();
    },
  };
}

beforeEach(() => {
  useArchiveStore.getState().reset();
  owned.job = undefined;
  owned.query = undefined;
  owned.effects.length = 0;
  owned.setData
    .mockReset()
    .mockImplementation(
      (
        _key: unknown,
        update: (current: SessionArchiveJob | undefined) => SessionArchiveJob,
      ): void => {
        owned.job = update(owned.job);
      },
    );
  owned.invalidate.mockReset().mockResolvedValue();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('explicit archive transfer lifecycle', () => {
  it('reopens a lost export submission with the same identity and performs no POST until explicit retry', async () => {
    useArchiveStore.getState().openExport('source');
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error('connection lost'));
    vi.stubGlobal('fetch', fetch);
    const initial = mount();
    initial.state.exportArchive();
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    const id = useArchiveStore.getState().operationId;
    if (id === null) throw new Error('Missing export identity');
    initial.close();
    useArchiveStore.getState().close();
    useArchiveStore.getState().openExport('source');
    const reopened = mount();
    expect(reopened.state.operationId).toBe(id);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(owned.query?.retry).toBe(false);
    fetch.mockResolvedValueOnce(
      Response.json(
        archiveJobFixture({
          operationId: id,
          kind: 'export',
          sessionId: 'source',
          status: 'running',
          phase: 'packing',
          preview: null,
        }),
      ),
    );
    reopened.state.exportArchive();
    await vi.waitFor(() => {
      expect(owned.setData).toHaveBeenCalled();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(fetch.mock.calls[1]?.[1]?.body);
    reopened.close();
  });

  it('keeps an uncertain commit digest, polls safe GETs while ready, then closes publishing without cancellation', async () => {
    useArchiveStore.getState().openImport();
    useArchiveStore.getState().track('import', null, 'archive-op');
    owned.job = archiveJobFixture();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error('response lost'));
    vi.stubGlobal('fetch', fetch);
    const ready = mount();
    ready.state.commit();
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    expect(useArchiveStore.getState().commitIntents['archive-op']).toBe('a'.repeat(64));
    ready.close();
    const reopened = mount();
    expect(reopened.state.commitUnconfirmed).toBe(true);
    expect(owned.query?.refetchInterval({ state: { data: owned.job } })).toBe(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce(
      Response.json(
        archiveJobFixture({ status: 'publishing', phase: 'publishing', preview: null }),
      ),
    );
    const query = owned.query;
    if (query === undefined) throw new Error('Missing job query');
    owned.job = await query.queryFn({ signal: new AbortController().signal });
    reopened.close();
    const publishing = mount();
    expect(useArchiveStore.getState().commitIntents['archive-op']).toBeUndefined();
    publishing.state.changeOpen(false);
    await vi.waitFor(() => {
      expect(useArchiveStore.getState().mode).toBeNull();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('GET');
    publishing.close();
  });

  it('cancels a confirmed ready preflight on close and retains its identity for history reconciliation', async () => {
    useArchiveStore.getState().openImport();
    useArchiveStore.getState().track('import', null, 'archive-op');
    owned.job = archiveJobFixture();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json(
          archiveJobFixture({ status: 'cancelled', phase: 'cancelled', preview: null }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const ready = mount();
    ready.state.changeOpen(false);
    await vi.waitFor(() => {
      expect(useArchiveStore.getState().mode).toBeNull();
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/session-archives/operations/archive-op/cancel',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
    expect(owned.job?.status).toBe('cancelled');
    expect(useArchiveStore.getState().lastOperations['import']).toBe('archive-op');
    ready.close();
  });
});
