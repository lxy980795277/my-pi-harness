export {
  canonicalWorkspace,
  resolveWorkspaceRoot,
  workspacePath,
  openRegular,
  parseWorkspaceRelativePath,
  toWorkspaceRelativePath,
  isPortableFileName,
  isSensitiveName,
} from './workspace-path.js';
export { readStableFile } from './read-file.js';
export type {
  WorkspaceContext,
  WorkspaceRootInput,
  WorkspacePathPlatform,
} from './workspace-path.js';
export { SandboxError, checkCancelled, isMissing } from '../errors.js';
