import type { Workspace } from '@my-pi-harness/protocol';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import { WorkspaceIcon } from '@/components/workspace-icon';
import { SessionNavigation } from '@/features/sessions/components/session-navigation';
import { WorkspaceActions } from '@/features/workspaces/components/workspace-actions';
import { useWorkspaceGroup } from '@/features/workspaces/hooks/use-workspace-group';
import type { WorkspaceGroup as WorkspaceGroupView } from '@/features/workspaces/utils/workspace-tree';

interface WorkspaceGroupProps {
  group: WorkspaceGroupView;
  activeId: string | null;
  onNewConversation: (id: string | null) => void;
  onSelectSession: (id: string) => void;
  onRename: (workspace: Workspace) => void;
  onRemove: (workspace: Workspace) => void;
}

/** Folder toggles and absolute management controls remain separate keyboard-operable actions. */
export const WorkspaceGroup: FC<WorkspaceGroupProps> = ({
  group,
  activeId,
  onNewConversation,
  onSelectSession,
  onRename,
  onRemove,
}) => {
  const state = useWorkspaceGroup(group, onNewConversation, onRename, onRemove);
  return (
    <div className="space-y-0" role="group" aria-label={group.name}>
      <div className={state.rowClassName}>
        <Button
          type="button"
          variant="ghost"
          className={state.className}
          onClick={state.toggle}
          aria-expanded={state.expanded}
          title={group.workspace?.rootPath}
        >
          <span className="relative inline-flex h-4 w-4 shrink-0" aria-hidden>
            <span className="text-workspace-folder group-hover/workspace:opacity-0">
              <WorkspaceIcon icon={group.workspace?.icon ?? 'folder'} expanded={state.expanded} />
            </span>
            <span className="absolute inset-0 text-muted-foreground opacity-0 group-hover/workspace:opacity-100">
              {state.expanded && <ChevronDown width={16} height={16} aria-hidden />}
              {!state.expanded && <ChevronRight width={16} height={16} aria-hidden />}
            </span>
          </span>
          <span className="truncate">{group.name}</span>
        </Button>
        <WorkspaceActions name={group.name} managed={group.workspace !== null} state={state} />
      </div>
      {state.expanded && (
        <div>
          {group.sessions.length === 0 && (
            <p className="py-2 pr-2 pl-[33px] text-[11px] text-muted-foreground/70">暂无对话</p>
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
