import type { AgentRole } from '@my-pi-harness/protocol';
import type { FrozenMcpTool } from './external.js';
import { RunToolset, type RunToolSelection } from './toolset.js';

const READ_ONLY_WORKSPACE_TOOLS = new Set([
  'read_file',
  'list_files',
  'search_files',
  'office_inspect',
  'pdf_read_pages',
]);
const TASK_SESSION_TOOLS = new Set([
  'web_fetch',
  'ask_user',
  'update_plan',
  'update_plan_steps',
  'update_todos',
  'search_session_history',
  'tool_search',
  'load_tools',
  'skill_search',
  'load_skill',
  'read_skill_resource',
  'request_skill_tools',
  'revoke_skill_tools',
  'spawn_agent',
  'get_agent_status',
  'wait_agents',
  'send_agent_message',
  'stop_agent',
]);

/** Workspace names have fixed owned semantics; Shell is never inferred read-only from its text. */
export function isReadOnlyWorkspaceTool(name: string): boolean {
  return READ_ONLY_WORKSPACE_TOOLS.has(name);
}

/** Filter a parent's frozen bindings; arguments and live read-only grants are checked again at dispatch. */
export function filterTaskToolset(parent: RunToolset, access: AgentRole['access']): RunToolset {
  return new RunToolset(parent.records.filter((record) => allowedTaskTool(record, access)));
}

/** A discovery candidate cannot bypass the task's role through a later load_tools call. */
export function allowedTaskCandidates(
  candidates: readonly FrozenMcpTool[],
  access: AgentRole['access'],
): FrozenMcpTool[] {
  if (access === 'write') return [...candidates];
  return candidates.filter((tool) => tool.authorization.readOnlyGrantId !== undefined);
}

function allowedTaskTool(record: RunToolSelection, access: AgentRole['access']): boolean {
  if (record.source.kind === 'session') return TASK_SESSION_TOOLS.has(record.definition.name);
  if (access === 'write') return true;
  if (record.source.kind === 'workspace') return isReadOnlyWorkspaceTool(record.definition.name);
  return record.external?.authorization.readOnlyGrantId !== undefined;
}
