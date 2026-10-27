import type { SkillOAuthPage, SkillOAuthPresentation } from '@/features/plugins/types/skill-oauth';

/** Launch and result documents mount independently of the authenticated application shell. */
export const isSkillOAuthPage = (pathname: string): boolean => {
  return (
    pathname === '/skill-oauth/result' || /^\/(?:skill|mcp)-oauth\/[^/]+\/launch$/u.test(pathname)
  );
};

/** Only the plugin identifier and bounded display labels enter the authorization document. */
export const parseSkillOAuthPage = (pathname: string, search: string): SkillOAuthPage => {
  const parameters = new URLSearchParams(search);
  let name = parameters.get('name') ?? '插件';
  if (name.length > 80 || name.trim() === '') name = '插件';
  if (pathname === '/skill-oauth/result') {
    const message = parameters.get('message');
    if (message !== null && message.length > 500) return { type: 'invalid' };
    return { type: 'result', name, successful: parameters.get('status') === 'success', message };
  }
  const match = /^\/(skill|mcp)-oauth\/([A-Za-z0-9_-]+)\/launch$/u.exec(pathname);
  if (match?.[1] === undefined || match[2] === undefined) return { type: 'invalid' };
  let target: 'plugin' | 'mcp' = 'plugin';
  if (match[1] === 'mcp') target = 'mcp';
  return { type: 'launch', target, id: match[2], name };
};

/** A launch URL never carries provider authorization URLs, client configuration, or tokens. */
export const skillOAuthLaunchUrl = (pluginId: string, name: string): string => {
  const path = `/skill-oauth/${encodeURIComponent(pluginId)}/launch`;
  return `${path}?name=${encodeURIComponent(name)}`;
};

/** Remove the one-use desktop launch capability before requests, renders, or provider navigation. */
export const takeSkillOAuthLaunchTicket = (): string | null => {
  const fragment = window.location.hash;
  if (fragment === '') return null;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  const parameters = new URLSearchParams(fragment.slice(1));
  const ticket = parameters.get('ticket');
  if (parameters.size !== 1 || ticket === null || !/^[A-Za-z0-9_-]{43}$/u.test(ticket))
    throw new Error('授权入口已失效，请从插件市场重新发起授权。');
  return ticket;
};

/** Launch failures and callback results share one compact status presentation. */
export const skillOAuthPresentation = (
  page: SkillOAuthPage,
  error: string | null,
): SkillOAuthPresentation => {
  if (page.type === 'invalid')
    return {
      title: '无法打开授权页面',
      description: '请返回插件市场重新发起授权。',
      pending: false,
      successful: false,
    };
  if (page.type === 'result') {
    if (page.successful)
      return {
        title: `${page.name} 已连接`,
        description: '授权已完成，返回插件市场即可继续使用。',
        pending: false,
        successful: true,
      };
    return {
      title: `${page.name} 连接失败`,
      description: page.message ?? '授权没有完成，请关闭此窗口后从插件市场重试。',
      pending: false,
      successful: false,
    };
  }
  if (error !== null)
    return {
      title: `${page.name} 授权启动失败`,
      description: error,
      pending: false,
      successful: false,
    };
  return {
    title: '正在打开授权页面',
    description: `即将前往 ${page.name} 完成授权，请稍候。`,
    pending: true,
    successful: false,
  };
};
