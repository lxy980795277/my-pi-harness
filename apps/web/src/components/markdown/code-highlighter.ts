import { createHighlighterCore, makeSingletonHighlighterCore } from 'shiki/core';
import type { HighlighterCore, LanguageInput } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const highlighter = makeSingletonHighlighterCore(createHighlighterCore);
const engine = createJavaScriptRegexEngine();

/** Lazily share grammar data using the CSP-safe JavaScript engine, without a WASM dependency. */
export const getMarkdownHighlighter = async (
  language: () => Promise<LanguageInput>,
): Promise<HighlighterCore> => {
  const grammar = await language();
  return await highlighter({
    engine,
    themes: [{ name: 'markdown-semantic', type: 'light', settings: [] }],
    langs: [grammar],
  });
};
