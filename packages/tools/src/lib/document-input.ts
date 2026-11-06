import { checkCancelled } from '@my-pi-harness/sandbox';
import {
  canonicalWorkspace,
  readStableFile,
  workspacePath,
} from '@my-pi-harness/sandbox/filesystem';
import type { WorkspaceToolContext } from './tool-context';

/** Read a bounded, stable workspace file after canonical root and path checks. */
export async function readDocumentInput(
  path: string,
  context: WorkspaceToolContext,
  maximum: number,
): Promise<Buffer> {
  checkCancelled(context.signal);
  const root = await canonicalWorkspace(context);
  return readStableFile(await workspacePath(root, path), context.signal, maximum);
}
