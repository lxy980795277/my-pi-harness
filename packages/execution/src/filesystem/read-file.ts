import { ExecutionError, checkCancelled } from '../core/errors.js';
import { openRegular } from './workspace-path.js';

/**
 * Read bounded bytes from an already resolved file and reject observed changes.
 * @param path Path resolved by the caller's workspace and protected-path policy.
 * @param signal Cancellation of the owning operation.
 * @param maximum Maximum bytes accepted, including growth after opening.
 * @returns Stable observed bytes; the file handle is closed on every outcome.
 */
export async function readStableFile(
  path: string,
  signal: AbortSignal,
  maximum: number,
): Promise<Buffer> {
  checkCancelled(signal);
  const handle = await openRegular(path, maximum);
  try {
    const before = await handle.stat();
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < buffer.length) {
      checkCancelled(signal);
      const chunk = await handle.read(buffer, length, buffer.length - length, length);
      if (chunk.bytesRead === 0) break;
      length += chunk.bytesRead;
    }
    const after = await handle.stat();
    if (length > maximum)
      throw new ExecutionError('FILE_TOO_LARGE', 'File grew beyond its size limit');
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new ExecutionError('FILE_CHANGED', 'File changed while reading');
    checkCancelled(signal);
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}
