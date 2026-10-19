import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { desktopOAuthEnvironment } from '../../scripts/desktop-oauth.mjs';

const directories = [];

async function fixture(content) {
  const root = await mkdtemp(join(tmpdir(), 'my-pi-desktop-oauth-'));
  directories.push(root);
  if (content !== undefined) await writeFile(join(root, '.env'), content);
  return root;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('desktop OAuth resource', () => {
  it('packages only the public Client ID from a root env containing private settings', async () => {
    const root = await fixture(
      'MY_PI_HARNESS_GITHUB_CLIENT_ID="fixture-client" # public\n' +
        'MY_PI_HARNESS_GITHUB_CLIENT_SECRET="fixture-private"\n' +
        'MY_PI_HARNESS_GITHUB_CALLBACK_URL=http://127.0.0.1:5174/api/auth/callback/github\n' +
        'OTHER_TOKEN=fixture-other-private\n',
    );
    const content = await desktopOAuthEnvironment(root, {});
    const packaged = content;
    expect(parseEnv(packaged)).toEqual({ MY_PI_HARNESS_GITHUB_CLIENT_ID: 'fixture-client' });
    expect(packaged).not.toContain('fixture-private');
    expect(packaged).not.toContain('fixture-other-private');
  });

  it('prefers the explicit build environment to the local env file', async () => {
    const root = await fixture('MY_PI_HARNESS_GITHUB_CLIENT_ID=local-client\n');
    expect(
      await desktopOAuthEnvironment(root, { MY_PI_HARNESS_GITHUB_CLIENT_ID: 'build-client' }),
    ).toBe('MY_PI_HARNESS_GITHUB_CLIENT_ID=build-client\n');
  });

  it('supports an environment-only build without requiring a local env file', async () => {
    const root = await fixture();
    expect(
      await desktopOAuthEnvironment(root, { MY_PI_HARNESS_GITHUB_CLIENT_ID: 'build-client' }),
    ).toBe('MY_PI_HARNESS_GITHUB_CLIENT_ID=build-client\n');
  });

  it.each(['', 'bad\nOTHER_TOKEN=injected', ' '.repeat(2), 'x'.repeat(201)])(
    'rejects an invalid build override without falling back or printing the value',
    async (clientId) => {
      const root = await fixture('MY_PI_HARNESS_GITHUB_CLIENT_ID=local-client\n');
      await expect(
        desktopOAuthEnvironment(root, { MY_PI_HARNESS_GITHUB_CLIENT_ID: clientId }),
      ).rejects.toThrow('桌面打包需要有效的 MY_PI_HARNESS_GITHUB_CLIENT_ID，请配置根 .env');
    },
  );

  it('fails an unconfigured build rather than shipping an unusable login', async () => {
    const root = await fixture('MY_PI_HARNESS_GITHUB_CLIENT_SECRET=fixture-private\n');
    await expect(desktopOAuthEnvironment(root, {})).rejects.toThrow(
      'MY_PI_HARNESS_GITHUB_CLIENT_ID',
    );
  });
});
