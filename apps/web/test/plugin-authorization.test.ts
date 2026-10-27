import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthStatus, PluginView, SkillConnectionStatus } from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginAuthorization } from '@/features/plugins/components/plugin-authorization';
import {
  createPluginAuthorizationLaunch,
  disconnectPluginAuthorization,
  fetchPluginAuthorization,
  openPluginAuthorization,
  startPluginAuthorization,
} from '@/features/plugins/services/plugin-authorization';
import { fetchAuthStatus } from '@/features/auth/services/auth';
import { getJson, requestJson } from '@/services/base-request';

vi.mock('@/services/base-request', () => ({ getJson: vi.fn(), requestJson: vi.fn() }));
vi.mock('@/features/auth/services/auth', () => ({ fetchAuthStatus: vi.fn() }));

const PLUGIN: PluginView = {
  manifest: {
    id: 'github',
    name: 'GitHub',
    description: 'Manage repositories',
    category: 'services',
    version: '1.1.0',
    skills: ['github'],
    apps: [{ id: 'github', provider: 'github', name: 'GitHub', credentialSource: 'plugin-oauth' }],
  },
  installed: true,
  enabled: true,
  revision: 3,
  components: [],
};
const STATUS: SkillConnectionStatus = {
  collectionId: 'github',
  isConnected: false,
  account: null,
};
const AUTH: AuthStatus = {
  localAuthorized: true,
  authenticated: true,
  csrfToken: 'synthetic-csrf',
  providers: [],
  profileBound: true,
  user: { id: 'synthetic-user', name: 'Synthetic User', avatarUrl: null },
  session: { id: 'synthetic-session', providerId: 'github', expiresAt: 300_000 },
};
const RESULT = { authorizationUrl: 'https://github.com/login/oauth/authorize?state=synthetic' };
const request = vi.mocked(requestJson);
const get = vi.mocked(getJson);
const auth = vi.mocked(fetchAuthStatus);

const browser = () => {
  const popup = { opener: {}, closed: false, close: vi.fn() };
  const open = vi.fn(() => popup);
  vi.stubGlobal('window', { open, location: { origin: 'http://127.0.0.1:4321' } });
  return { popup, open };
};

const render = (status: SkillConnectionStatus): string => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(['skill-connections', 'github'], status);
  try {
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(PluginAuthorization, { plugin: PLUGIN, disabled: false }),
      ),
    );
  } finally {
    client.clear();
  }
};

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('plugin single authorization control', () => {
  it('shows only one authorization action without account forms or legacy flow controls', () => {
    const html = render(STATUS);
    expect(html).toContain('Skill 网关授权');
    expect(html).toContain('未授权或授权已失效');
    expect(html).toContain('>授权</button>');
    expect(html.match(/<button\b/g)).toHaveLength(1);
    for (const text of [
      '添加账户',
      '选择服务账户',
      '关联到插件应用',
      'Client ID',
      '<input',
      '<select',
      '取消授权',
      '重新打开授权页面',
    ])
      expect(html).not.toContain(text);
  });

  it('shows public account identity and one disconnect action', () => {
    const html = render({
      ...STATUS,
      isConnected: true,
      account: {
        id: '123',
        username: 'synthetic-user',
        displayName: 'Synthetic User',
        avatarUrl: null,
      },
    });
    expect(html).toContain('已连接 Synthetic User');
    expect(html).toContain('>断开授权</button>');
    expect(html.match(/<button\b/g)).toHaveLength(1);
  });
});

describe('plugin authorization ownership', () => {
  it('opens the launch document synchronously without starting OAuth in the parent', async () => {
    const { popup, open } = browser();
    const pending = openPluginAuthorization(PLUGIN, new AbortController().signal);
    expect(open).toHaveBeenCalledWith(
      '/skill-oauth/github/launch?name=GitHub',
      '_blank',
      'popup,width=720,height=760',
    );
    expect(popup.opener).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(auth).not.toHaveBeenCalled();
    expect(await pending).toEqual({ type: 'browser', window: popup });
  });

  it('does not start an authorization flow when the popup is blocked', async () => {
    vi.stubGlobal('window', { open: () => null });
    await expect(openPluginAuthorization(PLUGIN, new AbortController().signal)).rejects.toThrow(
      '浏览器阻止了授权窗口',
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('lets the launch document initialize its cookie CSRF state and issue the start request', async () => {
    auth.mockResolvedValueOnce(AUTH);
    request.mockResolvedValueOnce(RESULT);
    const signal = new AbortController().signal;
    await expect(startPluginAuthorization('github', null, signal)).resolves.toBe(
      RESULT.authorizationUrl,
    );
    expect(auth).toHaveBeenCalledWith(signal);
    expect(request).toHaveBeenCalledWith('/skill-connections/github/oauth', 'POST', {}, signal);
  });

  it('uses one document request across React effect replay without caching credentials in Query', async () => {
    auth.mockResolvedValueOnce(AUTH);
    request.mockResolvedValueOnce(RESULT);
    const document = createPluginAuthorizationLaunch('github', null);
    const first = document.start();
    expect(document.start()).toBe(first);
    await expect(first).resolves.toBe(RESULT.authorizationUrl);
    expect(auth).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
  });

  it('does not start OAuth from an unauthenticated launch document', async () => {
    auth.mockResolvedValueOnce({ ...AUTH, authenticated: false });
    await expect(
      startPluginAuthorization('github', null, new AbortController().signal),
    ).rejects.toThrow('应用登录已失效');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a malformed or unsafe authorization URL from the daemon', async () => {
    for (const result of [{}, { authorizationUrl: 'javascript:alert(1)' }]) {
      auth.mockResolvedValueOnce(AUTH);
      request.mockResolvedValueOnce(result);
      await expect(
        startPluginAuthorization('github', null, new AbortController().signal),
      ).rejects.toThrow();
    }
  });

  it('opens the desktop launch ticket and lets the external document redeem it separately', async () => {
    const ticket = 'a'.repeat(43);
    const launchUrl = `http://127.0.0.1:4321/skill-oauth/github/launch?name=GitHub#ticket=${ticket}`;
    const open = vi.fn();
    const openExternal = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', { open, desktop: { openExternal } });
    request.mockResolvedValueOnce({ launchUrl, expiresAt: 600_000 });
    const signal = new AbortController().signal;
    await expect(openPluginAuthorization(PLUGIN, signal)).resolves.toEqual({
      type: 'desktop',
      expiresAt: 600_000,
    });
    expect(open).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith(launchUrl);
    expect(request).toHaveBeenLastCalledWith(
      '/skill-connections/github/oauth/launch-ticket',
      'POST',
      {},
      signal,
    );
    request.mockResolvedValueOnce(RESULT);
    await expect(startPluginAuthorization('github', ticket, signal)).resolves.toBe(
      RESULT.authorizationUrl,
    );
    expect(auth).not.toHaveBeenCalled();
    expect(request).toHaveBeenLastCalledWith(
      '/skill-connections/github/oauth/launch',
      'POST',
      { ticket },
      signal,
    );
  });

  it('reads public status and disconnects through the plugin credential endpoint', async () => {
    const signal = new AbortController().signal;
    get.mockResolvedValueOnce(STATUS);
    await expect(fetchPluginAuthorization('github', signal)).resolves.toEqual(STATUS);
    expect(get).toHaveBeenCalledWith('/skill-connections/github', signal);
    request.mockResolvedValueOnce(null);
    await disconnectPluginAuthorization('github', signal);
    expect(request).toHaveBeenCalledWith('/skill-connections/github', 'DELETE', {}, signal);
  });
});
