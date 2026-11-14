import { FileDiff } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { useFileChangeEntry } from '@/features/file-changes/hooks/use-file-change-entry';
import type { FileChangeScope } from '@/features/file-changes/stores/file-changes';
import { cn } from '@/utils/cn';

interface FileChangeEntryProps {
  sessionId: string;
  scope?: FileChangeScope;
  label?: string;
  iconOnly?: boolean;
  className?: string;
  closeOnUnmount?: boolean;
}

/** Public entry shared by the session header, a recorded write tool and an answer footer. */
export const FileChangeEntry: FC<FileChangeEntryProps> = ({
  sessionId,
  scope,
  label = '文件变更',
  iconOnly = false,
  className,
  closeOnUnmount = false,
}) => {
  const show = useFileChangeEntry(sessionId, scope, closeOnUnmount);
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn('h-8 gap-1.5 rounded-full px-2 text-xs', className)}
      onClick={show}
      aria-label={label}
      title={label}
    >
      <FileDiff width={14} height={14} aria-hidden />
      {!iconOnly && <span className="max-sm:sr-only">变更</span>}
    </Button>
  );
};
