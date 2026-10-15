import { useCallback, useRef, useState, type DragEvent, type DragEventHandler } from 'react';
import { readWorkspaceDrop } from '@/features/workspaces/utils/workspace-directory';
import { useAsyncEvent } from '@/hooks/use-async-event';

type DirectoryRequest = { kind: 'choose' } | { kind: 'drop'; files: readonly File[] };

interface WorkspaceDirectoryState {
  pending: boolean;
  error: string | null;
  choose: () => void;
  dragging: boolean;
  dragEnter: DragEventHandler<HTMLDivElement>;
  dragLeave: DragEventHandler<HTMLDivElement>;
  dragOver: DragEventHandler<HTMLDivElement>;
  drop: DragEventHandler<HTMLDivElement>;
}

/** One operation owns choosing and dropping, so a late selection cannot replace a newer request. */
export const useWorkspaceDirectory = (
  editable: boolean,
  disabled: boolean,
  onChoose: (directory: string) => void,
): WorkspaceDirectoryState => {
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const selection = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal, request: DirectoryRequest): Promise<void> => {
        if (!window.desktop) {
          throw new Error('请在桌面应用中添加文件夹。');
        }
        let directory: string | null;
        if (request.kind === 'drop') {
          directory = await window.desktop.getDroppedWorkspaceDirectory(
            readWorkspaceDrop(request.files),
          );
        } else {
          directory = await window.desktop.chooseWorkspaceDirectory();
        }
        signal.throwIfAborted();
        if (directory !== null) {
          onChoose(directory);
        }
      },
      [onChoose],
    ),
  );
  const { run } = selection;
  const choose = useCallback((): void => {
    if (editable && !disabled) {
      run({ kind: 'choose' });
    }
  }, [disabled, editable, run]);
  const dragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      if (
        editable &&
        !disabled &&
        !selection.pending &&
        event.dataTransfer.types.includes('Files')
      ) {
        depth.current += 1;
        setDragging(true);
      }
    },
    [disabled, editable, selection.pending],
  );
  const dragLeave = useCallback((event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) {
      setDragging(false);
    }
  }, []);
  const dragOver = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'none';
      if (editable && !disabled && !selection.pending) {
        event.dataTransfer.dropEffect = 'copy';
      }
    },
    [disabled, editable, selection.pending],
  );
  const drop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      depth.current = 0;
      setDragging(false);
      if (editable && !disabled) {
        run({ kind: 'drop', files: Array.from(event.dataTransfer.files) });
      }
    },
    [disabled, editable, run],
  );
  return {
    pending: selection.pending,
    error: selection.error,
    choose,
    dragging,
    dragEnter,
    dragLeave,
    dragOver,
    drop,
  };
};
