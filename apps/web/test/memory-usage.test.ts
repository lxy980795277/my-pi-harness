import type { MemoryCurrentStatus, MemorySettings, MemoryUsage } from '@my-pi-harness/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MemoryUsagePanel } from '../src/features/memory/components/memory-usage';

const USAGE: MemoryUsage = {
  sessionId: 'session',
  runId: 'run',
  preparedSeq: 5,
  preparedAt: 1,
  entries: [
    {
      id: 'adopted',
      scope: { kind: 'user' },
      category: 'fact',
      body: '历史请求实际采用的正文',
      revision: 1,
      source: { kind: 'manual' },
      mode: 'fixed',
    },
  ],
};
const SETTINGS: MemorySettings = { allowUse: true, allowLearning: false, revision: 1 };

const render = (usage: MemoryUsage, current: MemoryCurrentStatus[]): string => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['memory-usage', 'session', 'run'], usage);
  client.setQueryData(['memory-current', ['adopted']], current);
  client.setQueryData(['memory-settings'], SETTINGS);
  client.setQueryData(['memories', 'user', 'all', null], {
    items: [],
    nextCursor: 'another-memory',
    total: 300,
  });
  try {
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(MemoryUsagePanel, { sessionId: 'session', runId: 'run', running: false }),
      ),
    );
  } finally {
    client.clear();
  }
};

describe('frozen memory adoption disclosure', () => {
  it('keeps historical body and mode while annotating later changes independently of list pages', () => {
    const html = render(USAGE, [{ id: 'adopted', revision: 2, enabled: true, mode: 'relevant' }]);
    expect(html).toContain('历史请求实际采用的正文');
    expect(html).toContain('固定采用');
    expect(html).toContain('当前已改为相关时采用');
    expect(html).not.toContain('当前已忘记');
  });

  it('describes budget and incomplete retrieval separately from low relevance without inventing omitted bodies', () => {
    const html = render(
      {
        ...USAGE,
        selection: {
          retrieval: 'hybrid',
          candidateCount: 4,
          matchedCount: 2,
          omittedCount: 3,
          truncated: true,
          omissions: [
            { id: 'over-budget', revision: 3, mode: 'relevant', reason: 'budget' },
            { id: 'unseen', revision: 4, mode: 'relevant', reason: 'not-retrieved' },
          ],
        },
      },
      [{ id: 'adopted', revision: null, enabled: false, mode: null }],
    );
    expect(html).toContain('混合匹配');
    expect(html).toContain('本次记忆额度不足');
    expect(html).toContain('本次未检索到');
    expect(html).toContain('本次检索未覆盖全部记忆');
    expect(html).toContain('另有 1 项未采用');
    expect(html).not.toContain('未达到相关性门槛');
    expect(html).toContain('当前已忘记');
    expect(html).toContain('历史请求实际采用的正文');
  });

  it('shows missing historical selection metadata as unrecorded rather than zero candidates', () => {
    const html = render(USAGE, [{ id: 'adopted', revision: 1, enabled: true, mode: 'fixed' }]);
    expect(html).toContain('本次未记录记忆选择过程');
    expect(html).not.toContain('候选 0 项');
  });

  it('reports unavailable verification separately from a low relevance decision', () => {
    const html = render(
      {
        ...USAGE,
        selection: {
          retrieval: 'hybrid',
          verification: 'unavailable',
          candidateCount: 2,
          matchedCount: 1,
          omittedCount: 1,
          omissions: [{ id: 'unverified', revision: 1, mode: 'relevant', reason: 'unverified' }],
        },
      },
      [{ id: 'adopted', revision: 1, enabled: true, mode: 'fixed' }],
    );
    expect(html).toContain('相关性复核不可用，未核验的相关记忆未采用');
    expect(html).toContain('未完成本地相关性复核');
    expect(html).toContain('历史请求实际采用的正文');
    expect(html).not.toContain('未达到相关性门槛');
  });

  it.each([
    ['local-model', '已完成本地相关性复核'],
    ['not-needed', '本次无需相关性复核'],
    [undefined, '本次未记录相关性复核情况'],
  ] as const)(
    'preserves historical verification %s without consulting current resource state',
    (verification, label) => {
      const selection: NonNullable<MemoryUsage['selection']> = {
        retrieval: 'fixed',
        candidateCount: 1,
        matchedCount: 1,
        omittedCount: 0,
        omissions: [],
      };
      if (verification !== undefined) selection.verification = verification;
      const html = render({ ...USAGE, selection }, [
        { id: 'adopted', revision: 1, enabled: true, mode: 'fixed' },
      ]);
      expect(html).toContain(label);
      expect(html).toContain('历史请求实际采用的正文');
    },
  );
});
