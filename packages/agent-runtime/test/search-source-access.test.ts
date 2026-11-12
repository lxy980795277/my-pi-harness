import type {
  SearchHit,
  SearchSourceExcerpt,
  SearchSourceSelection,
} from '@my-pi-harness/protocol';
import { expect, it, vi } from 'vitest';
import { RuntimeError } from '../src/errors';
import { RunSourceAccess } from '../src/runs/search';
import type { RunSearchContext, RunSearchPort } from '../src/runs/ports';
import { agentGate } from './support/agent-fixture';

const body = '0123456789'.repeat(12);
const selection: SearchSourceSelection = {
  source: { id: 'message:other', kind: 'message', contentHash: 'a'.repeat(64) },
  target: { kind: 'message', sessionId: 'other', branchId: 'branch', messageId: 'message' },
  start: 10,
  end: 20,
};
const context: RunSearchContext = {
  sessionId: 'current',
  branchId: 'main',
  runId: 'run',
  workspaceId: null,
};
const hit: SearchHit = {
  source: selection.source,
  title: 'Other session',
  workspaceId: null,
  sessionId: 'other',
  branchId: 'branch',
  messageId: 'message',
  origin: 'assistant',
  status: 'complete',
  start: 10,
  end: 20,
  text: body.slice(10, 20),
  score: 1,
  createdAt: 1,
};

function excerpt(input: SearchSourceSelection): SearchSourceExcerpt {
  return {
    ...input,
    text: body.slice(input.start, input.end),
    totalLength: body.length,
    origin: 'assistant',
    role: 'assistant',
    status: 'complete',
    createdAt: 1,
  };
}

function fixture() {
  let valid = true;
  const read = vi.fn<RunSearchPort['readSearchSource']>((_context, input) =>
    Promise.resolve(excerpt(input)),
  );
  const port: RunSearchPort = {
    searchSessions: () =>
      Promise.resolve({
        hits: [hit],
        mode: 'lexical',
        truncated: false,
        generation: 1,
        watermark: 'b'.repeat(64),
      }),
    readSearchSource: read,
    resolveQuote: (_session, input) => excerpt(input),
    validateQuotes: (_context, quotes) => {
      if (!valid && quotes.length)
        throw new RuntimeError('SEARCH_SOURCE_CHANGED', 'Source changed');
    },
  };
  const controller = new AbortController();
  const owner = new RunSourceAccess(port, context, controller.signal);
  return {
    port,
    read,
    owner,
    handlers: owner.handlers(),
    controller,
    invalidate: () => {
      valid = false;
    },
  };
}

it('does not accept guessed source IDs but permits bounded wider reads after a real search result', async () => {
  const f = fixture();
  const signal = f.controller.signal;
  await expect(f.handlers.read(selection.source.id, 0, 40, signal)).rejects.toMatchObject({
    code: 'SEARCH_SOURCE_NOT_GRANTED',
  });
  expect(f.read).not.toHaveBeenCalled();
  await f.handlers.search('other answer', 8, signal);
  expect(await f.handlers.read(selection.source.id, 0, 40, signal)).toMatchObject({
    start: 0,
    end: 40,
    text: body.slice(0, 40),
  });
  expect(f.read).toHaveBeenCalledExactlyOnceWith(
    context,
    { ...selection, start: 0, end: 40 },
    { kind: 'search', selection },
    expect.any(AbortSignal),
  );
  await expect(f.handlers.read(selection.source.id, 0, 8001, signal)).rejects.toMatchObject({
    code: 'SEARCH_RANGE_INVALID',
  });
});

it('keeps source-wide search eligibility across chunk hits without losing conflicting versions', async () => {
  const f = fixture();
  const hits: SearchHit[] = [hit, { ...hit, start: 30, end: 40, text: body.slice(30, 40) }];
  f.port.searchSessions = () =>
    Promise.resolve({
      hits,
      mode: 'lexical',
      truncated: false,
      generation: 1,
      watermark: 'b'.repeat(64),
    });
  await f.handlers.search('other answer', 8, f.controller.signal);
  await expect(
    f.handlers.read(selection.source.id, 50, 80, f.controller.signal),
  ).resolves.toMatchObject({ text: body.slice(50, 80) });
  hits.push({ ...hit, source: { ...hit.source, contentHash: 'c'.repeat(64) } });
  await f.handlers.search('changed answer', 8, f.controller.signal);
  await expect(
    f.handlers.read(selection.source.id, 50, 80, f.controller.signal),
  ).rejects.toMatchObject({ code: 'SEARCH_SOURCE_AMBIGUOUS' });
  expect(f.read).toHaveBeenCalledTimes(1);
});

it('activates only consumed quotation ranges without joining separate selections', async () => {
  const f = fixture();
  const signal = f.controller.signal;
  await expect(f.handlers.read(selection.source.id, 10, 20, signal)).rejects.toMatchObject({
    code: 'SEARCH_SOURCE_NOT_GRANTED',
  });
  f.owner.consume([selection, { ...selection, start: 20, end: 30 }]);
  await expect(f.handlers.read(selection.source.id, 11, 19, signal)).resolves.toMatchObject({
    start: 11,
    end: 19,
  });
  await expect(f.handlers.read(selection.source.id, 10, 30, signal)).rejects.toMatchObject({
    code: 'SEARCH_SOURCE_NOT_GRANTED',
  });
  await expect(f.handlers.read(selection.source.id, 0, 20, signal)).rejects.toMatchObject({
    code: 'SEARCH_SOURCE_NOT_GRANTED',
  });
});

it("does not reuse another Run's discovered source eligibility", async () => {
  const f = fixture();
  await f.handlers.search('other answer', 8, f.controller.signal);
  const next = new RunSourceAccess(f.port, { ...context, runId: 'next-run' }, f.controller.signal);
  await expect(
    next.handlers().read(selection.source.id, 10, 20, f.controller.signal),
  ).rejects.toMatchObject({ code: 'SEARCH_SOURCE_NOT_GRANTED' });
  expect(f.read).not.toHaveBeenCalled();
});

it('prefers a covering exact quote over an older default search grant without broadening it', async () => {
  const f = fixture();
  await f.handlers.search('other', 8, f.controller.signal);
  f.owner.consume([selection]);
  f.read.mockImplementation((_context, input, grant) => {
    if (grant.kind === 'search')
      throw new RuntimeError('SEARCH_SOURCE_CHANGED', 'The default source is now archived');
    return Promise.resolve(excerpt(input));
  });
  await expect(
    f.handlers.read(selection.source.id, 10, 20, f.controller.signal),
  ).resolves.toMatchObject({ text: body.slice(10, 20) });
  expect(f.read.mock.calls.at(-1)?.[2].kind).toBe('quote');
});

it.each(['contentHash', 'branchId'] as const)(
  'rejects ambiguous %s instead of choosing a different source version or branch',
  async (change) => {
    const f = fixture();
    const conflicting = structuredClone(selection);
    if (change === 'contentHash') conflicting.source.contentHash = 'c'.repeat(64);
    else if (conflicting.target.kind === 'message') conflicting.target.branchId = 'other-branch';
    f.owner.consume([selection, conflicting]);
    await expect(
      f.handlers.read(selection.source.id, 10, 20, f.controller.signal),
    ).rejects.toMatchObject({ code: 'SEARCH_SOURCE_AMBIGUOUS' });
    expect(f.read).not.toHaveBeenCalled();
  },
);

it.each(['changed', 'cancelled'] as const)(
  'discards an awaited source result after the quote is %s',
  async (reason) => {
    const f = fixture();
    const entered = agentGate();
    const release = agentGate();
    f.owner.consume([selection]);
    f.read.mockImplementation(async (_context, input) => {
      entered.release();
      await release.promise;
      return excerpt(input);
    });
    const pending = f.handlers.read(selection.source.id, 10, 20, f.controller.signal);
    try {
      await entered.promise;
      if (reason === 'changed') f.invalidate();
      else f.controller.abort();
      const rejected = expect(pending).rejects.toMatchObject(
        reason === 'changed' ? { code: 'SEARCH_SOURCE_CHANGED' } : { name: 'AbortError' },
      );
      release.release();
      await rejected;
    } finally {
      release.release();
    }
  },
);
