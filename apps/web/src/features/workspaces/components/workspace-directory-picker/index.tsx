import { FolderOpen, FolderPlus, LoaderCircle } from 'lucide-react';
import type { DragEventHandler, FC } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/utils/cn';

interface WorkspaceDirectoryPickerProps {
  rootPath: string;
  directoryName: string;
  editable: boolean;
  available: boolean;
  pending: boolean;
  disabled: boolean;
  dragging: boolean;
  choose: () => void;
  dragEnter: DragEventHandler<HTMLDivElement>;
  dragLeave: DragEventHandler<HTMLDivElement>;
  dragOver: DragEventHandler<HTMLDivElement>;
  drop: DragEventHandler<HTMLDivElement>;
}

/** A centered button opens the native picker; the surrounding surface only accepts directory drops. */
export const WorkspaceDirectoryPicker: FC<WorkspaceDirectoryPickerProps> = ({
  rootPath,
  directoryName,
  editable,
  available,
  pending,
  disabled,
  dragging,
  choose,
  dragEnter,
  dragLeave,
  dragOver,
  drop,
}) => {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor="workspace-directory">源文件夹</Label>
      <div
        onDragEnter={dragEnter}
        onDragLeave={dragLeave}
        onDragOver={dragOver}
        onDrop={drop}
        className={cn(
          'flex h-28 min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-4 py-2',
          {
            'border-ring bg-accent text-accent-foreground': dragging,
          },
        )}
        data-testid="workspace-directory-dropzone"
        aria-busy={pending}
        title={rootPath || undefined}
      >
        {rootPath.length === 0 && available && (
          <span className="text-sm text-muted-foreground">在此电脑上添加文件夹</span>
        )}
        {rootPath.length === 0 && !available && (
          <span className="text-sm text-muted-foreground">请在桌面应用中添加文件夹</span>
        )}
        {rootPath.length > 0 && (
          <div className="flex w-full min-w-0 flex-col items-center gap-0.5">
            <span className="flex max-w-full items-center gap-1.5 text-xs leading-4 font-medium">
              <FolderOpen width={16} height={16} className="shrink-0" aria-hidden />
              <span className="truncate">{directoryName}</span>
            </span>
            <span
              className="w-full truncate text-center text-[11px] leading-4 text-muted-foreground"
              title={rootPath}
            >
              {rootPath}
            </span>
          </div>
        )}
        <Button
          id="workspace-directory"
          type="button"
          variant="secondary"
          onClick={choose}
          disabled={disabled || !editable || !available}
          aria-label="选择工作区文件夹"
          className="h-7 shrink-0 gap-1.5 rounded-full px-3 text-xs"
        >
          {pending && (
            <LoaderCircle
              width={14}
              height={14}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          )}
          {!pending && <FolderPlus width={14} height={14} aria-hidden />}
          {pending && '正在选择…'}
          {!pending && rootPath.length === 0 && '添加'}
          {!pending && rootPath.length > 0 && '更换文件夹'}
        </Button>
      </div>
    </div>
  );
};
