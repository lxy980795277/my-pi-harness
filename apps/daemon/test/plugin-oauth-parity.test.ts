import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { PluginCredentialStore } from '@my-pi-harness/storage';
import type { PluginOAuthFetch } from '@my-pi-harness/integrations';
import { PluginConnectionService } from '../src/plugin-connections/service.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function gate() {
  let release = (): void => undefined;
  const promise = new Promise<void>((accept) => {
    release = accept;
  });
  return { promise, release };
}
function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') throw new Error('Expected an encoded OAuth request body');
  return init.body;
}
async function fixture(requestOverride?: PluginOAuthFetch) {
  let customRequest = requestOverride;
  const directory = await mkdtemp(join(tmpdir(), 'plugin-oauth-parity-'));
  cleanups.push(async () => await rm(directory, { recursive: true, force: true }));
  const credentials = await PluginCredentialStore.open(join(directory, 'skill-credentials.json'));
  const calls: { id: string; url: URL; init: RequestInit }[] = [];
  const installations = new Map(
    ['github', 'google'].map((id) => [
      id,
      { generation: `${id}-generation`, revision: 1, enabled: true },
    ]),
  );
  let identity = { ownerId: 'owner-fixture', epoch: 1 };
  let tokenVersion = 0;
  const changed: string[] = [];
  const request: PluginOAuthFetch = async (id, url, init) => {
    calls.push({ id, url, init });
    if (customRequest !== undefined) return await customRequest(id, url, init);
    if (url.pathname === '/user')
      return Response.json({
        id: 123,
        login: 'fixture',
        name: 'Fixture',
        avatar_url: 'https://example.com/avatar',
      });
    tokenVersion += 1;
    return Response.json({
      access_token: `token-${id}-${String(tokenVersion)}`,
      refresh_token: `refresh-${id}`,
      expires_in: 3600,
      id_token: `header.${Buffer.from(JSON.stringify({ sub: 'google-123', email: 'fixture@example.com', name: 'Google Fixture', picture: 'https://example.com/google-avatar' })).toString('base64url')}.signature`,
    });
  };
  const service = new PluginConnectionService({
    credentials,
    clients: {
      github: { clientId: 'github-client', clientSecret: 'github-secret' },
      google: { clientId: 'google-client', clientSecret: 'google-secret' },
    },
    installed: (id) => installations.get(id),
    identity: () => identity,
    origin: () => 'http://127.0.0.1:4311',
    request,
    onChanged: (id) => {
      changed.push(id);
      return Promise.resolve();
    },
  });
  cleanups.push(async () => await service.close());
  const start = async (id = 'github') => new URL((await service.startOAuth(id)).authorizationUrl);
  const callback = async (url: URL, id = 'github') =>
    await service.completeOAuth(
      id,
      new URLSearchParams({ state: url.searchParams.get('state') ?? '', code: 'fixture-code' }),
    );
  return {
    directory,
    credentials,
    service,
    calls,
    installations,
    changed,
    start,
    callback,
    identity: (value: typeof identity) => {
      identity = value;
    },
    setRequest: (request: PluginOAuthFetch) => {
      customRequest = request;
    },
  };
}

it('uses plugin clients, repo/user, isolated callbacks and PKCE then saves one shared plugin authorization', async () => {
  const f = await fixture();
  const url = await f.start();
  expect(url.origin).toBe('https://github.com');
  expect(url.searchParams.get('scope')).toBe('repo user');
  expect(url.searchParams.get('client_id')).toBe('github-client');
  expect(url.searchParams.get('redirect_uri')).toBe(
    'http://127.0.0.1:4311/api/skill-connections/github/oauth/callback',
  );
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(await f.service.status('github')).toEqual({
    collectionId: 'github',
    isConnected: false,
    account: null,
  });
  await f.callback(url);
  const tokenCall = f.calls.find((call) => call.url.pathname.endsWith('/access_token'));
  const body = new URLSearchParams(requestBody(tokenCall?.init));
  expect(body.get('client_secret')).toBe('github-secret');
  const verifier = body.get('code_verifier');
  if (verifier === null) throw new Error('Missing verifier');
  expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
    url.searchParams.get('code_challenge'),
  );
  expect(await f.service.status('github')).toMatchObject({
    isConnected: true,
    account: { id: '123', username: 'fixture', displayName: 'Fixture' },
  });
  expect((await f.service.requireCredential('github')).accessToken).toContain('token-github');
  expect(f.service.authority('github').accessEpoch).toBe(f.credentials.read('github')?.connectedAt);
  const publicStatus = JSON.stringify(await f.service.status('github'));
  expect(publicStatus).not.toContain('token-github');
  expect(publicStatus).not.toContain('github-secret');
  expect(await readFile(join(f.directory, 'skill-credentials.json'), 'utf8')).toContain(
    'token-github',
  );
  await expect(f.callback(url)).rejects.toMatchObject({ code: 'SKILL_OAUTH_STATE_INVALID' });
});

it('reads Google identity from id_token without calling userinfo and requests offline consent', async () => {
  const f = await fixture();
  const url = await f.start('google');
  expect(url.searchParams.get('access_type')).toBe('offline');
  expect(url.searchParams.get('prompt')).toBe('consent');
  const scopes = url.searchParams.get('scope')?.split(' ');
  expect(scopes).toContain('https://www.googleapis.com/auth/calendar.events.freebusy');
  expect(scopes).toContain('https://www.googleapis.com/auth/presentations');
  await f.callback(url, 'google');
  expect(await f.service.status('google')).toMatchObject({
    isConnected: true,
    account: { id: 'google-123', username: 'fixture@example.com' },
  });
  expect(f.calls).toHaveLength(1);
});

it('expires unconsumed state after ten minutes and rejects another plugin state', async () => {
  const f = await fixture();
  vi.useFakeTimers();
  const url = await f.start();
  await expect(f.callback(url, 'google')).rejects.toMatchObject({
    code: 'SKILL_OAUTH_STATE_INVALID',
  });
  vi.advanceTimersByTime(10 * 60_000);
  await expect(f.callback(url)).rejects.toMatchObject({ code: 'SKILL_OAUTH_STATE_INVALID' });
  expect(f.calls).toHaveLength(0);
});

it.each(['identity', 'installation'] as const)(
  'rejects a callback after %s ownership changes',
  async (change) => {
    const f = await fixture();
    const url = await f.start();
    if (change === 'identity') f.identity({ ownerId: 'other', epoch: 2 });
    else f.installations.set('github', { generation: 'replacement', revision: 1, enabled: true });
    await expect(f.callback(url)).rejects.toMatchObject({ code: 'SKILL_OAUTH_STATE_INVALID' });
    expect(f.calls).toHaveLength(0);
    expect(f.credentials.read('github')).toBeUndefined();
  },
);

it('disconnect wins an in-flight token exchange and leaves another plugin untouched', async () => {
  const entered = gate();
  const finish = gate();
  const f = await fixture();
  await f.callback(await f.start('google'), 'google');
  f.setRequest(async () => {
    entered.release();
    await finish.promise;
    return Response.json({ access_token: 'revoked-token' });
  });
  const url = await f.start();
  const completion = f.callback(url);
  const settled = completion.catch((error: unknown) => error);
  await entered.promise;
  await f.service.disconnect('github');
  finish.release();
  expect(await settled).toBeInstanceOf(Error);
  expect(f.credentials.read('github')).toBeUndefined();
  expect(await f.service.status('github')).toMatchObject({ isConnected: false });
  expect(await f.service.status('google')).toMatchObject({ isConnected: true });
});

it('keeps concurrent close callers waiting for OAuth operations and credential writes', async () => {
  const entered = gate();
  const finish = gate();
  const f = await fixture(async () => {
    entered.release();
    await finish.promise;
    return Response.json({ access_token: 'cancelled-token' });
  });
  const credentialsClose = vi.spyOn(f.credentials, 'close');
  const completion = f.callback(await f.start()).catch((error: unknown) => error);
  await entered.promise;
  const first = f.service.close();
  let secondFinished = false;
  const second = f.service.close().then(() => {
    secondFinished = true;
  });
  try {
    await Promise.resolve();
    expect(secondFinished).toBe(false);
    expect(credentialsClose).not.toHaveBeenCalled();
    await expect(f.start()).rejects.toMatchObject({ code: 'SKILL_CONNECTION_CLOSED' });
  } finally {
    finish.release();
    await Promise.all([first, second]);
  }
  expect(await completion).toBeInstanceOf(Error);
  expect(f.credentials.read('github')).toBeUndefined();
  expect(credentialsClose).toHaveBeenCalledTimes(1);
});

it('disconnect invalidates a refresh already waiting on the supplier and cannot restore a token', async () => {
  const f = await fixture();
  await f.callback(await f.start());
  const credential = f.credentials.read('github');
  if (credential === undefined) throw new Error('Missing fixture token');
  await f.credentials.set('github', { ...credential, expiresAt: Date.now() + 1 });
  const entered = gate();
  const finish = gate();
  f.setRequest(async () => {
    entered.release();
    await finish.promise;
    return Response.json({ access_token: 'revoked-refresh', expires_in: 3600 });
  });
  const refreshing = f.service.requireCredential('github');
  const settled = refreshing.catch((error: unknown) => error);
  await entered.promise;
  await f.service.disconnect('github');
  finish.release();
  expect(await settled).toBeInstanceOf(Error);
  expect(f.credentials.read('github')).toBeUndefined();
  expect(await readFile(join(f.directory, 'skill-credentials.json'), 'utf8')).not.toContain(
    'revoked-refresh',
  );
});

it('invalid refresh grants erase the plugin credential and return disconnected status', async () => {
  const f = await fixture();
  await f.callback(await f.start());
  const credential = f.credentials.read('github');
  if (credential === undefined) throw new Error('Missing fixture token');
  await f.credentials.set('github', { ...credential, expiresAt: Date.now() + 1 });
  f.setRequest(() =>
    Promise.resolve(
      Response.json(
        { error: 'invalid_grant', error_description: 'sensitive details' },
        { status: 400 },
      ),
    ),
  );
  expect(await f.service.status('github')).toMatchObject({ isConnected: false });
  expect(f.credentials.read('github')).toBeUndefined();
});

it.each(['success', 'invalid_grant'] as const)(
  'an old refresh %s cannot overwrite or erase a newly completed authorization',
  async (result) => {
    const f = await fixture();
    await f.callback(await f.start());
    const previous = f.credentials.read('github');
    if (previous === undefined) throw new Error('Missing fixture token');
    await f.credentials.set('github', { ...previous, expiresAt: Date.now() + 1 });
    const nextAuthorization = await f.start();
    const entered = gate();
    const finish = gate();
    f.setRequest(async (_id, url, init) => {
      if (url.pathname === '/user') return Response.json({ id: 'new-account', login: 'new-login' });
      if (new URLSearchParams(requestBody(init)).get('grant_type') === 'refresh_token') {
        entered.release();
        await finish.promise;
        if (result === 'invalid_grant')
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        return Response.json({ access_token: 'obsolete-refreshed-token', expires_in: 3600 });
      }
      return Response.json({ access_token: 'new-authorization-token', expires_in: 3600 });
    });
    const refreshing = f.service.requireCredential('github');
    const settled = refreshing.catch((error: unknown) => error);
    await entered.promise;
    await f.callback(nextAuthorization);
    finish.release();
    expect(await settled).toBeInstanceOf(Error);
    expect(f.credentials.read('github')?.accessToken).toBe('new-authorization-token');
    expect(await f.service.status('github')).toMatchObject({
      isConnected: true,
      account: { id: 'new-account' },
    });
  },
);

it('a newer authorization cancels an older callback that is already exchanging code', async () => {
  const entered = gate();
  const finish = gate();
  const f = await fixture(async () => {
    entered.release();
    await finish.promise;
    return Response.json({ access_token: 'older-token' });
  });
  const first = await f.start();
  const completion = f.callback(first);
  const settled = completion.catch((error: unknown) => error);
  await entered.promise;
  const second = await f.start();
  expect(first.searchParams.get('state')).not.toBe(second.searchParams.get('state'));
  finish.release();
  expect(await settled).toBeInstanceOf(Error);
  expect(f.credentials.read('github')).toBeUndefined();
});

it('refreshes at sixty seconds, coalesces requests and preserves account and connectedAt', async () => {
  const f = await fixture();
  await f.callback(await f.start());
  const credential = f.credentials.read('github');
  if (credential === undefined) throw new Error('Missing fixture token');
  await f.credentials.set('github', { ...credential, expiresAt: Date.now() + 60_000 });
  const before = f.calls.length;
  const [first, second] = await Promise.all([
    f.service.requireCredential('github'),
    f.service.requireCredential('github'),
  ]);
  expect(first.accessToken).toBe(second.accessToken);
  expect(first.connectedAt).toBe(credential.connectedAt);
  expect(first.account).toEqual(credential.account);
  expect(f.calls.length - before).toBe(1);
  expect(new URLSearchParams(requestBody(f.calls.at(-1)?.init)).get('grant_type')).toBe(
    'refresh_token',
  );
});

it('deletes expired tokens without refresh capability and permits disabled plugin status but blocks token use', async () => {
  const f = await fixture();
  await f.callback(await f.start());
  const credential = f.credentials.read('github');
  if (credential === undefined) throw new Error('Missing fixture token');
  f.installations.set('github', { generation: 'github-generation', revision: 2, enabled: false });
  expect(await f.service.status('github')).toMatchObject({ isConnected: true });
  await expect(f.service.requireCredential('github')).rejects.toMatchObject({
    code: 'SKILL_COLLECTION_DISABLED',
  });
  const expired = { ...credential, expiresAt: 1 };
  delete expired.refreshToken;
  await f.credentials.set('github', expired);
  expect(await f.service.status('github')).toMatchObject({ isConnected: false });
  expect(f.credentials.read('github')).toBeUndefined();
});
