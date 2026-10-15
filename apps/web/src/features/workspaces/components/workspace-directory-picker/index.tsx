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

/** The whole folder surface opens the native picker and accepts a single native directory drop. */
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
        className={cn('rounded-xl border border-dashed border-border', {
          'border-ring bg-accent text-accent-foreground': dragging,
        })}
        data-testid="workspace-directory-dropzone"
        aria-busy={pending}
        title={rootPath || undefined}
      >
        <Button
          id="workspace-directory"
          type="button"
          variant="ghost"
          onClick={choose}
          disabled={disabled || !editable || !available}
          aria-label="选择工作区文件夹"
          className="h-28 w-full min-w-0 flex-col gap-1.5 rounded-xl px-4 py-2 text-foreground disabled:opacity-100"
        >
          {pending && (
            <LoaderCircle
              width={20}
              height={20}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          )}
          {!pending && rootPath.length === 0 && (
            <FolderPlus width={20} height={20} className="text-muted-foreground" aria-hidden />
          )}
          {!pending && rootPath.length > 0 && <FolderOpen width={20} height={20} aria-hidden />}
          {pending && <span className="text-sm">正在选择文件夹…</span>}
          {!pending && rootPath.length === 0 && available && (
            <span className="text-sm text-muted-foreground">点击选择或拖入文件夹</span>
          )}
          {!pending && rootPath.length === 0 && !available && (
            <span className="text-sm text-muted-foreground">请在桌面应用中添加文件夹</span>
          )}
          {rootPath.length > 0 && (
            <span className="flex w-full min-w-0 flex-col items-center gap-0.5">
              <span className="max-w-full truncate text-xs leading-4 font-medium">
                {directoryName}
              </span>
              <span
                className="w-full truncate text-[11px] leading-4 text-muted-foreground"
                title={rootPath}
              >
                {rootPath}
              </span>
            </span>
          )}
          {!pending && rootPath.length > 0 && editable && (
            <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] leading-4 text-secondary-foreground">
              更换文件夹
            </span>
          )}
        </Button>
      </div>
    </div>
  );
};
