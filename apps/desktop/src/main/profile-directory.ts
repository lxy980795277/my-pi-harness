import { join, win32 } from 'node:path';

/** Desktop-owned platform data paths used by the independent daemon. */
export interface ProfilePaths {
  platform: NodeJS.Platform;
  userData: string;
  home: string;
  localAppData?: string;
}

/** Launch-owned JSONL location; profile databases and credential namespaces stay in place. */
export interface SessionLogPaths {
  packaged: boolean;
  developmentRoot: string;
  configuredRoot?: string;
}

/** Use local Windows data consistently with standalone daemon; other desktops use userData. */
export function resolveProfileDirectory(paths: ProfilePaths): string {
  if (paths.platform === 'win32') {
    const local = paths.localAppData ?? win32.join(paths.home, 'AppData', 'Local');
    return win32.join(local, 'My Pi Harness', 'profiles', 'default');
  }
  return join(paths.userData, 'profiles', 'default');
}

/** Packaged apps require an explicit repository log root; daemon validates any override. */
export function resolveSessionLogRoot(paths: SessionLogPaths): string {
  if (paths.configuredRoot !== undefined) return paths.configuredRoot;
  if (paths.packaged)
    throw new Error(
      '请设置 MY_PI_HARNESS_SESSION_LOG_ROOT 为仓库根目录下 .my-pi-harness 的绝对路径',
    );
  return join(paths.developmentRoot, '.my-pi-harness');
}
