import { Type } from 'typebox';
import {
  RemoteMcpViewSchema,
  SkillOAuthLaunchTicketSchema,
  parseExternalUrl,
  type RemoteMcpView,
} from '@my-pi-harness/protocol';
import { fetchAuthStatus } from '@/features/auth/services/auth';
import { getJson, requestJson } from '@/services/base-request';
import { openExternal } from '@/services/open-external';
import { parseResponse } from '@/utils/parse-response';
import type { PluginAuthorizationWindow } from '@/features/plugins/types/plugin-connection';

const OAuthStartSchema = Type.Object({
  url: Type.String(),
  state: Type.String(),
  expiresAt: Type.Integer(),
});

/** Independent MCP Apps open their own launch document without using the plugin's REST token. */
export const openPluginAppAuthorization = async (
  server: RemoteMcpView,
  signal: AbortSignal,
): Promise<PluginAuthorizationWindow> => {
  signal.throwIfAborted();
  if (window.desktop !== undefined) {
    const ticket = parseResponse(
      SkillOAuthLaunchTicketSchema,
      await requestJson(
        `/mcp/remote-servers/${encodeURIComponent(server.id)}/oauth/launch-ticket`,
        'POST',
        { expectedRevision: server.revision, expectedAccessEpoch: server.accessEpoch },
        signal,
      ),
    );
    signal.throwIfAborted();
    await openExternal(ticket.launchUrl);
    signal.throwIfAborted();
    return { type: 'desktop', expiresAt: ticket.expiresAt };
  }
  const path = `/mcp-oauth/${encodeURIComponent(server.id)}/launch?name=${encodeURIComponent(server.name)}`;
  const popup = window.open(path, '_blank', 'popup,width=720,height=760');
  if (popup === null) throw new Error('浏览器阻止了授权窗口，请允许弹窗后重试。');
  popup.opener = null;
  return { type: 'browser', window: popup };
};

/** The MCP launch document reads current controls, then starts one provider authorization request. */
export const startPluginAppAuthorization = async (
  serverId: string,
  ticket: string | null,
  signal: AbortSignal,
): Promise<string> => {
  const path = `/mcp/remote-servers/${encodeURIComponent(serverId)}`;
  let result: unknown;
  if (ticket !== null) {
    result = await requestJson(`${path}/oauth/launch`, 'POST', { ticket }, signal, 45_000);
  } else {
    const status = await fetchAuthStatus(signal);
    signal.throwIfAborted();
    if (!status.localAuthorized || !status.authenticated)
      throw new Error('应用登录已失效，请返回应用重新登录后授权。');
    const server = parseResponse(RemoteMcpViewSchema, await getJson(path, signal));
    result = await requestJson(
      `${path}/oauth/start`,
      'POST',
      { expectedRevision: server.revision, expectedAccessEpoch: server.accessEpoch },
      signal,
      45_000,
    );
  }
  signal.throwIfAborted();
  return parseExternalUrl(parseResponse(OAuthStartSchema, result).url);
};

/** React effect replay shares this document's single-use ticket request without persisting it. */
export const createPluginAppAuthorizationLaunch = (
  serverId: string,
  ticket: string | null,
): { start: () => Promise<string> } => {
  let request: Promise<string> | null = null;
  return {
    start: (): Promise<string> => {
      if (request === null)
        request = startPluginAppAuthorization(serverId, ticket, AbortSignal.timeout(60_000));
      return request;
    },
  };
};
