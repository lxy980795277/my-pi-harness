import type { Workspace } from '@my-pi-harness/protocol';
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { WorkspaceIcon } from '@/components/workspace-icon';
import { SessionNavigation } from '@/features/sessions/components/session-navigation';
import { useWorkspaceGroup } from '@/features/workspaces/hooks/use-workspace-group';
import type { WorkspaceGroup as WorkspaceGroupView } from '@/features/workspaces/utils/workspace-tree';

interface WorkspaceGroupProps {
  group: WorkspaceGroupView;
  activeId: string | null;
  activeWorkspaceId: string | null;
  onSelectWorkspace: (id: string | null) => void;
  onSelectSession: (id: string) => void;
  onRename: (workspace: Workspace) => void;
  onRemove: (workspace: Workspace) => void;
}

/** Folder rows contain separate keyboard-operable selection and management actions. */
export const WorkspaceGroup: FC<WorkspaceGroupProps> = ({
  group,
  activeId,
  activeWorkspaceId,
  onSelectWorkspace,
  onSelectSession,
  onRename,
  onRemove,
}) => {
  const state = useWorkspaceGroup(group, activeWorkspaceId, onSelectWorkspace, onRename, onRemove);
  return (
    <div className="space-y-0.5" role="group" aria-label={group.name}>
      <div className="group/workspace flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          className={state.className}
          onClick={state.select}
          aria-expanded={state.expanded}
          title={group.workspace?.rootPath}
        >
          <span className="relative inline-flex h-4 w-4 shrink-0" aria-hidden>
            <span className="text-workspace-folder group-hover/workspace:opacity-0 group-focus-visible/folder:opacity-0">
              <WorkspaceIcon icon={group.workspace?.icon ?? 'folder'} expanded={state.expanded} />
            </span>
            <span className="absolute inset-0 text-muted-foreground opacity-0 group-hover/workspace:opacity-100 group-focus-visible/folder:opacity-100">
              {state.expanded && <ChevronDown width={16} height={16} aria-hidden />}
              {!state.expanded && <ChevronRight width={16} height={16} aria-hidden />}
            </span>
          </span>
          <span className="truncate">{group.name}</span>
        </Button>
        {group.workspace && (
          <div className="flex shrink-0 opacity-0 transition-opacity group-focus-within/workspace:opacity-100 group-hover/workspace:opacity-100">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              aria-label={`编辑工作区 ${group.name}`}
              onClick={state.rename}
            >
              <Pencil width={12} height={12} aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              aria-label={`移除工作区 ${group.name}`}
              onClick={state.remove}
            >
              <Trash2 width={12} height={12} aria-hidden />
            </Button>
          </div>
        )}
      </div>
      {state.expanded && (
        <div>
          {group.sessions.length === 0 && (
            <p className="px-2 py-2 text-[11px] text-muted-foreground">还没有对话</p>
          )}
          <div className="space-y-0.5" aria-label={`${group.name} 的对话`}>
            {group.sessions.map((session) => {
              return (
                <SessionNavigation
                  key={session.id}
                  session={session}
                  activeId={activeId}
                  onSelect={onSelectSession}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
