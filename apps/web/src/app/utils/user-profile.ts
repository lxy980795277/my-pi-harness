import type { AuthStatus } from '@my-pi-harness/protocol';
import type { UserProfile } from '@/app/types/application';

/** Displays only the authenticated application identity supplied by the daemon. */
export const getUserProfile = (auth: AuthStatus | undefined): UserProfile => {
  if (!auth?.authenticated || auth.user === null) {
    return { name: '', initial: '', avatarUrl: null };
  }
  const name = auth.user.name;
  return { name, initial: name.slice(0, 1).toLocaleUpperCase(), avatarUrl: auth.user.avatarUrl };
};
