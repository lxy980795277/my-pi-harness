import { AuthFlowSchema, LoginFlowSchema, AuthStatusSchema } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { Type } from 'typebox';
import { isAbsolute } from 'node:path';
import { stat } from 'node:fs/promises';
import { session, shell } from 'electron';

/** Desktop bootstrap grants local trust; application login stays owned by the daemon. */
export interface DesktopAuthorization {
  authorizeRenderer(rendererOrigin: string): Promise<void>;
  openAuth(flowId: string): Promise<void>;
  revealSkillDirectory(skillId: string, workspaceId: string | null): Promise<void>;
}

/**
 * Bind renderer cookies and external authorization to one supervised local daemon.
 * @param origin Validated daemon origin from its readiness record.
 * @param ownerSecret Private secret shared only with the supervised daemon.
 * @param signal Desktop lifetime cancellation.
 * @returns Local trust bootstrap and flow-ID-only external authorization operations.
 */
export function createDesktopAuthorization(
  origin: string,
  ownerSecret: string,
  signal?: AbortSignal,
): DesktopAuthorization {
  let rendererOrigin: string | undefined;

  const requestSignal = (): AbortSignal => {
    if (signal === undefined) return AbortSignal.timeout(5000);
    return AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  };
  const currentCookies = async (): Promise<string> => {
    if (rendererOrigin === undefined) throw new Error('桌面尚未授权');
    const cookies = await session.defaultSession.cookies.get({
      url: `${rendererOrigin}/api/auth/status`,
    });
    return cookies
      .filter((cookie) => cookie.name === 'my_pi_local' || cookie.name === 'my_pi_session')
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
  };

  return {
    async authorizeRenderer(value): Promise<void> {
      const targetOrigin = new URL(value).origin;
      const cookies = await session.defaultSession.cookies.get({
        url: `${targetOrigin}/api/auth/status`,
        name: 'my_pi_local',
      });
      const localCookie = cookies.find((cookie) => cookie.name === 'my_pi_local');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (localCookie !== undefined) headers['Cookie'] = `my_pi_local=${localCookie.value}`;
      const response = await fetch(`${origin}/api/auth/desktop`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ secret: ownerSecret }),
        signal: requestSignal(),
        redirect: 'error',
      });
      const cookieHeader = response.headers.get('set-cookie') ?? '';
      const token = /^my_pi_local=([A-Za-z0-9_-]+);/.exec(cookieHeader)?.[1];
      const maxAge = /(?:^|;)\s*Max-Age=(\d+)(?:;|$)/i.exec(cookieHeader)?.[1];
      let lifetime = 90 * 24 * 3600;
      if (maxAge !== undefined) lifetime = Math.min(lifetime, Number(maxAge));
      await response.body?.cancel();
      if (!response.ok || token === undefined) throw new Error('桌面授权失败');
      await session.defaultSession.cookies.set({
        url: targetOrigin,
        name: 'my_pi_local',
        value: token,
        path: '/api',
        httpOnly: true,
        sameSite: 'strict',
        expirationDate: Date.now() / 1000 + lifetime,
      });
      rendererOrigin = targetOrigin;
    },
    async revealSkillDirectory(skillId, workspaceId): Promise<void> {
      const target = new URL(`/api/skills/${encodeURIComponent(skillId)}/directory`, origin);
      if (workspaceId !== null) target.searchParams.set('workspaceId', workspaceId);
      const cookie = await currentCookies();
      const statusResponse = await fetch(`${origin}/api/auth/status`, {
        headers: { Cookie: cookie },
        signal: requestSignal(),
        redirect: 'error',
      });
      const status: unknown = await statusResponse.json();
      if (!statusResponse.ok || !Value.Check(AuthStatusSchema, status) || status.csrfToken === null)
        throw new Error('桌面授权已失效');
      const response = await fetch(target, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: rendererOrigin ?? origin,
          'x-csrf-token': status.csrfToken,
        },
        signal: requestSignal(),
        redirect: 'error',
      });
      const result: unknown = await response.json();
      if (
        !response.ok ||
        !Value.Check(
          Type.Object(
            { path: Type.String({ minLength: 1, maxLength: 4096 }) },
            { additionalProperties: false },
          ),
          result,
        ) ||
        !isAbsolute(result.path) ||
        result.path.includes('\0')
      )
        throw new Error('Skill目录不可用');
      if (!(await stat(result.path)).isDirectory()) throw new Error('Skill目录不存在');
      signal?.throwIfAborted();
      const failure = await shell.openPath(result.path);
      if (failure.length > 0) throw new Error('无法打开Skill目录');
    },
    async openAuth(flowId): Promise<void> {
      const cookie = await currentCookies();
      const login = flowId.startsWith('login_');
      const path = login ? '/api/auth/login-flows/' : '/api/auth-flows/';
      const response = await fetch(`${origin}${path}${encodeURIComponent(flowId)}`, {
        headers: { Cookie: cookie },
        signal: requestSignal(),
        redirect: 'error',
      });
      const flow: unknown = await response.json();
      const schema = login ? LoginFlowSchema : AuthFlowSchema;
      if (!response.ok || !Value.Check(schema, flow) || flow.status !== 'pending' || !flow.url)
        throw new Error('认证流程不可用');
      const url = new URL(flow.url);
      if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error('认证地址无效');
      signal?.throwIfAborted();
      await shell.openExternal(url.href);
    },
  };
}
