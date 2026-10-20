import { Check, Copy } from 'lucide-react';
import { memo, type FC } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { AnswerMetadata } from '@/features/sessions/components/answer-metadata';
import type { AnswerFooter as AnswerFooterFields } from '@/features/sessions/types/answer-metadata';
import { equalAnswerMetadata } from '@/features/sessions/utils/answer-metadata';
import { useCopyText } from '@/hooks/use-copy-text';

interface AnswerFooterProps {
  footer: AnswerFooterFields;
}

/** One settled user turn shares a copy action and statistics across all assistant steps. */
export const AnswerFooter: FC<AnswerFooterProps> = memo(
  ({ footer }) => {
    const copy = useCopyText(footer.copyText);
    return (
      <div className="space-y-2" aria-label="回答操作">
        <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md"
            onClick={copy.copy}
            disabled={copy.pending}
            aria-label="复制回答"
            title="复制回答"
          >
            {copy.copied && <Check width={14} height={14} aria-hidden />}
            {!copy.copied && <Copy width={14} height={14} aria-hidden />}
          </Button>
          <AnswerMetadata metadata={footer.metadata} />
          {copy.copied && <span role="status">已复制</span>}
        </div>
        {copy.error && <Notice tone="error">{copy.error}</Notice>}
      </div>
    );
  },
  (previous, next) => {
    return (
      previous.footer.inputId === next.footer.inputId &&
      previous.footer.copyText === next.footer.copyText &&
      equalAnswerMetadata(previous.footer.metadata, next.footer.metadata)
    );
  },
);
