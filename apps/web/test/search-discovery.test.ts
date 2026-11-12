import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SourceExcerpt } from '../src/features/search/components/source-excerpt';
import type { SearchFilters } from '../src/features/search/types/search';
import {
  searchInput,
  selectionFromHit,
  sourceSelectionKey,
} from '../src/features/search/utils/search';
import {
  quotedSourceText,
  sourceMatchesCurrentMessage,
  verifiedTimelineTarget,
} from '../src/features/search/utils/source-text';
import {
  SOURCE_HIT,
  SOURCE_SELECTION,
  SOURCE_SNAPSHOT,
  SOURCE_TEXT,
  SOURCE_WINDOW,
} from './fixtures/search';

const FILTERS: SearchFilters = {
  query: ' 原文 ',
  kind: 'message',
  workspace: 'current',
  period: 'all',
  archived: false,
  historical: false,
  tasks: false,
  userMemories: true,
  branchId: 'visible',
};

describe('scoped source discovery', () => {
  it('defaults to current visible roots and requires explicit filters for broader history', () => {
    expect(searchInput(FILTERS, 'workspace', 'session', 10_000_000_000)).toEqual({
      query: '原文',
      limit: 30,
      scope: {
        kind: 'message',
        workspaceId: 'workspace',
        includeArchived: false,
        includeHistoricalBranches: false,
        includeTasks: false,
      },
    });
    expect(
      searchInput(
        {
          ...FILTERS,
          workspace: 'all',
          archived: true,
          historical: true,
          tasks: true,
          period: 'week',
        },
        null,
        null,
        10_000_000_000,
      ).scope,
    ).toMatchObject({
      allWorkspaces: true,
      includeArchived: true,
      includeHistoricalBranches: true,
      includeTasks: true,
      createdFrom: 10_000_000_000 - 7 * 86_400_000,
      createdTo: 10_000_000_000,
    });
    expect(
      searchInput({ ...FILTERS, branchId: 'historical' }, 'workspace', 'session', 10_000_000_000)
        .scope,
    ).toMatchObject({
      sessionId: 'session',
      branchId: 'historical',
      includeHistoricalBranches: true,
    });
    expect(() => searchInput({ ...FILTERS, branchId: 'historical' }, null, null, 1)).toThrow(
      '会话已变化',
    );
  });

  it('keeps identical text from distinct memberships separate and never invents missing locators', () => {
    const first = selectionFromHit(SOURCE_HIT);
    const second = selectionFromHit({ ...SOURCE_HIT, branchId: 'another-branch', taskId: 'task' });
    expect(sourceSelectionKey(first)).not.toBe(sourceSelectionKey(second));
    expect(first).toEqual(SOURCE_SELECTION);
    const missing = { ...SOURCE_HIT };
    delete missing.messageId;
    expect(() => selectionFromHit(missing)).toThrow('准确消息位置');
    expect(quotedSourceText(SOURCE_WINDOW, first)).toBe(SOURCE_TEXT);
    expect(quotedSourceText(SOURCE_WINDOW, second)).toBeNull();
  });

  it('verifies the full current text and rechecks latest branch and text after asynchronous hashing', async () => {
    const signal = new AbortController().signal;
    await expect(
      verifiedTimelineTarget(SOURCE_SELECTION, SOURCE_SNAPSHOT, () => SOURCE_SNAPSHOT, signal),
    ).resolves.toEqual(SOURCE_SELECTION.target);
    const old = {
      ...SOURCE_SNAPSHOT,
      messages: SOURCE_SNAPSHOT.messages.map((message) => {
        return { ...message, text: '同 ID 的旧正文' };
      }),
    };
    await expect(sourceMatchesCurrentMessage(SOURCE_SELECTION, old)).resolves.toBe(false);
    await expect(
      verifiedTimelineTarget(SOURCE_SELECTION, SOURCE_SNAPSHOT, () => old, signal),
    ).rejects.toThrow('当前对话已变化');
    const switched = {
      ...SOURCE_SNAPSHOT,
      session: { ...SOURCE_SNAPSHOT.session, activeBranchId: 'different' },
    };
    await expect(
      verifiedTimelineTarget(SOURCE_SELECTION, SOURCE_SNAPSHOT, () => switched, signal),
    ).rejects.toThrow('当前对话已变化');
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      verifiedTimelineTarget(
        SOURCE_SELECTION,
        SOURCE_SNAPSHOT,
        () => SOURCE_SNAPSHOT,
        cancelled.signal,
      ),
    ).rejects.toThrow();
  });

  it('renders inert bounded source text without editing, memory saving or execution controls', () => {
    const source = SOURCE_WINDOW.items[0];
    if (source === undefined) throw new Error('Missing fixture');
    const html = renderToStaticMarkup(
      createElement(SourceExcerpt, {
        excerpt: { ...source, text: '<script>原文引用</script>' },
        onQuote: vi.fn(),
        disabled: false,
      }),
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('编辑');
    expect(html).not.toContain('保存到长期记忆');
    expect(html).not.toContain('允许本次操作');
  });
});
