import type { AuthStatus } from '@my-pi-harness/protocol';
import { CircleDot, Cpu, GitBranch, MessageSquarePlus } from 'lucide-react';
import type { FC } from 'react';

import { NavigationItem } from '@/app/components/navigation-item';
import { UserProfileCard } from '@/app/components/user-profile-card';
import { Button } from '@/components/ui/button';
import type { WorkspacePage } from '@/app/types/application';
import { WorkspaceTree } from '@/features/workspaces/components/workspace-tree';
import { SearchEntry } from '@/features/search/components/search-entry';

interface WorkspaceNavigationProps {
  page: WorkspacePage;
  newConversation: boolean;
  authorized: boolean;
  auth: AuthStatus | undefined;
  onNavigate: (page: WorkspacePage) => void;
  onNewConversation: () => void;
  onSettings: () => void;
  onLogout: () => void;
}

/** Workspace navigation and application-session controls are shared by both entry points. */
export const WorkspaceNavigation: FC<WorkspaceNavigationProps> = ({
  page,
  newConversation,
  authorized,
  auth,
  onNavigate,
  onNewConversation,
  onSettings,
  onLogout,
}) => {
  return (
    <aside
      className="flex h-full w-64 shrink-0 flex-col bg-muted/50 max-lg:w-56"
      aria-label="工作台导航"
    >
      <nav className="shrink-0 space-y-1 px-3 pt-4" aria-label="页面导航">
        <Button
          type="button"
          variant="ghost"
          className="h-10 w-full justify-start gap-3 rounded-2xl px-3 text-sm text-foreground data-[active=true]:bg-secondary/70"
          onClick={onNewConversation}
          data-active={newConversation}
          aria-current={newConversation && 'page'}
        >
          <MessageSquarePlus width={18} height={18} aria-hidden />
          新对话
        </Button>
        <SearchEntry />
        <NavigationItem
          page="tasks"
          activePage={page}
          label="任务看板"
          icon={GitBranch}
          onNavigate={onNavigate}
        />
        <NavigationItem
          page="runtime"
          activePage={page}
          label="运行状态"
          icon={Cpu}
          onNavigate={onNavigate}
        />
      </nav>
      {authorized && <WorkspaceTree />}
      <div className="mt-auto space-y-3 border-t border-border p-3">
        <p className="flex items-center gap-2 px-2 text-[11px] text-muted-foreground">
          <CircleDot width={12} height={12} aria-hidden />
          本机服务
        </p>
        {authorized && <UserProfileCard auth={auth} onSettings={onSettings} onLogout={onLogout} />}
      </div>
    </aside>
  );
};
