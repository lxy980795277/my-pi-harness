import {
  SkillConnectionStatusSchema,
  SkillOAuthLaunchTicketSchema,
  SkillOAuthStartSchema,
  parseExternalUrl,
  type PluginView,
  type SkillConnectionStatus,
} from '@my-pi-harness/protocol';
import { fetchAuthStatus } from '@/features/auth/services/auth';
import { skillOAuthLaunchUrl } from '@/features/plugins/utils/skill-oauth';
import { getJson, requestJson } from '@/services/base-request';
import { openExternal } from '@/services/open-external';
import { parseResponse } from '@/utils/parse-response';
import type { PluginAuthorizationWindow } from '@/features/plugins/types/plugin-connection';

/** Only public connection facts enter Query; the daemon retains OAuth configuration and tokens. */
export const fetchPluginAuthorization = async (
  pluginId: string,
  signal: AbortSignal,
): Promise<SkillConnectionStatus> => {
  return parseResponse(
    SkillConnectionStatusSchema,
    await getJson(`/skill-connections/${encodeURIComponent(pluginId)}`, signal),
  );
};

/** Browser clicks open the launch document synchronously; that document starts its own OAuth flow. */
export const openPluginAuthorization = async (
  plugin: PluginView,
  signal: AbortSignal,
): Promise<PluginAuthorizationWindow> => {
  signal.throwIfAborted();
  const path = `/skill-connections/${encodeURIComponent(plugin.manifest.id)}`;
  if (window.desktop !== undefined) {
    const ticket = parseResponse(
      SkillOAuthLaunchTicketSchema,
      await requestJson(`${path}/oauth/launch-ticket`, 'POST', {}, signal),
    );
    signal.throwIfAborted();
    await openExternal(ticket.launchUrl);
    signal.throwIfAborted();
    return { type: 'desktop', expiresAt: ticket.expiresAt };
  }
  const popup = window.open(
    skillOAuthLaunchUrl(plugin.manifest.id, plugin.manifest.name),
    '_blank',
    'popup,width=720,height=760',
  );
  if (popup === null) throw new Error('浏览器阻止了授权窗口，请允许弹窗后重试。');
  popup.opener = null;
  return { type: 'browser', window: popup };
};

/** The isolated launch document performs the OAuth start request and navigates itself. */
export const startPluginAuthorization = async (
  pluginId: string,
  ticket: string | null,
  signal: AbortSignal,
): Promise<string> => {
  const path = `/skill-connections/${encodeURIComponent(pluginId)}/oauth`;
  let result: unknown;
  if (ticket !== null) {
    result = await requestJson(`${path}/launch`, 'POST', { ticket }, signal);
  } else {
    const status = await fetchAuthStatus(signal);
    signal.throwIfAborted();
    if (!status.localAuthorized || !status.authenticated)
      throw new Error('应用登录已失效，请返回应用重新登录后授权。');
    result = await requestJson(path, 'POST', {}, signal);
  }
  signal.throwIfAborted();
  return parseExternalUrl(parseResponse(SkillOAuthStartSchema, result).authorizationUrl);
};

/** One document issues one start request across React effect replay; callers ignore stale results. */
export const createPluginAuthorizationLaunch = (
  pluginId: string,
  ticket: string | null,
): { start: () => Promise<string> } => {
  let request: Promise<string> | null = null;
  return {
    start: (): Promise<string> => {
      if (request === null)
        request = startPluginAuthorization(pluginId, ticket, AbortSignal.timeout(30_000));
      return request;
    },
  };
};

/** Disconnect only the selected plugin's reusable credential. */
export const disconnectPluginAuthorization = async (
  pluginId: string,
  signal: AbortSignal,
): Promise<void> => {
  await requestJson(`/skill-connections/${encodeURIComponent(pluginId)}`, 'DELETE', {}, signal);
};
