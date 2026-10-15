import { describe, expect, it } from 'vitest';
import { resolveProfileDirectory } from '../src/main/profile-directory.js';

describe('desktop profile directory', () => {
  it('uses macOS userData, including spaces and Chinese paths', () => {
    expect(
      resolveProfileDirectory({
        platform: 'darwin',
        userData: '/Users/测试/Library/Application Support/My Pi Harness',
        home: '/Users/测试',
      }),
    ).toBe('/Users/测试/Library/Application Support/My Pi Harness/profiles/default');
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
