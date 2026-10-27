import { parseExternalUrl, type ConnectionView } from '@my-pi-harness/protocol';
import { Type } from 'typebox';
import { connectionAction } from '@/features/connections/services/connections';
import {
  openConnectionAuthorizationWindow,
  type ConnectionAuthorizationWindow,
} from '@/features/connections/services/oauth-window';
import { openExternal } from '@/services/open-external';
import { parseResponse } from '@/utils/parse-response';

export interface ConnectionAuthorizationLaunch {
  url: string;
  expiresAt: number;
  popup: ConnectionAuthorizationWindow | null;
}

/** The authenticated parent owns HTTP and CSRF state; the launch URL carries only the provider label. */
export const beginConnectionAuthorization = async (
  connection: ConnectionView,
  signal: AbortSignal,
): Promise<ConnectionAuthorizationLaunch> => {
  signal.throwIfAborted();
  const popup = openConnectionAuthorizationWindow(connection.serviceId);
  const close = (): void => {
    popup?.close();
  };
  signal.addEventListener('abort', close, { once: true });
  try {
    const result = parseResponse(
      Type.Object(
        { url: Type.String(), expiresAt: Type.Integer() },
        { additionalProperties: false },
      ),
      await connectionAction(connection, 'oauth/start', signal),
    );
    signal.throwIfAborted();
    return { ...result, url: parseExternalUrl(result.url), popup };
  } catch (error: unknown) {
    close();
    throw error;
  } finally {
    signal.removeEventListener('abort', close);
  }
};

/** Store the returned flow before navigating so a closed popup can be reopened without starting a new flow. */
export const showConnectionAuthorization = async (
  launch: ConnectionAuthorizationLaunch,
): Promise<void> => {
  if (launch.popup !== null) {
    launch.popup.redirect(launch.url);
    return;
  }
  await openExternal(launch.url);
};

/** Reopening reuses the existing server flow and preserves synchronous browser popup creation. */
export const reopenConnectionAuthorization = async (
  connection: ConnectionView,
  url: string,
): Promise<ConnectionAuthorizationWindow | null> => {
  const target = parseExternalUrl(url);
  const popup = openConnectionAuthorizationWindow(connection.serviceId);
  await showConnectionAuthorization({ url: target, expiresAt: 0, popup });
  return popup;
};
