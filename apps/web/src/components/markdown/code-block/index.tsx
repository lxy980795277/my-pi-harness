import { Check, Copy } from 'lucide-react';
import { memo } from 'react';
import type { FC } from 'react';
import { useIsCodeFenceIncomplete } from 'streamdown';

import { Button } from '@/components/ui/button';

import type { MarkdownCodeData } from '../types';
import { useCopyText } from '@/hooks/use-copy-text';
import { useCodeHighlight } from './use-code-highlight';

/** Fenced code remains readable before highlighting loads and never injects HTML or styles. */
export const MarkdownCodeBlock: FC<MarkdownCodeData> = memo(({ code, language }) => {
  const incomplete = useIsCodeFenceIncomplete();
  const lines = useCodeHighlight(code, language, incomplete);
  const clipboard = useCopyText(code);
  let label = language;
  if (label.length === 0) {
    label = 'text';
  }
  return (
    <div className="markdown-code" data-language={language} data-incomplete={incomplete}>
      <div className="markdown-code__header">
        <span>{label}</span>
        <Button
          type="button"
          variant="ghost"
          className="h-7 gap-1.5 px-2"
          aria-label="复制代码"
          onClick={clipboard.copy}
          disabled={clipboard.pending}
        >
          {clipboard.copied && <Check aria-hidden="true" className="h-3.5 w-3.5" />}
          {!clipboard.copied && <Copy aria-hidden="true" className="h-3.5 w-3.5" />}
          {clipboard.copied && <span>已复制</span>}
          {!clipboard.copied && <span>复制</span>}
        </Button>
      </div>
      <pre className="markdown-code__body">
        <code>
          {lines === null && code}
          {lines !== null &&
            lines.map((line) => {
              return (
                <span className="markdown-code__line" key={line.key}>
                  {line.tokens.map((token) => {
                    return (
                      <span className={token.className} key={token.key}>
                        {token.content}
                      </span>
                    );
                  })}
                  {line.ending}
                </span>
              );
            })}
        </code>
      </pre>
      {clipboard.error !== null && (
        <div className="px-3 pb-2 text-xs text-error-foreground" role="alert">
          复制失败，请重试
        </div>
      )}
    </div>
  );
});
