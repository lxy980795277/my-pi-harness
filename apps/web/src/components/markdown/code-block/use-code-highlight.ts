import { useCallback, useEffect, useState } from 'react';

import { useAsyncEvent } from '@/hooks/use-async-event';

import { canHighlightCode, highlightMarkdownCode } from '../code-highlight';
import type { MarkdownCodeLine } from '../types';

interface HighlightResult {
  code: string;
  language: string;
  lines: MarkdownCodeLine[] | null;
}

/** Ignore stale completions and retry the newest eligible block after an in-flight grammar load. */
export const useCodeHighlight = (
  code: string,
  language: string,
  incomplete: boolean,
): MarkdownCodeLine[] | null => {
  const [result, setResult] = useState<HighlightResult | null>(null);
  const highlight = useCallback(
    async (signal: AbortSignal, nextCode: string, nextLanguage: string): Promise<void> => {
      let lines: MarkdownCodeLine[] | null = null;
      try {
        lines = await highlightMarkdownCode(nextCode, nextLanguage);
      } finally {
        if (!signal.aborted) {
          setResult({ code: nextCode, language: nextLanguage, lines });
        }
      }
    },
    [],
  );
  const { run, pending } = useAsyncEvent(highlight);
  const eligible = canHighlightCode(code, language, incomplete);
  const matches = result !== null && result.code === code && result.language === language;

  useEffect(() => {
    if (eligible && !matches && !pending) {
      run(code, language);
    }
  }, [code, language, eligible, matches, pending, run]);

  if (eligible && matches) {
    return result.lines;
  }
  return null;
};
