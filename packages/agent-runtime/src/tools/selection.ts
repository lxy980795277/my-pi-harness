import type { FrozenSkill, WorkState } from '@my-pi-harness/protocol';
import { nativeTools, type ToolRegistration } from '@my-pi-harness/tools';
import type { FrozenMcpTool } from './external';
import { RunToolset, type RunToolRecord, type RunToolSelection } from './toolset';

export interface ToolSelectionInput {
  registrations?: readonly ToolRegistration[];
  images?: boolean;
  workspaceId: string | null;
  work: boolean;
  skills: boolean;
  skillDirectory: boolean;
  agents: boolean;
  canSpawn?: boolean;
  allows?(tool: RunToolSelection): boolean;
  required?: readonly string[];
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

/** Resolve initial declarations and deferred candidates under the caller's accepted scope. */
export function selectRunTools(input: ToolSelectionInput): {
  initial: RunToolset;
  nativeCandidates: readonly RunToolRecord[];
} {
  const availability = {
    workspace: input.workspaceId !== null,
    work: input.work,
    skills: input.skills,
    skillDirectory: input.skillDirectory,
    agents: input.agents,
    canSpawn: input.canSpawn !== false,
    images: input.images ?? true,
    platform: process.platform,
  };
  const candidates = (input.registrations ?? nativeTools()).filter(
    (entry) => entry.available(availability) && (input.allows?.(entry) ?? true),
  );
  const required = new Set([
    ...(input.required ?? []),
    ...(input.state ? workToolRequirements(input.state) : []),
  ]);
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
    (entry) => entry.loading === 'default' || required.has(entry.definition.name),
  );
  for (const inherited of input.inherited?.records ?? []) {
    if (input.allows && !input.allows(inherited)) continue;
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
