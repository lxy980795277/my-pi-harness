import { fauxAssistantMessage, getCurrentTools } from '@earendil-works/pi-ai';
import type { SearchSourceExcerpt, SearchSourceSelection } from '@my-pi-harness/protocol';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeError } from '../src/errors';
import type { RunSearchPort } from '../src/runs/ports';
import { agentFixture, agentGate, agentsIdle, firstTask } from './support/agent-fixture';
import { call } from './support/work-fixture';
import { delegate, hasResult, waitForResults } from './support/agent-tools';

const body = 'CROSS_WORKSPACE_QUOTE_SOURCE';
const quote: SearchSourceSelection = {
  source: { id: 'message:quoted', kind: 'message', contentHash: 'a'.repeat(64) },
  target: {
    kind: 'message',
    sessionId: 'other',
    branchId: 'historical',
    messageId: 'quoted',
    taskId: 'explicit-task',
  },
  start: 0,
  end: body.length,
};

function excerpt(selection: SearchSourceSelection): SearchSourceExcerpt {
  return {
    ...selection,
    text: body.slice(selection.start, selection.end),
    totalLength: body.length,
    origin: selection.target.kind === 'message' && selection.target.taskId ? 'task' : 'assistant',
    role: 'assistant',
    status: 'complete',
    createdAt: 1,
  };
}

function port() {
  let valid = true;
  const read = vi.fn<RunSearchPort['readSearchSource']>((_context, selection) =>
    Promise.resolve(excerpt(selection)),
  );
  const result = vi.fn<RunSearchPort['searchSessions']>(() =>
    Promise.resolve({
      hits: [
        {
          source: quote.source,
          title: 'Other active root',
          workspaceId: null,
          sessionId: 'other',
          branchId: 'active',
          messageId: 'quoted',
          origin: 'assistant',
          status: 'complete',
          start: 1,
          end: 10,
          text: body.slice(1, 10),
          score: 1,
          createdAt: 1,
        },
      ],
      mode: 'lexical',
      truncated: false,
      generation: 1,
      watermark: 'b'.repeat(64),
    }),
  );
  const resolve = vi.fn<RunSearchPort['resolveQuote']>((_session, selection) => {
    if (!valid) throw new RuntimeError('SEARCH_SOURCE_CHANGED', 'Source changed');
    return excerpt(selection);
  });
  const validate = vi.fn<RunSearchPort['validateQuotes']>((context, selections) => {
    for (const selection of selections) resolve(context.sessionId, selection);
  });
  const search: RunSearchPort = {
    searchSessions: result,
    readSearchSource: read,
    resolveQuote: resolve,
    validateQuotes: validate,
  };
  return {
    search,
    read,
    result,
    resolve,
    validate,
    invalidate: () => {
      valid = false;
    },
  };
}

describe('historical source tools and consumed quotations through real Pi', () => {
  it('loads source tools on demand, scopes every host call to the root and does not inherit its tools or search results into children', async () => {
    const p = port();
    const f = await agentFixture({
      search: p.search,
      response: (context) => {
        const names = getCurrentTools(context.messages).map(({ name }) => name);
        if (firstTask(context) === 'CHILD_WITHOUT_HISTORY_ACCESS') {
          expect(names).not.toContain('search_sessions');
          expect(names).not.toContain('read_search_source');
          expect(JSON.stringify(context.messages)).not.toContain(body);
          if (!hasResult(context, 'tool_search'))
            return call(
              'tool_search',
              { query: 'read_search_source', limit: 1 },
              'child-history-search',
            );
          return fauxAssistantMessage('Child has no historical source grant');
        }
        if (!hasResult(context, 'search_sessions'))
          return names.includes('search_sessions')
            ? call('search_sessions', { query: 'previous answer', limit: 2 }, 'find-history')
            : call('tool_search', { query: 'search_sessions', limit: 1 }, 'load-history');
        if (!hasResult(context, 'read_search_source'))
          return names.includes('read_search_source')
            ? call(
                'read_search_source',
                { sourceId: quote.source.id, start: 0, end: body.length },
                'read-history',
              )
            : call('tool_search', { query: 'read_search_source', limit: 1 }, 'load-source-reader');
        if (!hasResult(context, 'spawn_agent'))
          return delegate('Isolated child', 'CHILD_WITHOUT_HISTORY_ACCESS');
        if (!hasResult(context, 'wait_agents')) return waitForResults(context);
        return fauxAssistantMessage('Historical root source was read');
      },
    });
    try {
      const accepted = await f.runtime.send(f.session.id, {
        text: 'Find another session answer',
        mode: 'send',
        requestId: 'historical-tool',
      });
      await agentsIdle(f);
      expect(p.result).toHaveBeenCalledTimes(1);
      expect(p.read).toHaveBeenCalledTimes(1);
      expect(p.result.mock.calls[0]?.[0]).toEqual({
        sessionId: f.session.id,
        branchId: f.session.activeBranchId,
        workspaceId: null,
        runId: accepted.runId,
      });
      expect(p.read.mock.calls[0]?.[2].kind).toBe('search');
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it.each(['steer', 'follow-up'] as const)(
    'grants exact quoted ranges only after edited %s consumption',
    async (mode) => {
      const p = port();
      const entered = agentGate();
      const release = agentGate();
      let requests = 0;

      const f = await agentFixture({
        search: p.search,
        memory: {
          readSnapshot: () => Promise.resolve({ fingerprint: 'c'.repeat(64), entries: [] }),
          isCurrent: () => true,
        },
        response: async (context) => {
          requests += 1;
          if (requests === 1) {
            entered.release();
            await release.promise;
            return fauxAssistantMessage('Initial ordinary answer');
          }
          expect(JSON.stringify(context.messages).split(body)).toHaveLength(2);
          const names = getCurrentTools(context.messages).map(({ name }) => name);
          if (!hasResult(context, 'read_search_source'))
            return names.includes('read_search_source')
              ? call(
                  'read_search_source',
                  { sourceId: quote.source.id, start: 1, end: body.length - 1 },
                  'read-quoted-selection',
                )
              : call(
                  'tool_search',
                  { query: 'read_search_source', limit: 1 },
                  'load-quoted-source',
                );
          return fauxAssistantMessage('Quoted material remains data');
        },
      });
      try {
        const accepted = await f.runtime.send(f.session.id, {
          text: 'Initial input',
          mode: 'send',
          requestId: 'initial-root',
        });
        await entered.promise;
        const queued = await f.runtime.send(f.session.id, {
          text: 'Use my selected reference',
          mode,
          requestId: 'quoted-queue',
          searchQuotes: [quote],
        });
        if (!queued.inputId) throw new Error('Missing quoted queue input');
        const metadata = f.store.getQueuePrivateData(f.session.id, queued.inputId);
        expect(metadata?.searchQuotes).toEqual([quote]);
        expect(p.read).not.toHaveBeenCalled();
        await f.runtime.updateQueue(f.session.id, queued.inputId, {
          text: 'Edited quoted request',
          revision: 1,
        });
        const current = f.runtime.getSnapshot(f.session.id).queue[0];
        expect(current?.text.split(body)).toHaveLength(2);
        expect(current?.text).not.toContain(quote.source.contentHash);
        if (!current || !metadata) throw new Error('Missing quote metadata');
        expect(() =>
          f.store.append(f.session.id, [
            {
              type: 'queue.updated',
              runId: accepted.runId,
              at: Date.now(),
              data: { ...current, revision: 3 },
              privateData: { ...metadata, searchQuotes: [{ ...quote, start: 1 }] },
            },
          ]),
        ).toThrow('frozen search quotations');
        release.release();
        await agentsIdle(f);
        expect(p.read).toHaveBeenCalledTimes(1);
        expect(p.read.mock.calls[0]?.[2]).toEqual({ kind: 'quote', selection: quote });
        const message = f.store
          .getSnapshot(f.session.id)
          .messages.find((item) => item.text.startsWith('Edited quoted request'));
        if (!message) throw new Error('Missing consumed quotation');
        expect(
          f.store.getModelContext(f.session.id, f.session.activeBranchId, [message.id])[0]?.[
            'searchQuotes'
          ],
        ).toEqual([quote]);
        expect(f.errors).toEqual([]);
      } finally {
        release.release();
        await f.close();
      }
    },
  );

  it('rejects unresolved references without model admission and returns old request IDs before resolving a changed source', async () => {
    const p = port();
    const f = await agentFixture({
      search: p.search,
      response: () => fauxAssistantMessage('Quoted answer'),
    });
    try {
      const accepted = await f.runtime.send(f.session.id, {
        text: '',
        mode: 'send',
        requestId: 'quote-only',
        searchQuotes: [quote],
      });
      await agentsIdle(f);
      const visible = f.runtime.getSnapshot(f.session.id).messages[0]?.text;
      expect(visible?.startsWith('请结合所选引用回答。')).toBe(true);
      expect(visible).toContain(body);
      expect(visible).not.toContain(quote.source.contentHash);
      p.invalidate();
      const before = f.leases().acquired;
      expect(
        await f.runtime.send(f.session.id, {
          text: '',
          mode: 'send',
          requestId: 'quote-only',
          searchQuotes: [quote],
        }),
      ).toEqual(accepted);
      await expect(
        f.runtime.send(f.session.id, {
          text: 'New attempt',
          mode: 'send',
          requestId: 'new-quote',
          searchQuotes: [quote],
        }),
      ).rejects.toMatchObject({ code: 'SEARCH_SOURCE_CHANGED' });
      expect(f.leases().acquired).toBe(before);
    } finally {
      await f.close();
    }
  });

  it('keeps a changed queued quotation unconsumed and refuses restored source access before a paid request', async () => {
    const p = port();
    const entered = agentGate();
    const release = agentGate();
    let requests = 0;
    const f = await agentFixture({
      search: p.search,
      response: async () => {
        requests += 1;
        entered.release();
        await release.promise;
        return fauxAssistantMessage('Initial response');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'Initial input',
        mode: 'send',
        requestId: 'source-start',
      });
      await entered.promise;
      const queued = await f.runtime.send(f.session.id, {
        text: 'Use selected source',
        mode: 'follow-up',
        requestId: 'stale-quoted-input',
        searchQuotes: [quote],
      });
      p.invalidate();
      release.release();
      await agentsIdle(f);
      const snapshot = f.store.getSnapshot(f.session.id);
      expect(snapshot.queue[0]?.id).toBe(queued.inputId);
      expect(snapshot.runs.at(-1)?.status).toBe('failed');
      expect(
        f.store.readEvents(f.session.id).some((event) => event.type === 'queue.consumed'),
      ).toBe(false);
      const before = f.leases().acquired;
      await expect(f.runtime.resumeQueue(f.session.id)).rejects.toMatchObject({
        code: 'SEARCH_SOURCE_CHANGED',
      });
      expect(f.leases().acquired).toBe(before);
      expect(requests).toBe(1);
    } finally {
      release.release();
      await f.close();
    }
  });

  it('does not activate a deleted pending quotation or leak its text into earlier model requests', async () => {
    const p = port();
    const entered = agentGate();
    const release = agentGate();
    let requests = 0;
    const f = await agentFixture({
      search: p.search,
      response: async (context) => {
        requests += 1;
        expect(JSON.stringify(context.messages)).not.toContain(body);
        if (requests === 1) {
          entered.release();
          await release.promise;
          return call(
            'tool_search',
            { query: 'read_search_source', limit: 1 },
            'load-reader-without-grant',
          );
        }
        if (!hasResult(context, 'read_search_source'))
          return call(
            'read_search_source',
            { sourceId: quote.source.id, start: 0, end: body.length },
            'guessed-source',
          );
        return fauxAssistantMessage('A pending deleted input grants nothing');
      },
    });
    try {
      await f.runtime.send(f.session.id, {
        text: 'Initial input',
        mode: 'send',
        requestId: 'pending-start',
      });
      await entered.promise;
      const queued = await f.runtime.send(f.session.id, {
        text: 'Pending source',
        mode: 'follow-up',
        requestId: 'removed-quoted-input',
        searchQuotes: [quote],
      });
      if (!queued.inputId) throw new Error('Missing pending source');
      await f.runtime.deleteQueue(f.session.id, queued.inputId);
      release.release();
      await agentsIdle(f);
      expect(p.read).not.toHaveBeenCalled();
      expect(f.errors).toEqual([]);
      expect(
        f.store.getSnapshot(f.session.id).tools.find((tool) => tool.name === 'read_search_source')
          ?.status,
      ).toBe('failed');
    } finally {
      release.release();
      await f.close();
    }
  });
});
