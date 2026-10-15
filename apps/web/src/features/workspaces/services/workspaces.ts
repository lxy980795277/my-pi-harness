import {
  WorkspaceSchema,
  type Workspace,
  type WorkspaceCreateInput,
  type WorkspaceRenameInput,
} from '@my-pi-harness/protocol';
import { Type } from 'typebox';
import { getJson, requestJson } from '@/services/base-request';
import { parseResponse } from '@/utils/parse-response';

/** Lists registered directories without inferring a workspace from the browser location. */
export const fetchWorkspaces = async (signal: AbortSignal): Promise<Workspace[]> => {
  return parseResponse(Type.Array(WorkspaceSchema), await getJson('/workspaces', signal));
};

/** Registers a host-validated existing directory; no filesystem is created by this command. */
export const createWorkspace = async (
  input: WorkspaceCreateInput,
  signal: AbortSignal,
): Promise<Workspace> => {
  return parseResponse(WorkspaceSchema, await requestJson('/workspaces', 'POST', input, signal));
};

/** Renames the selected registration using the revision shown when editing began. */
export const renameWorkspace = async (
  id: string,
  input: WorkspaceRenameInput,
  signal: AbortSignal,
): Promise<Workspace> => {
  return parseResponse(
    WorkspaceSchema,
    await requestJson(`/workspaces/${encodeURIComponent(id)}`, 'PUT', input, signal),
  );
};

/** Removes a registration only after the host confirms it has no retained conversations. */
export const removeWorkspace = async (id: string, signal: AbortSignal): Promise<void> => {
  await requestJson(`/workspaces/${encodeURIComponent(id)}`, 'DELETE', {}, signal);
};
