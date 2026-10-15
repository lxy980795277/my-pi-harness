import type { Workspace, WorkspaceIcon } from '@my-pi-harness/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type ChangeEvent, type FormEvent } from 'react';
import { useWorkspaceStore } from '@/app/stores/workspace';
import { useWorkspaceDirectory } from '@/features/workspaces/hooks/use-workspace-directory';
import { createWorkspace, renameWorkspace } from '@/features/workspaces/services/workspaces';
import { workspaceDirectoryName } from '@/features/workspaces/utils/workspace-directory';
import { useAsyncEvent } from '@/hooks/use-async-event';
import type { WorkspaceDialogState } from '@/features/workspaces/types/workspace-view';

/** Registration edits keep their icon and selected directory separate from the conversation draft. */
export const useWorkspaceDialog = (
  workspace: Workspace | null,
  onClose: () => void,
): WorkspaceDialogState => {
  const client = useQueryClient();
  const selectWorkspace = useWorkspaceStore((state) => {
    return state.selectWorkspace;
  });
  const [name, setName] = useState(workspace?.name ?? '');
  const [icon, setIcon] = useState<WorkspaceIcon>(workspace?.icon ?? 'folder');
  const [rootPath, setRootPath] = useState(workspace?.rootPath ?? '');
  const save = useAsyncEvent(
    useCallback(
      async (signal: AbortSignal): Promise<void> => {
        let saved: Workspace;
        if (workspace) {
          saved = await renameWorkspace(
            workspace.id,
            { name: name.trim(), icon, expectedRevision: workspace.revision },
            signal,
          );
        } else {
          const input = { rootPath, icon, name: name.trim() || undefined };
          if (input.name === undefined) {
            saved = await createWorkspace({ rootPath: input.rootPath, icon }, signal);
          } else {
            saved = await createWorkspace(
              { rootPath: input.rootPath, name: input.name, icon },
              signal,
            );
          }
        }
        signal.throwIfAborted();
        selectWorkspace(saved.id);
        await client.invalidateQueries({ queryKey: ['workspaces'] });
        signal.throwIfAborted();
        onClose();
      },
      [client, icon, name, onClose, rootPath, selectWorkspace, workspace],
    ),
  );
  const directory = useWorkspaceDirectory(workspace === null, save.pending, setRootPath);
  const { run: saveRun } = save;
  const changeName = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setName(event.target.value);
  }, []);
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (!directory.pending) {
        saveRun();
      }
    },
    [directory.pending, saveRun],
  );
  const changeOpen = useCallback(
    (open: boolean): void => {
      if (!open && !save.pending) {
        onClose();
      }
    },
    [onClose, save.pending],
  );
  let title = '添加工作区';
  let disabled = rootPath.length === 0;
  if (workspace) {
    title = '编辑工作区';
    disabled = name.trim().length === 0;
  }
  return {
    title,
    name,
    icon,
    rootPath,
    directoryName: workspaceDirectoryName(rootPath),
    changeName,
    changeIcon: setIcon,
    submit,
    changeOpen,
    choose: directory.choose,
    editableDirectory: workspace === null,
    directoryAvailable: window.desktop !== undefined,
    dragging: directory.dragging,
    dragEnter: directory.dragEnter,
    dragLeave: directory.dragLeave,
    dragOver: directory.dragOver,
    drop: directory.drop,
    directoryPending: directory.pending,
    pending: save.pending || directory.pending,
    saving: save.pending,
    disabled: disabled || save.pending || directory.pending,
    error: save.error ?? directory.error,
  };
};
