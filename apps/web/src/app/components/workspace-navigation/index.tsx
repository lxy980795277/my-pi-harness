import type { AuthStatus } from '@my-pi-harness/protocol';
import { CircleDot, Cpu, Link2, LogIn, LogOut, MessageSquarePlus } from 'lucide-react';
import type { FC } from 'react';

import { NavigationItem } from '@/app/components/navigation-item';
import { UserProfileCard } from '@/app/components/user-profile-card';
import { Button } from '@/components/ui/button';
import type { WorkspacePage } from '@/app/stores/workspace';
import { WorkspaceTree } from '@/features/workspaces/components/workspace-tree';

interface WorkspaceNavigationProps {
  page: WorkspacePage;
  newConversation: boolean;
  authorized: boolean;
  auth: AuthStatus | undefined;
  pairingCode: string | null;
  onNavigate: (page: WorkspacePage) => void;
  onNewConversation: () => void;
  onSettings: () => void;
  onPairing: () => void;
  onHideCode: () => void;
  onGithub: () => void;
  onLogout: () => void;
}

/** Desktop navigation and explicit authorization controls are shared by both entry points. */
export const WorkspaceNavigation: FC<WorkspaceNavigationProps> = ({
  page,
  newConversation,
  authorized,
  auth,
  pairingCode,
  onNavigate,
  onNewConversation,
  onSettings,
  onPairing,
  onHideCode,
  onGithub,
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
        {authorized && pairingCode && (
          <div className="space-y-2 px-2">
            <p className="text-[11px] text-muted-foreground">短时一次性配对码</p>
            <code className="block rounded border bg-background p-2 text-xs break-all">
              {pairingCode}
            </code>
            <Button type="button" variant="ghost" onClick={onHideCode}>
              隐藏配对码
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 px-2">
          <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <CircleDot width={12} height={12} aria-hidden />
            本机服务
          </p>
          {authorized && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onPairing}
                aria-label="生成浏览器配对码"
                title="生成浏览器配对码"
              >
                <Link2 width={14} height={14} aria-hidden />
              </Button>
              {auth?.githubConfigured && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onGithub}
                  aria-label="GitHub 应用登录"
                  title="GitHub 应用登录"
                >
                  <LogIn width={14} height={14} aria-hidden />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onLogout}
                aria-label="退出本机授权"
                title="退出本机授权"
              >
                <LogOut width={14} height={14} aria-hidden />
              </Button>
            </div>
          )}
        </div>
        {authorized && <UserProfileCard auth={auth} onSettings={onSettings} />}
      </div>
    </aside>
  );
};
