import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { resolveProfileDirectory, resolveSessionLogRoot } from '../src/main/profile-directory.js';

describe('desktop profile directory', () => {
  it('uses macOS userData, including spaces and Chinese paths', () => {
    expect(
      resolveProfileDirectory({
        platform: 'darwin',
        userData: '/Users/测试/Library/Application Support/My Pi Harness',
        home: '/Users/测试',
      }),
    ).toBe(join('/Users/测试/Library/Application Support/My Pi Harness', 'profiles', 'default'));
  });
  it('uses Windows LocalAppData instead of roaming Electron userData', () => {
    expect(
      resolveProfileDirectory({
        platform: 'win32',
        userData: 'C:\\Users\\测试\\AppData\\Roaming\\My Pi Harness',
        home: 'C:\\Users\\测试',
        localAppData: 'C:\\Users\\测试\\AppData\\Local',
      }),
    ).toBe('C:\\Users\\测试\\AppData\\Local\\My Pi Harness\\profiles\\default');
  });
  it('derives the same Windows fallback when LocalAppData is unavailable', () => {
    expect(
      resolveProfileDirectory({
        platform: 'win32',
        userData: 'C:\\unrelated',
        home: 'D:\\PC User',
      }),
    ).toBe('D:\\PC User\\AppData\\Local\\My Pi Harness\\profiles\\default');
  });
});

describe('desktop session log root', () => {
  const paths = { developmentRoot: '/projects/my-pi-harness' };

  it('uses the repository in development and requires an explicit root outside the repository', () => {
    expect(resolveSessionLogRoot({ ...paths, packaged: false })).toBe(
      join(paths.developmentRoot, '.my-pi-harness'),
    );
    expect(() => resolveSessionLogRoot({ ...paths, packaged: true })).toThrow(
      'MY_PI_HARNESS_SESSION_LOG_ROOT',
    );
  });

  it('preserves an explicit test or development root, including invalid values for daemon rejection', () => {
    const configuredRoot = '/temporary/isolated/.my-pi-harness';
    expect(resolveSessionLogRoot({ ...paths, packaged: true, configuredRoot })).toBe(
      configuredRoot,
    );
    expect(resolveSessionLogRoot({ ...paths, packaged: false, configuredRoot: '' })).toBe('');
  });
});
