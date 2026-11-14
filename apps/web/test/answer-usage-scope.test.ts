import type { MessageView, SessionUsage } from '@my-pi-harness/protocol';
import { createElement, type FC } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnswerUsage } from '../src/features/usage/hooks/use-answer-usage';
import { buildAnswerFooters } from '../src/features/sessions/utils/answer-metadata';
import { usageFixture } from './fixtures/usage';

interface QueryRead {
  queryKey: readonly unknown[];
  queryFn: (context: { signal: AbortSignal }) => Promise<SessionUsage>;
}

const owned = vi.hoisted(() => {
  return { query: undefined as QueryRead | undefined, data: undefined as SessionUsage | undefined };
});

vi.mock('@tanstack/react-query', () => {
  return {
    useQuery: (query: QueryRead) => {
      owned.query = query;
      return { data: owned.data, isPending: false, error: null };
    },
  };
});

beforeEach(() => {
  owned.query = undefined;
  owned.data = usageFixture();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('inherited answer usage scope', () => {
  it('queries the original accepted input without filtering it through the currently viewed fork', async () => {
    const messages: MessageView[] = [
      {
        id: 'original-input',
        sessionId: 'session',
        branchId: 'original',
        runId: 'original-run',
        role: 'user',
        text: '原问题',
        thinking: '',
        createdAt: 1,
        status: 'complete',
        stopReason: null,
      },
      {
        id: 'original-answer',
        sessionId: 'session',
        branchId: 'original',
        runId: 'original-run',
        role: 'assistant',
        text: '原回答',
        thinking: '',
        createdAt: 2,
        finishedAt: 3,
        status: 'complete',
        stopReason: 'stop',
      },
    ];
    const footer = buildAnswerFooters(messages, [], null, 'viewed-fork').get('original-answer');
    if (footer === undefined) throw new Error('Missing inherited footer');
    const inputId = footer.inputId;
    const Probe: FC = () => {
      const text = useAnswerUsage('session', inputId);
      return createElement('span', null, text.tokensLabel);
    };
    expect(renderToStaticMarkup(createElement(Probe))).toContain('用量 1.1K tok');
    const query = owned.query;
    if (query === undefined) throw new Error('Missing usage query');
    expect(query.queryKey).toEqual([
      'usage',
      'session',
      { inputMessageId: 'original-input', includeDescendants: true },
    ]);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify(usageFixture())));
    vi.stubGlobal('fetch', fetch);
    await expect(query.queryFn({ signal: new AbortController().signal })).resolves.toEqual(
      usageFixture(),
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/session/usage?inputMessageId=original-input&includeDescendants=true',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
