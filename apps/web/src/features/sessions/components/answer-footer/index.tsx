import type { MessageView } from '@my-pi-harness/protocol';
import { Check, Copy } from 'lucide-react';
import { memo, type FC } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { AnswerMetadata } from '@/features/sessions/components/answer-metadata';
import type { AnswerFooter as AnswerFooterFields } from '@/features/sessions/types/answer-metadata';
import { equalAnswerMetadata } from '@/features/sessions/utils/answer-metadata';
import { useCopyText } from '@/hooks/use-copy-text';
import { SaveMessageMemoryButton } from '@/features/memory/components/save-message-memory';

interface AnswerFooterProps {
  footer: AnswerFooterFields;
  onSaveMemory: (message: MessageView) => void;
}

/** One settled user turn shares a copy action and statistics across all assistant steps. */
export const AnswerFooter: FC<AnswerFooterProps> = memo(
  ({ footer, onSaveMemory }) => {
    const copy = useCopyText(footer.copyText);
    return (
      <div className="group/answer space-y-2" aria-label="回答操作">
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
          <SaveMessageMemoryButton
            message={footer.memoryMessage}
            onSave={onSaveMemory}
            className="pointer-events-none opacity-0 group-focus-within/answer:pointer-events-auto group-focus-within/answer:opacity-100 group-hover/answer:pointer-events-auto group-hover/answer:opacity-100"
          />
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
      previous.footer.memoryMessage === next.footer.memoryMessage &&
      previous.onSaveMemory === next.onSaveMemory &&
      equalAnswerMetadata(previous.footer.metadata, next.footer.metadata)
    );
  },
);
