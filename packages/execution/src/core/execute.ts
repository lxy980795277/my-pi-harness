import { describeTool, validateArguments } from './catalog.js';
import { ExecutionError, checkCancelled } from './errors.js';
import {
  listFilesTool,
  readFileTool,
  searchFilesTool,
  writeFileTool,
} from '../filesystem/tools.js';
import { shellTool } from '../process/shell.js';
import type { ExecutionContext, ExecutionResult, WebFetchContext } from './types.js';
import { webFetchTool } from '../web/fetch.js';
import { canonicalWorkspace } from '../filesystem/workspace-path.js';
import { OFFICE_TOOL_DEFINITIONS } from '../office/catalog.js';
import { executeOfficeTool } from '../office/executor.js';

/** Execute a validated public or host-authorized gateway request without filesystem access. */
export async function executeWebFetch(
  args: Record<string, unknown>,
  context: WebFetchContext,
): Promise<ExecutionResult> {
  validateArguments('web_fetch', args);
  checkCancelled(context.signal);
  return await webFetchTool(args, context);
}

/** Execute only after the caller has persisted intent and obtained any required approval. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  validateArguments(name, args);
  checkCancelled(context.signal);
  if (context.readOnly && describeTool(name, args).mutating)
    throw new ExecutionError('READ_ONLY', 'This operation is disabled by the current policy');
  if (name === 'web_fetch') return await webFetchTool(args, context);
  if (OFFICE_TOOL_DEFINITIONS.some((tool) => tool.name === name))
    return await executeOfficeTool(
      name,
      args,
      context,
      context.officePythonPath ? { pythonPath: context.officePythonPath } : {},
    );
  try {
    const root = await canonicalWorkspace(context);
    switch (name) {
      case 'read_file':
        return await readFileTool(args, root, context);
      case 'list_files':
        return await listFilesTool(args, root, context);
      case 'search_files':
        return await searchFilesTool(args, root, context);
      case 'write_file':
      case 'edit_file':
        return await writeFileTool(name, args, root, context);
      case 'shell':
        return await shellTool(args, root, context);
      default:
        throw new ExecutionError('UNKNOWN_TOOL', 'The requested tool is not available');
    }
  } catch (cause) {
    if (cause instanceof ExecutionError) throw cause;
    checkCancelled(context.signal);
    throw new ExecutionError(
      'FILE_OPERATION_FAILED',
      'The requested workspace operation could not complete',
      { cause },
    );
  }
}
