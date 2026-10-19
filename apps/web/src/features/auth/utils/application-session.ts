import type { AuthStatus } from '@my-pi-harness/protocol';

/** Cached identity remains usable during transport loss until revoked or locally expired. */
export const hasValidApplicationSession = (
  status: AuthStatus | undefined,
  revoked: boolean,
  now: number,
): boolean => {
  if (
    !status ||
    revoked ||
    !status.localAuthorized ||
    !status.authenticated ||
    !status.user ||
    !status.session
  ) {
    return false;
  }
  return status.session.expiresAt > now;
};
