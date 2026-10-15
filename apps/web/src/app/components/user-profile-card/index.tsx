import type { AuthStatus } from '@my-pi-harness/protocol';
import type { FC } from 'react';
import { Settings2 } from 'lucide-react';
import { getUserProfile } from '@/app/utils/user-profile';
import { Button } from '@/components/ui/button';

interface UserProfileCardProps {
  auth: AuthStatus | undefined;
  onSettings: () => void;
}

/** The sidebar identity card opens settings directly and remains a keyboard-accessible button. */
export const UserProfileCard: FC<UserProfileCardProps> = ({ auth, onSettings }) => {
  const profile = getUserProfile(auth);
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto w-full justify-start gap-3 rounded-xl p-3 text-left"
      aria-label="用户信息，打开设置"
      onClick={onSettings}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground"
        aria-hidden
      >
        {profile.initial}
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block truncate text-sm font-medium text-foreground">{profile.name}</span>
        <span className="block text-[11px] font-normal text-muted-foreground">
          本机服务 · 已授权
        </span>
      </span>
      <Settings2 width={15} height={15} className="text-muted-foreground" aria-hidden />
    </Button>
  );
};
