import type {
  ApprovalMode,
  FrozenSkill,
  SkillCandidate,
  SkillSelection,
  SkillView,
  ToolDiscoveryDiagnostic,
} from '@my-pi-harness/protocol';
import type { ToolContent } from '@my-pi-harness/tools';
import type {
  CapabilityToolHandlers,
  CommandResourceLease,
  SkillResourceLease,
} from '@my-pi-harness/tools';
import type { FrozenMcpTool } from '../tools/external.js';

/** Host-authorized discovery prepares catalogs before freezing their non-secret metadata. */
export interface ToolDiscoveryPort {
  /** A bounded safe snapshot; reading diagnostics never starts a Server. */
  diagnostics?(
    workspaceId: string | null,
    approvalMode: ApprovalMode,
  ): readonly ToolDiscoveryDiagnostic[];
  freezeCandidates(
    workspaceId: string | null,
    approvalMode: ApprovalMode,
    signal: AbortSignal,
  ): Promise<readonly FrozenMcpTool[]>;
}

/** Skill bodies are frozen input data; resource and installation ownership remain in the host. */
export interface SkillsPort {
  list(workspaceId: string | null, signal: AbortSignal): Promise<SkillView[]>;
  freezeCandidates(
    workspaceId: string | null,
    signal: AbortSignal,
  ): Promise<readonly SkillCandidate[]>;
  loadCandidate(
    workspaceId: string | null,
    candidate: SkillCandidate,
    signal: AbortSignal,
  ): Promise<FrozenSkill>;
  freezeSelections(
    workspaceId: string | null,
    selections: readonly SkillSelection[],
    signal: AbortSignal,
  ): Promise<readonly FrozenSkill[]>;
  validateBindings(skills: readonly FrozenSkill[], signal: AbortSignal): Promise<void>;
  assertBindingsCurrent(skills: readonly FrozenSkill[]): void;
  retainBindings(skills: readonly FrozenSkill[]): () => void;
  materializeBindings?(
    skills: readonly FrozenSkill[],
    signal: AbortSignal,
  ): Promise<SkillResourceLease>;
  loadResource(skill: FrozenSkill, path: string, signal: AbortSignal): Promise<ToolContent[]>;
}

export interface RunControls extends CapabilityToolHandlers {
  retainCommandResources?(signal: AbortSignal): Promise<CommandResourceLease>;
}
