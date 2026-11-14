import { afterEach, describe, expect, it, vi } from 'vitest';
import release from '../../scripts/desktop-release.cjs';
import signing from '../../scripts/verify-desktop-signing.cjs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';

async function signedVerifier(execute) {
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  const source = await readFile(
    new URL('../../scripts/verify-desktop-signing.cjs', import.meta.url),
    'utf8',
  );
  new Script(source).runInNewContext({
    module,
    process: { env: { MY_PI_HARNESS_DESKTOP_SIGNING: 'signed' }, platform: 'darwin' },
    require: (name) => {
      if (name === 'node:util') return { promisify: () => execute };
      if (name === './desktop-release.cjs') return release;
      return require(name);
    },
  });
  return module.exports;
}

afterEach(() => vi.unstubAllEnvs());

describe('desktop release configuration', () => {
  it('verifies actual signed installers and application tickets without build secrets and rejects missing trust', async () => {
    const execute = vi.fn().mockResolvedValue({
      stderr: 'Authority=Developer ID Application: Fixture\nTeamIdentifier=ABC123\n',
    });
    const verifier = await signedVerifier(execute);
    await verifier.verifyDesktopInstallers(['/fixture.dmg']);
    await verifier.verifyDesktopApplication('/installed', 'darwin', 'Fixture');
    expect(execute).toHaveBeenCalledWith('xcrun', [
      'stapler',
      'validate',
      '/installed/Fixture.app',
    ]);
    expect(execute).toHaveBeenCalledWith('codesign', [
      '--verify',
      '--deep',
      '--strict',
      '/fixture.dmg',
    ]);
    execute.mockResolvedValue({ stderr: 'Signature=adhoc\nTeamIdentifier=not set\n' });
    await expect(verifier.verifyDesktopInstallers(['/fixture.dmg'])).rejects.toThrow(
      'Developer ID',
    );
    execute.mockRejectedValue(new Error('invalid signature'));
    await expect(verifier.verifyDesktopInstallers(['/fixture.exe'])).rejects.toThrow(
      'invalid signature',
    );
  });
  it('selects a signed artifact on a credential-free verification host while builds still require credentials', () => {
    const environment = { MY_PI_HARNESS_DESKTOP_SIGNING: 'signed' };
    expect(release.desktopSigningMode(environment)).toEqual({ mode: 'signed', signed: true });
    expect(() => release.desktopReleaseOptions(environment, 'darwin')).toThrow('CSC_NAME');
    expect(() => release.desktopReleaseOptions(environment, 'win32')).toThrow('WIN_CSC_LINK');
    expect(release.desktopSigningMode({})).toEqual({ mode: 'unsigned', signed: false });
    expect(() => release.desktopSigningMode({ MY_PI_HARNESS_DESKTOP_SIGNING: '' })).toThrow(
      'unsigned or signed',
    );
  });
  it('does not require signing tools or real application files for an unsigned build', async () => {
    vi.stubEnv('MY_PI_HARNESS_DESKTOP_SIGNING', 'unsigned');
    await expect(
      signing.verifyDesktopApplication('/missing-app', process.platform, 'fixture'),
    ).resolves.toBeUndefined();
    await expect(
      signing.verifyDesktopInstallers(['/missing-installer.dmg']),
    ).resolves.toBeUndefined();
  });
  it('keeps candidates explicitly unsigned even when the host happens to have signing credentials', () => {
    const options = release.desktopReleaseOptions(
      { CSC_NAME: 'unused', CSC_LINK: 'unused' },
      'darwin',
    );
    expect(options).toMatchObject({
      mode: 'unsigned',
      signed: false,
      mac: {
        identity: null,
        hardenedRuntime: false,
        notarize: false,
        binaries: ['Contents/Resources/node/node'],
      },
      win: { signExecutable: false },
    });
  });

  it('refuses incomplete signing and notarization settings before invoking the packager', () => {
    expect(() =>
      release.desktopReleaseOptions(
        { MY_PI_HARNESS_DESKTOP_SIGNING: 'signed', CSC_NAME: '-' },
        'darwin',
      ),
    ).toThrow('Ad-hoc');
    expect(() =>
      release.desktopReleaseOptions({ MY_PI_HARNESS_DESKTOP_SIGNING: 'yes' }, 'darwin'),
    ).toThrow('unsigned or signed');
    expect(() =>
      release.desktopReleaseOptions({ MY_PI_HARNESS_DESKTOP_SIGNING: 'signed' }, 'darwin'),
    ).toThrow('CSC_NAME');
    expect(() =>
      release.desktopReleaseOptions(
        { MY_PI_HARNESS_DESKTOP_SIGNING: 'signed', CSC_NAME: 'fixture' },
        'darwin',
      ),
    ).toThrow('notarization');
    expect(() =>
      release.desktopReleaseOptions(
        {
          MY_PI_HARNESS_DESKTOP_SIGNING: 'signed',
          CSC_NAME: 'fixture',
          APPLE_ID: 'fixture',
          APPLE_KEYCHAIN_PROFILE: 'fixture',
        },
        'darwin',
      ),
    ).toThrow('APPLE_APP_SPECIFIC_PASSWORD');
    expect(() =>
      release.desktopReleaseOptions({ MY_PI_HARNESS_DESKTOP_SIGNING: 'signed' }, 'win32'),
    ).toThrow('WIN_CSC_LINK');
  });

  it.each([
    { APPLE_ID: 'fixture', APPLE_APP_SPECIFIC_PASSWORD: 'fixture', APPLE_TEAM_ID: 'fixture' },
    { APPLE_API_KEY: 'fixture', APPLE_API_KEY_ID: 'fixture', APPLE_API_ISSUER: 'fixture' },
    { APPLE_KEYCHAIN_PROFILE: 'fixture' },
  ])(
    'enables enforced macOS signing and notarization with one complete credential source',
    (credentials) => {
      const options = release.desktopReleaseOptions(
        {
          MY_PI_HARNESS_DESKTOP_SIGNING: 'signed',
          CSC_LINK: 'fixture',
          CSC_KEY_PASSWORD: 'fixture',
          ...credentials,
        },
        'darwin',
      );
      expect(options).toMatchObject({
        signed: true,
        mac: { hardenedRuntime: true, notarize: true },
      });
    },
  );

  it('enables signed Windows executables, native modules and installers with explicit credentials', () => {
    expect(
      release.desktopReleaseOptions(
        {
          MY_PI_HARNESS_DESKTOP_SIGNING: 'signed',
          WIN_CSC_LINK: 'fixture',
          WIN_CSC_KEY_PASSWORD: 'fixture',
        },
        'win32',
      ),
    ).toMatchObject({
      signed: true,
      win: { signExecutable: true, signExts: ['.exe', '.dll', '.node'] },
    });
  });

  it('chooses only the current native host and architecture without forwarding cross-build flags', () => {
    expect(release.desktopBuildArguments(['installer'], 'darwin', 'arm64')).toEqual([
      '--config',
      'electron-builder.config.cjs',
      '--mac',
      'dmg',
      '--arm64',
      '--publish',
      'never',
    ]);
    expect(release.desktopBuildArguments(['installer'], 'win32', 'x64')).toContain('nsis');
    expect(release.desktopBuildArguments(['dir'], 'linux', 'x64')).toContain('dir');
    expect(() => release.desktopBuildArguments(['installer', '--win'], 'darwin', 'arm64')).toThrow(
      'current host',
    );
    expect(() => release.desktopBuildArguments(['installer'], 'linux', 'x64')).toThrow(
      'macOS DMG and Windows NSIS',
    );
    expect(() => release.desktopBuildArguments(['dir'], 'darwin', 'ia32')).toThrow('architecture');
  });
});
