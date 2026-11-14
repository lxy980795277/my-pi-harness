import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TraceContentItem } from '../src/features/trace/components/trace-content-item';

describe('audited request content presentation', () => {
  it('keeps original text inert and does not request an image before explicit selection', () => {
    const markup = renderToStaticMarkup(
      createElement(TraceContentItem, {
        sessionId: 'session',
        requestId: 'request',
        item: {
          index: 0,
          offset: 0,
          role: 'user',
          text: '<script>alert(1)</script> **raw**',
          images: 2,
          truncated: false,
        },
      }),
    );
    expect(markup).toContain('&lt;script&gt;');
    expect(markup).toContain('**raw**');
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('<strong>');
    expect(markup).not.toContain('<img');
    expect(markup).toContain('查看图片 1');
    expect(markup).toContain('查看图片 2');
  });

  it('bounds image controls while retaining the actual count and pagination entry', () => {
    const markup = renderToStaticMarkup(
      createElement(TraceContentItem, {
        sessionId: 'session',
        requestId: 'request',
        item: {
          index: 1,
          offset: 8000,
          role: 'user',
          text: 'continued',
          images: 1000000,
          truncated: true,
        },
      }),
    );
    expect(markup.match(/查看图片/g)).toHaveLength(20);
    expect(markup).toContain('1000000');
    expect(markup).toContain('后20张');
    expect(markup).toContain('从字符 8000 继续');
    expect(markup).toContain('当前内容还有后续');
    expect(markup).not.toContain('<img');
  });
});
