import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

/** Resolve a picker/drop path to an existing local directory; registration owns root policy. */
export async function resolveWorkspaceDirectory(value: unknown): Promise<string> {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    value.includes('\0') ||
    !isAbsolute(value)
  )
    throw new Error('请选择有效的本机文件夹');
  try {
    const directory = await realpath(value);
    const info = await stat(directory);
    if (info.isDirectory()) return directory;
  } catch {
    // Filesystem details are private; missing and inaccessible selections share one safe error.
    throw new Error('请选择有效的本机文件夹');
  }
  throw new Error('请选择文件夹，不能选择文件');
}
