import { join } from 'node:path';

/** Launch-owned JSONL location; profile databases and credential namespaces stay in place. */
export interface SessionLogPaths {
  packaged: boolean;
  developmentRoot: string;
  configuredRoot?: string;
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
