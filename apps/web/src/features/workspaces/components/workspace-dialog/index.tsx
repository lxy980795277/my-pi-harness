import type { Workspace } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DialogContent } from '@/components/ui/dialog/dialog-content';
import { DialogTitle } from '@/components/ui/dialog/dialog-title';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { WorkspaceDirectoryPicker } from '@/features/workspaces/components/workspace-directory-picker';
import { WorkspaceIconPicker } from '@/features/workspaces/components/workspace-icon-picker';
import { useWorkspaceDialog } from '@/features/workspaces/hooks/use-workspace-dialog';

interface WorkspaceDialogProps {
  workspace: Workspace | null;
  onClose: () => void;
}

/** A name and folder selection fully describe registration without redundant explanatory copy. */
export const WorkspaceDialog: FC<WorkspaceDialogProps> = ({ workspace, onClose }) => {
  const state = useWorkspaceDialog(workspace, onClose);
  return (
    <Dialog open onOpenChange={state.changeOpen}>
      <DialogContent
        closeLabel="关闭工作区设置"
        aria-describedby={undefined}
        className="max-w-lg gap-4 overflow-x-hidden p-5"
      >
        <DialogTitle>{state.title}</DialogTitle>
        <form onSubmit={state.submit} className="min-w-0 space-y-4">
          <div className="flex items-center overflow-hidden rounded-xl border border-border bg-background has-[input:focus]:border-ring has-[input:focus]:ring-1 has-[input:focus]:ring-ring">
            <WorkspaceIconPicker
              value={state.icon}
              onChange={state.changeIcon}
              disabled={state.pending}
            />
            <Input
              id="workspace-name"
              aria-label="工作区名称"
              value={state.name}
              maxLength={120}
              onChange={state.changeName}
              disabled={state.pending}
              placeholder="工作区名称"
              className="h-9 rounded-none border-0 bg-transparent px-3"
            />
          </div>
          <WorkspaceDirectoryPicker
            rootPath={state.rootPath}
            directoryName={state.directoryName}
            editable={state.editableDirectory}
            available={state.directoryAvailable}
            pending={state.directoryPending}
            disabled={state.pending}
            dragging={state.dragging}
            choose={state.choose}
            dragEnter={state.dragEnter}
            dragLeave={state.dragLeave}
            dragOver={state.dragOver}
            drop={state.drop}
          />
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={state.saving}>
              取消
            </Button>
            <Button type="submit" className="rounded-lg px-5" disabled={state.disabled}>
              {state.saving && '保存中…'}
              {!state.saving && '保存工作区'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
