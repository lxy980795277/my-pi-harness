import type { FileChangeSummary } from '@my-pi-harness/protocol';
import { CheckSquare, FileText, Square } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import {
  fileChangeSelectable,
  fileChangeSourceLabel,
  fileChangeStateLabel,
} from '@/features/file-changes/utils/file-change-view';
import { cn } from '@/utils/cn';

interface FileChangeRowProps {
  change: FileChangeSummary;
  selected: boolean;
  active: boolean;
  limitReached: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}

/** Intermediate chain entries remain selectable even if their single-file action is blocked. */
export const FileChangeRow: FC<FileChangeRowProps> = ({
  change,
  selected,
  active,
  limitReached,
  onSelect,
  onToggle,
}) => {
  const select = (): void => {
    onSelect(change.changeId);
  };
  const toggle = (): void => {
    onToggle(change.changeId);
  };
  return (
    <div className={cn('flex items-center gap-1 rounded-lg px-1 py-1', active && 'bg-muted')}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 rounded-md"
        onClick={toggle}
        aria-pressed={selected}
        aria-label={'选择变更 ' + change.path}
        disabled={!fileChangeSelectable(change) || (!selected && limitReached)}
      >
        {selected && <CheckSquare width={15} height={15} aria-hidden />}
        {!selected && <Square width={15} height={15} aria-hidden />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-md px-2 py-2 text-left font-normal"
        onClick={select}
        aria-pressed={active}
      >
        <FileText width={15} height={15} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block truncate text-xs" title={change.path}>
            {change.path}
          </span>
          <span
            className="block truncate text-[11px] text-muted-foreground"
            title={fileChangeSourceLabel(change)}
          >
            {fileChangeSourceLabel(change)}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {fileChangeStateLabel(change)}
        </span>
      </Button>
    </div>
  );
};
