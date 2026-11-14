import type { FileChangeDetail } from '@my-pi-harness/protocol';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileChangeDetail as Detail } from '../src/features/file-changes/components/file-change-detail';
import { fileChangeFixture } from './fixtures/file-changes';

const owned = vi.hoisted(() => {
  return { data: undefined as FileChangeDetail | undefined, error: null as Error | null };
});
vi.mock('@tanstack/react-query', () => {
  return {
    useQuery: () => {
      return {
        data: owned.data,
        isPending: false,
        isError: owned.error !== null,
        error: owned.error,
      };
    },
  };
});

beforeEach(() => {
  owned.data = undefined;
  owned.error = null;
});

describe('bounded file snapshot reader', () => {
  it('keeps before/after navigation available when an expensive diff is refused', () => {
    owned.error = new Error('差异计算超过限制，请查看修改前后。');
    const html = renderToStaticMarkup(
      createElement(Detail, {
        sessionId: 'session',
        changeId: 'change-one',
        blocked: false,
        onBack: vi.fn(),
        onOperate: vi.fn(),
      }),
    );
    expect(html).toContain('差异计算超过限制');
    expect(html).toContain('修改前');
    expect(html).toContain('修改后');
    expect(html).toContain('role="tab"');
  });

  it('escapes snapshot text and distinguishes an absent preimage from a present empty file', () => {
    owned.data = {
      change: fileChangeFixture({
        before: { exists: false },
        after: { exists: true, sha256: 'a'.repeat(64), bytes: 0, mode: 0o644 },
      }),
      side: 'diff',
      text: '<script>window.attack()</script>',
      offset: 0,
      nextOffset: 10,
    };
    const html = renderToStaticMarkup(
      createElement(Detail, {
        sessionId: 'session',
        changeId: 'change-one',
        blocked: false,
        onBack: vi.fn(),
        onOperate: vi.fn(),
      }),
    );
    expect(html).toContain('&lt;script&gt;window.attack()&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('文件不存在');
    expect(html).toContain('0 字节');
    expect(html).toContain('下一段');
  });
});
