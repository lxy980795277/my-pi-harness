import type { MessageView } from '@my-pi-harness/protocol';
import { BookmarkPlus } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils/cn';

interface SaveMessageMemoryButtonProps {
  message: MessageView;
  onSave: (message: MessageView) => void;
  className?: string;
}

/** Manual saving edits a persisted message without sending another model request. */
export const SaveMessageMemoryButton: FC<SaveMessageMemoryButtonProps> = ({
  message,
  onSave,
  className,
}) => {
  if (message.text.trim().length === 0 || message.status === 'streaming') return null;
  const save = (): void => {
    onSave(message);
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('h-7 w-7 rounded-md', className)}
      onClick={save}
      aria-label="保存到长期记忆"
      title="保存到长期记忆"
    >
      <BookmarkPlus width={14} height={14} aria-hidden />
    </Button>
  );
};
