import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, parse } from 'node:path';
import { ToolError } from './tool-registry.js';

export interface PythonRuntime {
  program: string;
  readOnlyDirectories: readonly string[];
}
/** Explicit interpreter configuration grants only its installation prefixes as read-only runtime data. */
export async function resolvePythonRuntime(
  program: string,
  signal: AbortSignal,
): Promise<PythonRuntime> {
  signal.throwIfAborted();
  if (!isAbsolute(program))
    throw new ToolError('INVALID_PROGRAM', 'Python解释器必须使用绝对路径。');
  await access(program, constants.X_OK);
  const target = await realpath(program);
  const roots = new Set<string>();
  for (const executable of [program, target]) {
    const binaries = dirname(executable);
    if (basename(binaries) !== 'bin') continue;
    const prefix = await realpath(dirname(binaries));
    if (prefix === parse(prefix).root)
      throw new ToolError('INVALID_RESOURCE', 'Python运行时目录不能是系统根。');
    roots.add(prefix);
  }
  signal.throwIfAborted();
  return { program, readOnlyDirectories: [...roots] };
}
