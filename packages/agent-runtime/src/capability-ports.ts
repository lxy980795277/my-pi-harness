import type {
  ApprovalMode,
  FrozenSkill,
  SkillSelection,
  SkillView,
  WorkState,
} from '@my-pi-harness/protocol';
import type { ExecutionContent } from '@my-pi-harness/execution';
import type { FrozenMcpTool } from './external-tools.js';

/** Candidate discovery reads explicitly authorized cached metadata without starting a Server. */
export interface ToolDiscoveryPort {
  freezeCandidates(
    workspaceId: string | null,
    approvalMode: ApprovalMode,
    mode: WorkState['mode'],
    signal: AbortSignal,
  ): Promise<readonly FrozenMcpTool[]>;
}

/** Skill bodies are frozen input data; resource and installation ownership remain in the host. */
export interface SkillsPort {
  list(workspaceId: string | null, signal: AbortSignal): Promise<SkillView[]>;
  freezeSelections(
    workspaceId: string | null,
    selections: readonly SkillSelection[],
    signal: AbortSignal,
  ): Promise<readonly FrozenSkill[]>;
  validateBindings(skills: readonly FrozenSkill[], signal: AbortSignal): Promise<void>;
  assertBindingsCurrent(skills: readonly FrozenSkill[]): void;
  retainBindings(skills: readonly FrozenSkill[]): () => void;
  loadResource(skill: FrozenSkill, path: string, signal: AbortSignal): Promise<ExecutionContent[]>;
}

/** Controller tools can stage next-turn changes, but cannot replace the current assistant's tool map. */
export interface RunControls {
  has(name: string): boolean;
  execute(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<ExecutionContent[]>;
}
