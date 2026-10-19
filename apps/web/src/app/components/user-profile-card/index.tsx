import type { AuthStatus } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { LogOut, Settings } from 'lucide-react';
import { useUserProfile } from '@/app/hooks/use-user-profile';
import { useUserMenu } from '@/app/hooks/use-user-menu';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Popover } from '@/components/ui/popover';
import { PopoverContent } from '@/components/ui/popover/popover-content';
import { PopoverTrigger } from '@/components/ui/popover/popover-trigger';

interface UserProfileCardProps {
  auth: AuthStatus | undefined;
  onSettings: () => void;
  onLogout: () => void;
}

/** The identity card opens its settings and sign-out actions above the sidebar footer. */
export const UserProfileCard: FC<UserProfileCardProps> = ({ auth, onSettings, onLogout }) => {
  const profile = useUserProfile(auth);
  const menu = useUserMenu(onSettings, onLogout);
  return (
    <>
      <Popover open={menu.open} onOpenChange={menu.changeOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={menu.trigger}
            type="button"
            variant="ghost"
            className="h-auto w-full justify-start gap-3 rounded-xl p-3 text-left"
            aria-label="用户信息，打开菜单"
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground"
              aria-hidden
            >
              {profile.avatarUrl && (
                <img
                  src={profile.avatarUrl}
                  alt=""
                  className="h-9 w-9 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={profile.failAvatar}
                />
              )}
              {!profile.avatarUrl && profile.initial}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {profile.name}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          aria-label="用户菜单"
          className="w-[var(--radix-popover-trigger-width)] space-y-1 rounded-2xl p-2"
          onCloseAutoFocus={menu.closeFocus}
        >
          <Button
            type="button"
            variant="ghost"
            className="h-9 w-full justify-start gap-3 rounded-lg px-3 text-sm font-normal text-foreground"
            onClick={menu.settings}
          >
            <Settings width={18} height={18} aria-hidden />
            设置
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-9 w-full justify-start gap-3 rounded-lg px-3 text-sm font-normal text-error-solid hover:text-error-solid"
            onClick={menu.logout}
          >
            <LogOut width={18} height={18} aria-hidden />
            退出登录
          </Button>
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={menu.logoutOpen}
        onOpenChange={menu.changeLogoutOpen}
        title="确认退出登录？"
        description="退出后需要重新登录才能继续使用 My Pi Harness。"
        confirmLabel="退出登录"
        pending={false}
        onConfirm={menu.confirmLogout}
        warning
      />
    </>
  );
};
