export { OFFICE_TOOL_DEFINITIONS } from './office/catalog.js';
export { executeOfficeTool } from './office/executor.js';
export type { OfficeProcessOptions } from './office/process.js';

export { TOOL_DEFINITIONS, describeTool } from './core/catalog.js';
export { ExecutionError } from './core/errors.js';
export { resolveWorkspaceRoot } from './filesystem/workspace-path.js';
export {
  workspacePath,
  openRegular,
  toWorkspaceRelativePath,
  isSensitiveName,
  isPortableFileName,
  parseWorkspaceRelativePath,
} from './filesystem/workspace-path.js';
export { extractPdf } from './documents/extract-pdf.js';
export { isPublicAddress } from './web/public-address.js';
export type { WorkspaceRootInput } from './filesystem/workspace-path.js';
export type {
  ExecutionContent,
  ExecutionContext,
  ExecutionResult,
  FileMutationToolName,
  ShellAccess,
  ToolDescription,
  WorkspacePathPlatform,
  WebFetchGatewayAccess,
  WebFetchContext,
} from './core/types.js';

export { extractDocument } from './documents/extract-document.js';
export { resolvePersistentProcess, startPersistentProcess } from './process/persistent.js';
export type {
  PersistentProcess,
  PersistentProcessInput,
  PersistentProcessLaunch,
  PersistentProcessObserver,
  ProcessScope,
} from './process/persistent.js';
export { executeTool, executeWebFetch } from './core/execute.js';
