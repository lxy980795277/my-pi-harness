import type { Workspace } from '@my-pi-harness/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SearchResult } from '../src/features/search/components/search-result';
import { SourceReader } from '../src/features/search/components/source-reader';
import { sourceOriginLabel, sourceWorkspaceView } from '../src/features/search/utils/search';
import { SOURCE_HIT, SOURCE_SELECTION, SOURCE_WINDOW } from './fixtures/search';

const WORKSPACES: Workspace[] = [
  {
    id: 'workspace',
    name: '项目一',
    icon: 'folder',
    rootPath: '/synthetic/project-one',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'another-workspace',
    name: '项目二',
    icon: 'folder',
    rootPath: '/synthetic/project-two',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  },
];

const render = (element: ReactNode): string => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(['workspaces'], WORKSPACES);
  client.setQueryData(
    ['search-source', 'owner', SOURCE_SELECTION, { kind: 'selection' }],
    SOURCE_WINDOW,
  );
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, element));
  } finally {
    client.clear();
  }
};

describe('search source metadata', () => {
  it('names root roles once and retains the role distinction within tasks and communication', () => {
    expect(sourceOriginLabel({ origin: 'user', role: 'user' })).toBe('用户消息');
    expect(sourceOriginLabel({ origin: 'assistant', role: 'assistant' })).toBe('Agent 回答');
    expect(sourceOriginLabel({ origin: 'task', role: 'user' })).toBe('子任务 · 用户');
    expect(sourceOriginLabel({ origin: 'task', role: 'assistant' })).toBe('子任务 · Agent');
    expect(sourceOriginLabel({ origin: 'communication', role: 'assistant' })).toBe(
      '任务通信 · Agent',
    );
  });

  it('distinguishes equal titles and text by workspace names in results and reader headers', () => {
    const results = render(
      createElement(
        'div',
        null,
        createElement(SearchResult, { hit: SOURCE_HIT, onOpen: vi.fn() }),
        createElement(SearchResult, {
          hit: { ...SOURCE_HIT, workspaceId: 'another-workspace' },
          onOpen: vi.fn(),
        }),
      ),
    );
    expect(results).toContain('项目一');
    expect(results).toContain('项目二');
    expect(results).not.toContain('/synthetic');
    const reader = render(
      createElement(SourceReader, {
        ownerId: 'owner',
        selection: SOURCE_SELECTION,
        active: undefined,
        onBack: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    expect(reader).toContain('项目一');
    expect(reader).not.toContain('/synthetic');
  });

  it('labels unassigned sources and keeps unknown historical identifiers in an expandable detail', () => {
    expect(sourceWorkspaceView(null, WORKSPACES)).toEqual({
      label: '未分配工作区',
      detailId: null,
    });
    expect(sourceWorkspaceView('removed-workspace', WORKSPACES)).toEqual({
      label: '历史工作区',
      detailId: 'removed-workspace',
    });
    const html = render(
      createElement(SearchResult, {
        hit: { ...SOURCE_HIT, workspaceId: 'removed-workspace' },
        onOpen: vi.fn(),
      }),
    );
    expect(html).toContain('历史工作区');
    expect(html).toContain('工作区标识');
    expect(html.indexOf('removed-workspace')).toBeGreaterThan(html.indexOf('<details'));
    expect(html.indexOf('removed-workspace')).toBeLessThan(html.indexOf('</details>'));
  });
});
