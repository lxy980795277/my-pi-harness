import { join, win32 } from 'node:path';

/** Desktop-owned platform data paths used by the independent daemon. */
export interface ProfilePaths {
  platform: NodeJS.Platform;
  userData: string;
  home: string;
  localAppData?: string;
}

/** Use local Windows data consistently with standalone daemon; other desktops use userData. */
export function resolveProfileDirectory(paths: ProfilePaths): string {
  if (paths.platform === 'win32') {
    const local = paths.localAppData ?? win32.join(paths.home, 'AppData', 'Local');
    return win32.join(local, 'My Pi Harness', 'profiles', 'default');
  }
  return join(paths.userData, 'profiles', 'default');
}
