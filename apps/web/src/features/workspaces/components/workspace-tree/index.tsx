import { Plus } from 'lucide-react';
import type { FC } from 'react';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { WorkspaceDialog } from '@/features/workspaces/components/workspace-dialog';
import { WorkspaceGroup } from '@/features/workspaces/components/workspace-group';
import { useWorkspaceTree } from '@/features/workspaces/hooks/use-workspace-tree';

/** All conversation navigation lives under the left sidebar's registered workspace folders. */
export const WorkspaceTree: FC = () => {
  const state = useWorkspaceTree();
  return (
    <div
      className="mt-6 flex min-h-0 flex-1 flex-col border-t border-border/70"
      aria-label="工作区与对话"
    >
      <div className="flex h-14 shrink-0 items-center justify-between px-5">
        <span className="text-xs font-medium text-muted-foreground">工作区</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-full transition-none"
          onClick={state.add}
          aria-label="添加工作区"
        >
          <Plus width={16} height={16} aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4">
        {state.pending && <p className="px-2 text-xs text-muted-foreground">正在读取工作区…</p>}
        {state.error && <Notice tone="error">{state.error}</Notice>}
        {!state.pending && state.groups.length === 0 && (
          <p className="px-2 text-xs leading-6 text-muted-foreground">
            添加文件夹，为对话选择工作范围。
          </p>
        )}
        {state.groups.map((group) => {
          return (
            <WorkspaceGroup
              key={group.id}
              group={group}
              activeId={state.activeId}
              onNewConversation={state.newConversation}
              onSelectSession={state.select}
              onRename={state.rename}
              onRemove={state.requestRemove}
            />
          );
        })}
      </div>
      {state.dialog && (
        <WorkspaceDialog workspace={state.dialog.workspace} onClose={state.closeDialog} />
      )}
      <ConfirmDialog
        open={state.removing !== null}
        onOpenChange={state.changeRemoveOpen}
        title="移除工作区"
        description="仅移除工作区登记，不会删除文件。有对话的工作区需先删除其中的对话。"
        confirmLabel="确认移除工作区"
        pending={state.removingPending}
        onConfirm={state.confirmRemove}
        error={state.removeError}
      />
    </div>
  );
};
