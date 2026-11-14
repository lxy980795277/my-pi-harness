import type { FileChangeBatchReceipt } from '@my-pi-harness/protocol';
import { createElement, type EffectCallback, type FC } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileChangeOperation } from '../src/features/file-changes/hooks/use-file-change-operation';
import { useFileChangesStore } from '../src/features/file-changes/stores/file-changes';
import type * as FileChangeStore from '../src/features/file-changes/stores/file-changes';
import { RequestError } from '../src/services/base-request';
import { fileBatchFixture } from './fixtures/file-changes';

interface ReadOptions {
  queryFn: (input: { signal: AbortSignal }) => Promise<FileChangeBatchReceipt>;
  retry: boolean;
  refetchInterval: (input: {
    state: { data: FileChangeBatchReceipt | undefined };
  }) => number | false;
}

const owned = vi.hoisted(() => {
  return {
    effects: [] as EffectCallback[],
    data: undefined as FileChangeBatchReceipt | undefined,
    error: null as Error | null,
    query: undefined as ReadOptions | undefined,
    invalidate: vi.fn<() => Promise<void>>(),
    setData: vi.fn(),
    refetch: vi.fn<() => Promise<void>>(),
  };
});

vi.mock('react', async (original) => {
  const actual = await original<typeof React>();
  return {
    ...actual,
    useEffect: (effect: EffectCallback): void => {
      owned.effects.push(effect);
    },
  };
});
// SSR otherwise reads Zustand's initial snapshot rather than a reopened client dialog's intent.
vi.mock('../src/features/file-changes/stores/file-changes', async (original) => {
  const actual = await original<typeof FileChangeStore>();
  const store = actual.useFileChangesStore;
  const read = <Result>(selector: (state: ReturnType<typeof store.getState>) => Result): Result => {
    return selector(store.getState());
  };
  return { ...actual, useFileChangesStore: Object.assign(read, store) };
});
vi.mock('@tanstack/react-query', () => {
  return {
    useQuery: (options: ReadOptions) => {
      owned.query = options;
      return { data: owned.data, error: owned.error, refetch: owned.refetch };
    },
    useQueryClient: () => {
      return {
        invalidateQueries: owned.invalidate,
        setQueryData: owned.setData,
        getQueryData: () => {
          return owned.data;
        },
      };
    },
  };
});

function mount(canOperate = true): {
  state: ReturnType<typeof useFileChangeOperation>;
  close: () => void;
} {
  let state: ReturnType<typeof useFileChangeOperation> | undefined;
  const Probe: FC = () => {
    state = useFileChangeOperation('session', canOperate);
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  const cleanups = owned.effects.splice(0).map((effect) => {
    return effect();
  });
  if (state === undefined) throw new Error('Missing operation hook');
  return {
    state,
    close: (): void => {
      for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup();
    },
  };
}

beforeEach(() => {
  useFileChangesStore.getState().reset();
  owned.data = undefined;
  owned.error = null;
  owned.query = undefined;
  owned.effects.length = 0;
  owned.invalidate.mockReset().mockResolvedValue();
  owned.setData.mockReset();
  owned.setData.mockImplementation(
    (
      _key: unknown,
      update: (current: FileChangeBatchReceipt | undefined) => FileChangeBatchReceipt,
    ): void => {
      owned.data = update(owned.data);
    },
  );
  owned.refetch.mockReset().mockResolvedValue();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('file operation acceptance and recovery', () => {
  it('blocks selected and whole-answer submissions for read-only history without creating intent', () => {
    const readonly = mount(false);
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    readonly.state.submit('undo', { kind: 'changes', changeIds: ['imported'] });
    readonly.state.submit('redo', { kind: 'answer', inputMessageId: 'imported-input' });
    expect(readonly.state.blocked).toBe(true);
    expect(useFileChangesStore.getState().unconfirmed).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
    readonly.close();
  });
  it('retains the same operation through a lost POST and GET404, then retries only on an explicit event', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error('socket closed'));
    vi.stubGlobal('fetch', fetch);
    const initial = mount();
    initial.state.submit('undo', { kind: 'answer', inputMessageId: 'original-root-input' });
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    const intent = useFileChangesStore.getState().unconfirmed.session;
    if (intent === undefined) throw new Error('Missing unconfirmed intent');
    initial.close();
    useFileChangesStore.getState().close();
    useFileChangesStore.getState().open('session', {});
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'not found' }), { status: 404 }),
    );
    const reopened = mount();
    const read = owned.query;
    if (read === undefined) throw new Error('Missing recovery query');
    expect(read.retry).toBe(false);
    expect(read.refetchInterval({ state: { data: undefined } })).toBe(1500);
    await expect(read.queryFn({ signal: new AbortController().signal })).rejects.toMatchObject({
      status: 404,
    });
    expect(useFileChangesStore.getState().unconfirmed.session).toEqual(intent);
    reopened.close();
    owned.error = new RequestError('not found', 404);
    const unknown = mount();
    expect(unknown.state.receptionUnknown).toBe(true);
    expect(unknown.state.canCancel).toBe(false);
    unknown.state.cancel();
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify(fileBatchFixture({ operationId: intent.operationId })), {
        status: 202,
      }),
    );
    unknown.state.retrySubmission();
    await vi.waitFor(() => {
      expect(useFileChangesStore.getState().unconfirmed.session).toBeUndefined();
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(intent));
    expect(fetch.mock.calls[2]?.[1]?.body).toBe(JSON.stringify(intent));
    expect(owned.setData).toHaveBeenCalledWith(
      ['file-change-operation', 'session', intent.operationId],
      expect.any(Function),
    );
    expect(owned.data?.status).toBe('accepted');
    unknown.close();
  });

  it('clears a definitively rejected selection but preserves an ID/body conflict as uncertain', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'FILE_CHANGE_LIMIT', message: '超过50项' }), {
        status: 400,
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const first = mount();
    first.state.submit('undo', { kind: 'answer', inputMessageId: 'input' });
    await vi.waitFor(() => {
      expect(useFileChangesStore.getState().unconfirmed.session).toBeUndefined();
    });
    expect(useFileChangesStore.getState().operationIds.session).toBeUndefined();
    first.close();
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'FILE_CHANGE_OPERATION_CONFLICT', message: 'ID/body conflict' }),
        { status: 409 },
      ),
    );
    const second = mount();
    second.state.submit('redo', { kind: 'changes', changeIds: ['older', 'newer'] });
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });
    expect(useFileChangesStore.getState().unconfirmed.session?.selection).toEqual({
      kind: 'changes',
      changeIds: ['older', 'newer'],
    });
    second.close();
  });

  it('enables cancellation only after acceptance and retains the durable receipt while cancelling', async () => {
    const receipt = fileBatchFixture({ status: 'running' });
    owned.data = receipt;
    useFileChangesStore.getState().inspect('session', receipt.operationId);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ...receipt, cancelRequested: true })));
    vi.stubGlobal('fetch', fetch);
    const view = mount();
    expect(view.state.canCancel).toBe(true);
    view.state.cancel();
    await vi.waitFor(() => {
      expect(owned.setData).toHaveBeenCalledWith(
        ['file-change-operation', 'session', receipt.operationId],
        expect.any(Function),
      );
    });
    expect(owned.data).toMatchObject({ cancelRequested: true, status: 'running' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/session/file-changes/operations/operation-one/cancel',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
    view.close();
  });

  it('does not resurrect acknowledged private facts when a POST finishes after dialog teardown and logout', async () => {
    let resolve: ((response: Response) => void) | undefined;
    const response = new Promise<Response>((finish) => {
      resolve = finish;
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(response);
    vi.stubGlobal('fetch', fetch);
    const view = mount();
    view.state.submit('undo', { kind: 'changes', changeIds: ['change-one'] });
    const intent = useFileChangesStore.getState().unconfirmed.session;
    if (intent === undefined || resolve === undefined) throw new Error('Missing pending fixture');
    view.close();
    useFileChangesStore.getState().reset();
    resolve(new Response(JSON.stringify(fileBatchFixture({ operationId: intent.operationId }))));
    await response;
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    expect(owned.setData).not.toHaveBeenCalled();
    expect(useFileChangesStore.getState()).toMatchObject({
      sessionId: null,
      unconfirmed: {},
      operationIds: {},
    });
  });
});
