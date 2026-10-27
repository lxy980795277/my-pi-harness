import type { PluginAppRow } from '@/features/plugins/types/plugin';
import type { PluginAppRowState } from '@/features/plugins/types/plugin-app';
import { usePluginAppOAuth } from '@/features/plugins/hooks/use-plugin-app-oauth';

/** A compact App row offers direct OAuth only for an enabled, independently authorized MCP. */
export const usePluginAppRow = (app: PluginAppRow): PluginAppRowState => {
  const oauth = usePluginAppOAuth(app.server, app.usesPluginOAuth);
  const authorizationRequired =
    !app.usesPluginOAuth &&
    app.server !== null &&
    app.server.enabled &&
    app.server.oauth &&
    !app.server.oauthConnected;
  let authorizationLabel = '授权';
  if (oauth.waiting) authorizationLabel = '等待授权';
  return {
    authorizationRequired,
    authorizationLabel,
    authorize: oauth.authorize,
    pending: oauth.pending || oauth.waiting || app.disabled,
    error: oauth.error,
  };
};
