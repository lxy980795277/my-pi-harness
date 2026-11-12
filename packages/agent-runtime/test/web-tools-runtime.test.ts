import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { text as streamText } from 'node:stream/consumers';
import { expect, it, vi } from 'vitest';
import type { WebToolHandlers } from '@my-pi-harness/tools';
import { agentFixture, agentsIdle, firstTask } from './support/agent-fixture';
import { delegate, hasResult, waitForResults } from './support/agent-tools';
import { call } from './support/work-fixture';

it('binds public search and page services to root and read-only child loops while preserving canonical results', async () => {
  const search = vi.fn<WebToolHandlers['search']>(() => Promise.resolve({ results: [] }));
  const fetchPage = vi.fn<WebToolHandlers['fetchPage']>(({ url }) =>
    Promise.resolve({
      url,
      title: 'Public article',
      content: '# Observed evidence\nPublic source text.',
    }),
  );
  const f = await agentFixture({
    approvalMode: 'full-access',
    web: { search, fetchPage },
    response: (context) => {
      const declarations = context.messages.flatMap((message) =>
        message.role === 'system' ? (message.toolsAdded ?? []).map(({ name }) => name) : [],
      );
      expect(declarations).toContain('web_search');
      expect(declarations).toContain('web_fetch');
      if (firstTask(context) === 'PUBLIC_WEB_CHILD') {
        if (!hasResult(context, 'web_search'))
          return call('web_search', { query: 'Child public source', count: 3 }, 'child-search');
        const reads = context.messages.filter(
          (message) => message.role === 'toolResult' && message.toolName === 'web_fetch',
        ).length;
        if (reads === 0)
          return call(
            'web_fetch',
            {
              mode: 'page',
              url: 'https://example.com/article',
            },
            'child-page',
          );
        if (reads === 1) expect(JSON.stringify(context.messages)).toContain('# Observed evidence');
        if (reads === 1)
          return call(
            'web_fetch',
            {
              mode: 'raw',
              url: 'https://example.com/api',
              method: 'POST',
              body: '{}',
            },
            'child-write',
          );
        return fauxAssistantMessage('Child read public evidence; write denied.');
      }
      if (!hasResult(context, 'web_search'))
        return call('web_search', { query: 'Root public source' }, 'root-search');
      if (!hasResult(context, 'web_fetch'))
        return call(
          'web_fetch',
          {
            mode: 'page',
            url: 'https://example.com/root-article',
          },
          'root-page',
        );
      expect(JSON.stringify(context.messages)).toContain('# Observed evidence');
      if (!hasResult(context, 'spawn_agent'))
        return delegate('Read public source', 'PUBLIC_WEB_CHILD');
      if (!hasResult(context, 'wait_agents')) return waitForResults(context);
      return fauxAssistantMessage('Collected public evidence.');
    },
  });
  try {
    await f.runtime.send(f.session.id, {
      text: 'Find and read public source evidence.',
      mode: 'send',
      requestId: 'public-web-loop',
    });
    await agentsIdle(f);
    expect(search).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(search.mock.calls.map(([input]) => input.query)).toEqual([
      'Root public source',
      'Child public source',
    ]);
    expect(fetchPage.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
    const root = f.runtime.getSnapshot(f.session.id);
    expect(root.tools.find(({ name }) => name === 'web_search')).toMatchObject({
      status: 'completed',
      approval: { source: 'full-access', decision: 'allow' },
    });
    expect(root.tools.find(({ name }) => name === 'web_search')?.result).toContain('Results: 0');
    const task = f.runtime.subagents.list(f.session.id).tasks[0];
    if (!task) throw new Error('Missing public web task');
    const child = f.store.getTaskSnapshot(f.session.id, task.id);
    expect(child.runs[0]?.status).toBe('completed');
    expect(child.tools.filter(({ name }) => name === 'web_fetch')).toMatchObject([
      { status: 'completed' },
      { status: 'denied', result: '当前运行仅允许只读操作。' },
    ]);
    expect(child.tools.find(({ name }) => name === 'web_fetch')?.result).toContain(
      '# Observed evidence',
    );
    expect(child.tools.some(({ status }) => status === 'awaiting_approval')).toBe(false);
    const journal = await streamText(f.store.exportSessionLog(f.session.id).content);
    expect(journal).toContain('web_search');
    expect(journal).toContain('# Observed evidence');
    expect(journal).toContain('https://example.com/root-article');
    expect(journal).toContain('https://example.com/article');
    expect(journal).not.toContain('Authorization');
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
