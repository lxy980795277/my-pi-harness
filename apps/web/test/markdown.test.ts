import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Markdown } from '../src/components/markdown';
import { getMarkdownCode } from '../src/components/markdown/code-data';
import { canHighlightCode, highlightMarkdownCode } from '../src/components/markdown/code-highlight';
import { getMarkdownUrl } from '../src/components/markdown/markdown-url';

const render = (text: string, streaming = false): string => {
  return renderToStaticMarkup(createElement(Markdown, { text, streaming }));
};

describe('public assistant Markdown', () => {
  it.each([false, true])(
    'parses emphasis beside Chinese quotation marks (streaming=%s)',
    (streaming) => {
      const html = render(
        '- 你说的**“test”确实出现过两次**（搜索直接命中两条，都是你说的）',
        streaming,
      );
      expect(html).toContain('<strong>“test”确实出现过两次</strong>');
      expect(html).not.toContain('**');
    },
  );

  it.each([false, true])(
    'retains literal emphasis markers inside code and escapes (streaming=%s)',
    (streaming) => {
      const phrase = '**“test”确实出现过两次**';
      const inline = render('`' + phrase + '`', streaming);
      const fenced = render('```text\n' + phrase + '\n```', streaming);
      const escaped = render('\\*\\*“test”确实出现过两次\\*\\*', streaming);
      for (const html of [inline, fenced, escaped]) {
        expect(html).toContain(phrase);
        expect(html).not.toContain('<strong>');
      }
    },
  );

  it.each([false, true])(
    'parses Chinese punctuation around emphasis and URL boundaries (streaming=%s)',
    (streaming) => {
      const html = render(
        '**重要提示（Important Notice）：**请注意。\n\nhttps://example.com。这是说明。',
        streaming,
      );
      expect(html).toContain('<strong>重要提示（Important Notice）：</strong>');
      expect(html).toContain('href="https://example.com/"');
      expect(html).not.toContain('href="https://example.com。');
      expect(html).toContain('这是说明。');
    },
  );

  it('renders GFM and readable semantics instead of exposing formatting markers', () => {
    const html = render(
      [
        '## 结果',
        '',
        '**重点**和`行内代码`，~~删除~~。',
        '',
        '- 第一项',
        '- 第二项',
        '',
        '> 引用说明',
        '',
        '- [x] 已完成',
        '- [ ] 待处理',
        '',
        '| 文件 | 数量 |',
        '| :--- | ---: |',
        '| 示例 | 2 |',
      ].join('\n'),
    );
    expect(html).toContain('<h2');
    expect(html).toContain('>结果</h2>');
    expect(html).toContain('<strong');
    expect(html).toContain('<del>删除</del>');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<table>');
    expect(html).toContain('class="markdown__cell--right"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('style=');
  });

  it('keeps an unfinished fence readable and settles to the same final code as a historical message', () => {
    const partial = render('开始\n\n```js\nconst answer = 42;', true);
    expect(partial).toContain('<pre');
    expect(partial).toContain('const answer = 42;');
    expect(partial).toContain('data-incomplete="true"');
    const complete = '开始\n\n```js\nconst answer = 42;\nconsole.log(answer);\n```';
    const settled = render(complete);
    const streamed = render(complete, true);
    expect(settled).toContain('const answer = 42;\nconsole.log(answer);');
    expect(streamed).toContain('const answer = 42;\nconsole.log(answer);');
    expect(settled).toContain('aria-label="复制代码"');
    expect(settled).not.toContain('style=');
    expect(streamed).not.toContain('style=');
  });

  it('does not execute model HTML, render images or retain unsafe navigation destinations', () => {
    const html = render(
      [
        '<script>globalThis.markdownExecuted = true</script>',
        '',
        '<img src="https://untrusted.example/raw.png" onerror="alert(1)">',
        '',
        '[危险](javascript:alert%281%29)',
        '',
        '[实体](java&#x73;cript:alert%281%29)',
        '',
        '[文件](file:///etc/passwd)',
        '',
        '![流程图](https://untrusted.example/image.png)',
        '',
        '[文档](https://example.com/docs?q=安全)',
      ].join('\n'),
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror="');
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain('href="file:');
    expect(html).toContain('流程图');
    expect(html).toContain('href="https://untrusted.example/image.png"');
    expect(html).toContain('href="https://example.com/docs?q=%E5%AE%89%E5%85%A8"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('does not activate unfinished links while their destinations are being streamed', () => {
    const html = render('查看[使用说明](https://example.com', true);
    expect(html).toContain('使用说明');
    expect(html).not.toContain('href="https://example.com');
  });

  it('removes only the parser newline and retains user-authored blank lines in fenced code', () => {
    const child = createElement('code', { className: 'language-typescript' }, 'const x = 1;\n\n');
    expect(getMarkdownCode(child)).toEqual({ code: 'const x = 1;\n', language: 'typescript' });
    const html = render('```html\n<script>alert("escaped")</script>\n```');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('Markdown URL destinations', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,hello',
    'file:///Users/private.txt',
    '//example.com/path',
    '#fragment',
    '/workspace/file',
    'mailto:person@example.com',
    'https://user:pass@example.com',
    'https://example.com/\nnext',
    'https://example.com/ path',
  ])('leaves %s as text', (url) => {
    expect(getMarkdownUrl(url)).toBeUndefined();
  });

  it('normalizes an explicit web link and retains a fragment within that destination', () => {
    expect(getMarkdownUrl('HTTPS://EXAMPLE.COM/docs#section')).toBe(
      'https://example.com/docs#section',
    );
    expect(getMarkdownUrl(undefined)).toBeUndefined();
  });
});

describe('bounded Markdown code highlighting', () => {
  it('tokenizes real JavaScript into semantic React classes without modifying the code', async () => {
    const code = 'const answer = 42;\nconsole.log("你好"); // explanation';
    const lines = await highlightMarkdownCode(code, 'js');
    expect(lines).not.toBeNull();
    if (lines === null) {
      throw new Error('expected JavaScript highlighting');
    }
    const restored = lines
      .map((line) => {
        return line.tokens
          .map((token) => {
            return token.content;
          })
          .join('');
      })
      .join('\n');
    expect(restored).toBe(code);
    const classes = lines.flatMap((line) => {
      return line.tokens.map((token) => {
        return token.className;
      });
    });
    expect(classes).toContain('markdown-code__token--keyword');
    expect(classes).toContain('markdown-code__token--number');
    expect(classes).toContain('markdown-code__token--string');
    expect(classes).toContain('markdown-code__token--comment');
  });

  it('leaves unsupported, unfinished and oversized content readable without loading grammars', async () => {
    expect(canHighlightCode('const answer = 42;', 'js', true)).toBe(false);
    expect(canHighlightCode('sample', 'unrecognized-grammar', false)).toBe(false);
    expect(canHighlightCode('sample', 'constructor', false)).toBe(false);
    expect(canHighlightCode('sample', '__proto__', false)).toBe(false);
    expect(canHighlightCode('x'.repeat(20_001), 'js', false)).toBe(false);
    expect(canHighlightCode('x\n'.repeat(400), 'js', false)).toBe(false);
    expect(await highlightMarkdownCode('sample', 'unrecognized-grammar')).toBeNull();
    expect(await highlightMarkdownCode('x'.repeat(20_001), 'js')).toBeNull();
  });
});
