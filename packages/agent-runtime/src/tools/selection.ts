import type { AgentRole, FrozenSkill, WorkState } from '@my-pi-harness/protocol';
import { nativeTools } from './catalog.js';
import type { FrozenMcpTool } from './external.js';
import { RunToolset, type RunToolRecord, type RunToolSelection } from './toolset.js';
import { allowedTaskTool } from './task-toolset.js';

export interface ToolSelectionInput {
  workspaceId: string | null;
  work: boolean;
  skills: boolean;
  skillDirectory: boolean;
  agents: boolean;
  canSpawn?: boolean;
  task?: boolean;
  access?: AgentRole['access'];
  inherited?: RunToolset;
  external?: readonly FrozenMcpTool[];
  activeSkills?: readonly FrozenSkill[];
  state?: WorkState;
}

/** Current work state exposes its concrete update operations without guessing the user's intent. */
export function workToolRequirements(state: WorkState): string[] {
  const names: string[] = [];
  if (state.plan) {
    names.push('update_plan');
    if (state.plan.review === 'approved') names.push('update_plan_steps');
  }
  if (state.todos.length > 0) names.push('update_todos');
  return names;
}

/** Resolve initial declarations and all native candidates using the same capability and role filters. */
export function selectRunTools(input: ToolSelectionInput): {
  initial: RunToolset;
  nativeCandidates: readonly RunToolRecord[];
} {
  const candidates = nativeTools().filter((entry) => {
    if (entry.source.kind === 'workspace' && input.workspaceId === null) return false;
    if (entry.definition.name === 'shell' && process.platform !== 'darwin') return false;
    if (entry.family === 'work' && !input.work) return false;
    if (entry.family === 'agent' && !input.agents) return false;
    if (entry.definition.name === 'spawn_agent' && input.canSpawn === false) return false;
    if (
      (entry.definition.name === 'load_skill' || entry.definition.name === 'read_skill_resource') &&
      !input.skills
    )
      return false;
    return !input.task || allowedTaskTool(entry, input.access ?? 'read-only');
  });
  const required = new Set(input.state ? workToolRequirements(input.state) : []);
  if (input.task && input.agents) required.add('send_agent_message');
  for (const skill of input.activeSkills ?? []) {
    if (skill.resources.length > 0) required.add('read_skill_resource');
    for (const name of skill.allowedTools)
      if (
        candidates.some(
          (entry) => entry.source.kind === 'workspace' && entry.definition.name === name,
        )
      )
        required.add(name);
  }
  const records: RunToolSelection[] = candidates.filter(
    (entry) =>
      (entry.loading === 'default' &&
        (entry.definition.name !== 'load_skill' || input.skillDirectory)) ||
      required.has(entry.definition.name),
  );
  for (const inherited of input.inherited?.records ?? []) {
    if (!allowedTaskTool(inherited, input.access ?? 'read-only')) continue;
    if (
      inherited.source.kind !== 'mcp' &&
      !candidates.some((entry) => entry.definition.name === inherited.definition.name)
    )
      continue;
    const index = records.findIndex((entry) => entry.definition.name === inherited.definition.name);
    if (index < 0) records.push(inherited);
    else records[index] = inherited;
  }
  for (const external of input.external ?? [])
    records.push({
      definition: external.definition,
      external,
      source: {
        kind: 'mcp',
        serverId: external.selection.serverId,
        serverRevision: external.selection.serverRevision,
        remoteToolName: external.selection.remoteToolName,
      },
    });
  const initial = new RunToolset(records);
  const visible = new Set(initial.definitions.map(({ name }) => name));
  const nativeCandidates = new RunToolset(
    candidates.filter((entry) => !visible.has(entry.definition.name)),
  ).records;
  return { initial, nativeCandidates };
}
