import type { AuthStatus } from '@my-pi-harness/protocol';

/** Describe the current local identity without requiring optional GitHub sign-in. */
export const getUserProfile = (auth: AuthStatus | undefined): { name: string; initial: string } => {
  const name = auth?.identity?.name.trim() || '本机用户';
  return { name, initial: name.slice(0, 1).toLocaleUpperCase() };
};
