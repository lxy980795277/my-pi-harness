import { ConnectionServiceIdSchema, type ConnectionServiceId } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';

const SERVICE_NAMES: Readonly<Record<ConnectionServiceId, string>> = {
  github: 'GitHub',
  google: 'Google',
  notion: 'Notion',
  vercel: 'Vercel',
  supabase: 'Supabase',
};

/** The launch document accepts only a provider label, never an authorization URL or account data. */
export const oauthLaunchPresentation = (
  search: string,
): { valid: boolean; title: string; description: string } => {
  const parameters = new URLSearchParams(search);
  const service = parameters.get('service');
  if (
    Array.from(parameters.keys()).length !== 1 ||
    !Value.Check(ConnectionServiceIdSchema, service)
  ) {
    return {
      valid: false,
      title: '无法打开授权页面',
      description: '请返回应用，从账户连接按钮重新发起授权。',
    };
  }
  return {
    valid: true,
    title: '正在打开授权页面',
    description: `即将前往 ${SERVICE_NAMES[service]} 完成授权，请稍候。`,
  };
};

/** Launch pages mount independently of login, workspace loading and the application shell. */
export const isConnectionOAuthLaunch = (pathname: string): boolean => {
  return pathname === '/connection-oauth/launch';
};
