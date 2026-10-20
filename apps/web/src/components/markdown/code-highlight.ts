import type { LanguageInput } from 'shiki/core';

import type { MarkdownCodeLine, MarkdownTokenKind } from './types';

const LANGUAGE_LOADERS: Record<string, () => Promise<LanguageInput>> = {
  bash: async () => {
    return await import('shiki/langs/bash.mjs');
  },
  css: async () => {
    return await import('shiki/langs/css.mjs');
  },
  diff: async () => {
    return await import('shiki/langs/diff.mjs');
  },
  go: async () => {
    return await import('shiki/langs/go.mjs');
  },
  html: async () => {
    return await import('shiki/langs/html.mjs');
  },
  javascript: async () => {
    return await import('shiki/langs/javascript.mjs');
  },
  json: async () => {
    return await import('shiki/langs/json.mjs');
  },
  jsx: async () => {
    return await import('shiki/langs/jsx.mjs');
  },
  markdown: async () => {
    return await import('shiki/langs/markdown.mjs');
  },
  python: async () => {
    return await import('shiki/langs/python.mjs');
  },
  rust: async () => {
    return await import('shiki/langs/rust.mjs');
  },
  sql: async () => {
    return await import('shiki/langs/sql.mjs');
  },
  tsx: async () => {
    return await import('shiki/langs/tsx.mjs');
  },
  typescript: async () => {
    return await import('shiki/langs/typescript.mjs');
  },
  yaml: async () => {
    return await import('shiki/langs/yaml.mjs');
  },
};
const LANGUAGE_ALIASES = new Map<string, string>([
  ['js', 'javascript'],
  ['ts', 'typescript'],
  ['py', 'python'],
  ['sh', 'bash'],
  ['shell', 'bash'],
  ['yml', 'yaml'],
  ['md', 'markdown'],
  ['rs', 'rust'],
]);
const MAX_HIGHLIGHT_CHARACTERS = 20_000;
const MAX_HIGHLIGHT_LINES = 400;

const resolveLanguage = (language: string): string => {
  const normalized = language.toLowerCase();
  return LANGUAGE_ALIASES.get(normalized) ?? normalized;
};

/** Unfinished fences, unknown languages and large blocks remain exact, unhighlighted text. */
export const canHighlightCode = (code: string, language: string, incomplete: boolean): boolean => {
  if (incomplete || code.length === 0 || code.length > MAX_HIGHLIGHT_CHARACTERS) {
    return false;
  }
  if (code.split('\n').length > MAX_HIGHLIGHT_LINES) {
    return false;
  }
  return Object.hasOwn(LANGUAGE_LOADERS, resolveLanguage(language));
};

const tokenKind = (scopes: string[]): MarkdownTokenKind => {
  if (
    scopes.some((scope) => {
      return scope.startsWith('comment');
    })
  ) {
    return 'comment';
  }
  if (
    scopes.some((scope) => {
      return scope.startsWith('string');
    })
  ) {
    return 'string';
  }
  if (
    scopes.some((scope) => {
      return scope.startsWith('constant.numeric');
    })
  ) {
    return 'number';
  }
  if (
    scopes.some((scope) => {
      return /^(?:keyword|storage|constant.language)/u.test(scope);
    })
  ) {
    return 'keyword';
  }
  if (
    scopes.some((scope) => {
      return scope.includes('entity.name.function');
    })
  ) {
    return 'function';
  }
  return 'plain';
};

/** Return React-ready text tokens; no model content enters generated HTML or inline CSS. */
export const highlightMarkdownCode = async (
  code: string,
  language: string,
): Promise<MarkdownCodeLine[] | null> => {
  const resolved = resolveLanguage(language);
  const loader = LANGUAGE_LOADERS[resolved];
  if (loader === undefined || !canHighlightCode(code, resolved, false)) {
    return null;
  }
  const { getMarkdownHighlighter } = await import('./code-highlighter');
  const highlighter = await getMarkdownHighlighter(loader);
  const result = highlighter.codeToTokens(code, {
    lang: resolved,
    theme: 'markdown-semantic',
    includeExplanation: 'scopeName',
    tokenizeMaxLineLength: 2_000,
  });
  return result.tokens.map((line, lineIndex) => {
    const fragments = line.flatMap((token) => {
      if (token.explanation === undefined || token.explanation.length === 0) {
        return [{ content: token.content, kind: 'plain' }];
      }
      return token.explanation.map((explanation) => {
        const scopes = explanation.scopes.map((scope) => {
          return scope.scopeName;
        });
        return { content: explanation.content, kind: tokenKind(scopes) };
      });
    });
    let ending = '\n';
    if (lineIndex === result.tokens.length - 1) {
      ending = '';
    }
    return {
      key: lineIndex,
      ending,
      tokens: fragments.map((token, tokenIndex) => {
        return {
          key: tokenIndex,
          content: token.content,
          className: `markdown-code__token--${token.kind}`,
        };
      }),
    };
  });
};
