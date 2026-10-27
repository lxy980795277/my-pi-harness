import type { AuthStatus, RemoteMcpView } from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAuthStatus } from '@/features/auth/services/auth';
import {
  createPluginAppAuthorizationLaunch,
  openPluginAppAuthorization,
  startPluginAppAuthorization,
} from '@/features/plugins/services/plugin-app-authorization';
import { getJson, requestJson } from '@/services/base-request';

vi.mock('@/services/base-request', () => ({ getJson: vi.fn(), requestJson: vi.fn() }));
vi.mock('@/features/auth/services/auth', () => ({ fetchAuthStatus: vi.fn() }));

const SERVER: RemoteMcpView = {
  id: 'synthetic-app',
  name: 'Notion',
  revision: 3,
  accessEpoch: 4,
  endpoint: 'https://example.com/mcp',
  transport: 'streamable-http',
  publicHeaders: {},
  secretHeaders: [],
  oauth: true,
  oauthConnected: false,
  catalogStatus: 'idle',
  trusted: true,
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
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
const RESULT = {
  url: 'https://example.com/oauth/authorize?state=synthetic',
  state: 'synthetic',
  expiresAt: 600_000,
};
const get = vi.mocked(getJson);
const request = vi.mocked(requestJson);
const auth = vi.mocked(fetchAuthStatus);

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('independent plugin App launch documents', () => {
  it('opens an MCP launch document synchronously without starting OAuth in the plugin page', async () => {
    const popup = { opener: {}, closed: false };
    const open = vi.fn(() => popup);
    vi.stubGlobal('window', { open });
    const result = openPluginAppAuthorization(SERVER, new AbortController().signal);
    expect(open).toHaveBeenCalledWith(
      '/mcp-oauth/synthetic-app/launch?name=Notion',
      '_blank',
      'popup,width=720,height=760',
    );
    expect(popup.opener).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(await result).toEqual({ type: 'browser', window: popup });
  });

  it('reads current server authority in the launch document before starting OAuth', async () => {
    auth.mockResolvedValueOnce(AUTH);
    get.mockResolvedValueOnce(SERVER);
    request.mockResolvedValueOnce(RESULT);
    const signal = new AbortController().signal;
    await expect(startPluginAppAuthorization(SERVER.id, null, signal)).resolves.toBe(RESULT.url);
    expect(get).toHaveBeenCalledWith('/mcp/remote-servers/synthetic-app', signal);
    expect(request).toHaveBeenCalledWith(
      '/mcp/remote-servers/synthetic-app/oauth/start',
      'POST',
      { expectedRevision: 3, expectedAccessEpoch: 4 },
      signal,
      45_000,
    );
  });

  it('consumes a desktop launch capability once across effect replay without browser login', async () => {
    request.mockResolvedValueOnce(RESULT);
    const ticket = 'a'.repeat(43);
    const document = createPluginAppAuthorizationLaunch(SERVER.id, ticket);
    const first = document.start();
    expect(document.start()).toBe(first);
    await expect(first).resolves.toBe(RESULT.url);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      '/mcp/remote-servers/synthetic-app/oauth/launch',
      'POST',
      { ticket },
      expect.any(AbortSignal),
      45_000,
    );
    expect(auth).not.toHaveBeenCalled();
  });
});
