import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionView } from '@my-pi-harness/protocol';
import { connectionAction } from '@/features/connections/services/connections';
import {
  beginConnectionAuthorization,
  reopenConnectionAuthorization,
  showConnectionAuthorization,
} from '@/features/connections/services/oauth-launch';
import { oauthLaunchPresentation } from '@/features/connections/utils/oauth-launch';

vi.mock('@/features/connections/services/connections', () => ({ connectionAction: vi.fn() }));

const ACCOUNT: ConnectionView = {
  id: 'synthetic-account',
  serviceId: 'github',
  name: 'Private account name',
  authMode: 'oauth',
  clientId: 'synthetic-client',
  scopes: ['read:user'],
  revision: 3,
  accessEpoch: 4,
  connected: false,
  clientSecretConfigured: true,
  accountId: null,
  accountName: null,
  createdAt: 1,
  updatedAt: 1,
};
const RESULT = {
  url: 'https://github.com/login/oauth/authorize?state=synthetic-state',
  expiresAt: 300_000,
};
const action = vi.mocked(connectionAction);

function browser() {
  const popup = {
    opener: {},
    closed: false,
    close: vi.fn(),
    location: { replace: vi.fn() },
  };
  const open = vi.fn(() => popup);
  vi.stubGlobal('window', { open, location: { origin: 'http://127.0.0.1:4321' } });
  return { popup, open };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('connection OAuth browser launch', () => {
  it('opens the inert page before starting HTTP, isolates its opener and detaches request cleanup after navigation', async () => {
    const { popup, open } = browser();
    action.mockImplementation(() => {
      expect(open).toHaveBeenCalledOnce();
      expect(popup.opener).toBeNull();
      expect(popup.location.replace).not.toHaveBeenCalled();
      return Promise.resolve(RESULT);
    });
    const controller = new AbortController();
    const pending = beginConnectionAuthorization(ACCOUNT, controller.signal);
    expect(open).toHaveBeenCalledWith(
      'http://127.0.0.1:4321/connection-oauth/launch?service=github',
      '_blank',
      'popup,width=720,height=760',
    );
    const launch = await pending;
    await showConnectionAuthorization(launch);
    expect(popup.location.replace).toHaveBeenCalledWith(RESULT.url);
    controller.abort();
    expect(popup.close).not.toHaveBeenCalled();
    await reopenConnectionAuthorization(ACCOUNT, launch.url);
    expect(open).toHaveBeenCalledTimes(2);
    expect(action).toHaveBeenCalledOnce();
  });

  it('does not create an OAuth flow when the browser blocks its window', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:4321' }, open: () => null });
    await expect(
      beginConnectionAuthorization(ACCOUNT, new AbortController().signal),
    ).rejects.toThrow('浏览器阻止了授权窗口');
    expect(action).not.toHaveBeenCalled();
  });

  it('closes only the owned interim window on start failure or invalid authorization URL', async () => {
    for (const result of [
      new Error('synthetic-start-failure'),
      { ...RESULT, url: 'javascript:alert(1)' },
    ]) {
      const { popup } = browser();
      if (result instanceof Error) action.mockRejectedValueOnce(result);
      else action.mockResolvedValueOnce(result);
      await expect(
        beginConnectionAuthorization(ACCOUNT, new AbortController().signal),
      ).rejects.toThrow();
      expect(popup.close).toHaveBeenCalledOnce();
      expect(popup.location.replace).not.toHaveBeenCalled();
    }
  });

  it('closes a pending window on abort without navigating a late start response', async () => {
    const { popup } = browser();
    let finish = (_value: unknown): void => undefined;
    action.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = beginConnectionAuthorization(ACCOUNT, controller.signal);
    controller.abort();
    expect(popup.close).toHaveBeenCalled();
    finish(RESULT);
    await expect(pending).rejects.toThrow();
    expect(popup.location.replace).not.toHaveBeenCalled();
  });

  it('preserves the returned authorization when its window was closed before the response', async () => {
    const { popup } = browser();
    action.mockResolvedValueOnce(RESULT);
    const pending = beginConnectionAuthorization(ACCOUNT, new AbortController().signal);
    popup.closed = true;
    const launch = await pending;
    expect(launch.url).toBe(RESULT.url);
    await expect(showConnectionAuthorization(launch)).rejects.toThrow('授权窗口已关闭');
    expect(action).toHaveBeenCalledOnce();
    expect(popup.location.replace).not.toHaveBeenCalled();
  });

  it('keeps desktop OAuth in the authenticated renderer and opens the provider through the desktop bridge', async () => {
    const open = vi.fn();
    const openExternal = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', { open, desktop: { openExternal } });
    action.mockResolvedValueOnce(RESULT);
    const launch = await beginConnectionAuthorization(ACCOUNT, new AbortController().signal);
    expect(launch.popup).toBeNull();
    expect(open).not.toHaveBeenCalled();
    await showConnectionAuthorization(launch);
    expect(openExternal).toHaveBeenCalledWith(RESULT.url);
    await reopenConnectionAuthorization(ACCOUNT, launch.url);
    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(action).toHaveBeenCalledOnce();
  });

  it('accepts only registered provider labels and rejects account or redirect query parameters', () => {
    expect(oauthLaunchPresentation('?service=github')).toMatchObject({ valid: true });
    for (const search of [
      '',
      '?service=unknown',
      '?service=github&service=google',
      '?service=github&url=https://example.com',
      '?service=github&name=private-account',
    ]) {
      expect(oauthLaunchPresentation(search)).toMatchObject({ valid: false });
    }
  });
});
