import type { AuthStatus } from '@my-pi-harness/protocol';
import type { LoginCallback, LoginEntry } from '@/features/auth/types/auth';

/** Each entry requires its own provider configuration; Web never falls back to device login. */
export const loginEntry = (status: AuthStatus, desktop: boolean): LoginEntry => {
  let method: LoginEntry['method'] = 'web';
  if (desktop) {
    method = 'device';
  }
  const provider = status.providers.find((candidate) => {
    return candidate.id === 'github';
  });
  if (!provider?.available) {
    return {
      method,
      configured: false,
      configurationMessage: '请在仓库根目录 .env 中配置 MY_PI_HARNESS_GITHUB_CLIENT_ID。',
    };
  }
  if (!provider.methods.includes(method)) {
    let configurationMessage = '请在 GitHub OAuth App 中启用 Device Flow。';
    if (method === 'web') {
      configurationMessage =
        '请在仓库根目录 .env 中配置 MY_PI_HARNESS_GITHUB_CLIENT_SECRET，并设置 GitHub OAuth App 的回调地址。';
    }
    return { method, configured: false, configurationMessage };
  }
  return { method, configured: true, configurationMessage: null };
};

/** Callback URLs contain only a temporary flow ID; strip it while preserving unrelated navigation. */
export const readLoginCallback = (value: string): LoginCallback => {
  const url = new URL(value);
  const ids = url.searchParams.getAll('login_flow');
  url.searchParams.delete('login_flow');
  const callback: LoginCallback = {
    flowId: null,
    cleanUrl: `${url.pathname}${url.search}${url.hash}`,
    error: null,
  };
  if (ids.length === 0) {
    return callback;
  }
  const id = ids[0];
  if (ids.length !== 1 || !id || id.length > 100 || !/^login_[A-Za-z0-9_-]+$/.test(id)) {
    callback.error = '登录回调无效，请重新登录。';
    return callback;
  }
  callback.flowId = id;
  return callback;
};
