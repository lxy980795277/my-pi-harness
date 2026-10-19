import type { AuthStatus } from '@my-pi-harness/protocol';
import { useCallback, useState } from 'react';
import type { UserProfileState } from '@/app/types/application';
import { getUserProfile } from '@/app/utils/user-profile';

/** An unavailable external avatar falls back to the authenticated user's initial. */
export const useUserProfile = (auth: AuthStatus | undefined): UserProfileState => {
  const profile = getUserProfile(auth);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failAvatar = useCallback((): void => {
    setFailedUrl(profile.avatarUrl);
  }, [profile.avatarUrl]);
  let avatarUrl = profile.avatarUrl;
  if (avatarUrl === failedUrl) {
    avatarUrl = null;
  }
  return { ...profile, avatarUrl, failAvatar };
};
