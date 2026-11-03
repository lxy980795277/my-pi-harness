import type { AgentRole } from '@my-pi-harness/protocol';
import type { FrozenMcpTool } from './external.js';
import type { RunToolSelection } from './toolset.js';
import { nativeTool } from './catalog.js';

/** A discovery candidate cannot bypass the task's role through later activation. */
export function allowedTaskCandidates(
  candidates: readonly FrozenMcpTool[],
  access: AgentRole['access'],
): FrozenMcpTool[] {
  if (access === 'write') return [...candidates];
  return candidates.filter((tool) => tool.authorization.readOnlyGrantId !== undefined);
}

/** A task inherits only known native operations or external bindings allowed by its role. */
export function allowedTaskTool(record: RunToolSelection, access: AgentRole['access']): boolean {
  if (record.source.kind === 'mcp')
    return access === 'write' || record.external?.authorization.readOnlyGrantId !== undefined;
  const entry = nativeTool(record.definition.name);
  if (entry?.source.kind !== record.source.kind) return false;
  return record.source.kind === 'session' || access === 'write' || entry.readOnly;
}
