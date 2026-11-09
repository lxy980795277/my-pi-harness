import { Value } from 'typebox/value';
import type {
  InputRequest,
  SessionSummary,
  SkillSelection,
  ToolDiscoveryDiagnostic,
} from '@my-pi-harness/protocol';
import type {
  QueueCapabilityMetadata,
  FrozenSkill,
  SkillCandidate,
} from '@my-pi-harness/protocol/internal';
import { externalBindingKey, type ExternalTools, type FrozenMcpTool } from '../tools/external';
import type { SkillsPort, ToolDiscoveryPort } from './ports';
import type { RuntimeStore } from '../sessions/ports';
import { RuntimeError } from '../errors';
import { freezeSkillMentions } from './skill-mentions';
import { availableSkillHistory, type SkillContextDiagnostic } from './skill-history';

export interface FrozenInputCapabilities {
  external: readonly FrozenMcpTool[];
  candidates: readonly FrozenMcpTool[];
  skills: readonly FrozenSkill[];
  skillCandidates: readonly SkillCandidate[];
  diagnostics?: readonly ToolDiscoveryDiagnostic[];
  mentionedSkills?: readonly FrozenSkill[];
  inheritedSkills?: readonly FrozenSkill[];
  skillDiagnostics?: readonly SkillContextDiagnostic[];
}

/** In-process MCP definitions retain executable schemas until storage validates their JSON fields. */
type InputCapabilityData = Omit<
  QueueCapabilityMetadata,
  'version' | 'requestId' | 'mcpBindings' | 'candidateBindings'
> & {
  mcpBindings: readonly FrozenMcpTool[];
  candidateBindings: readonly FrozenMcpTool[];
};

export function skillSelectionKey(skills: readonly SkillSelection[]): string {
  return JSON.stringify(
    skills
      .map((skill) => [skill.id, skill.contentHash])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}
export function frozenInputKey(input: FrozenInputCapabilities): string {
  return JSON.stringify([
    externalBindingKey(input.external),
    externalBindingKey(input.candidates),
    input.skillCandidates,
    JSON.stringify(
      combinedSkills(input)
        .map((skill) => [skill.selection.id, skill.selection.contentHash, skill.authorization])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ),
  ]);
}

/** Explicit picker choices and text invocations share one frozen instruction version per Skill. */
export function combinedSkills(
  input: Pick<FrozenInputCapabilities, 'skills' | 'mentionedSkills' | 'inheritedSkills'>,
): readonly FrozenSkill[] {
  const result = new Map<string, FrozenSkill>();
  for (const skill of [
    ...input.skills,
    ...(input.mentionedSkills ?? []),
    ...(input.inheritedSkills ?? []),
  ]) {
    const previous = result.get(skill.selection.id);
    if (
      previous &&
      (previous.selection.contentHash !== skill.selection.contentHash ||
        JSON.stringify(previous.authorization) !== JSON.stringify(skill.authorization))
    )
      throw new RuntimeError('SKILL_CONFLICT', '不能混用同一Skill的不同内容版本。');
    result.set(skill.selection.id, skill);
  }
  if (result.size > 16) throw new RuntimeError('SKILL_LIMIT', '最多激活16个Skill。');
  return [...result.values()];
}

export function encodeInputCapabilities(input: FrozenInputCapabilities): InputCapabilityData {
  return {
    mcpBindings: input.external,
    candidateBindings: input.candidates,
    skillBindings: [...input.skills],
    skillCandidates: [...input.skillCandidates],
    discoveryDiagnostics: [...(input.diagnostics ?? [])],
    mentionedSkillBindings: [...(input.mentionedSkills ?? [])],
    inheritedSkillBindings: [...(input.inheritedSkills ?? [])],
  };
}

/** Owns frozen input data and revalidation, independently from live SDK/Run instances. */
export class InputCapabilityResolver {
  public constructor(
    private readonly options: {
      store: RuntimeStore;
      external?: ExternalTools;
      discovery?: ToolDiscoveryPort;
      skills?: SkillsPort;
    },
  ) {}

  public metadata(sessionId: string, inputId: string): QueueCapabilityMetadata {
    const input = this.options.store.getQueuePrivateData(sessionId, inputId);
    if (input === null) throw new RuntimeError('INPUT_BINDING_INVALID', '排队输入缺少接受记录。');
    return input;
  }

  public queued(sessionId: string, inputId: string): FrozenInputCapabilities {
    const metadata = this.metadata(sessionId, inputId);
    return {
      external: metadata.mcpBindings,
      candidates: metadata.candidateBindings,
      skills: metadata.skillBindings,
      skillCandidates: metadata.skillCandidates,
      diagnostics: metadata.discoveryDiagnostics,
      mentionedSkills: metadata.mentionedSkillBindings,
      inheritedSkills: metadata.inheritedSkillBindings,
    };
  }

  public async freeze(
    session: SessionSummary,
    input: Pick<InputRequest, 'mcpTools' | 'skills'> & { text?: string },
    signal: AbortSignal,
  ): Promise<FrozenInputCapabilities> {
    const skillCandidates = this.options.skills
      ? await this.options.skills.freezeCandidates(session.workspaceId, signal)
      : [];
    let external: readonly FrozenMcpTool[] = [];
    if ((input.mcpTools?.length ?? 0) > 0) {
      if (!this.options.external) throw new RuntimeError('MCP_UNAVAILABLE', 'MCP不可用。');
      external = await this.options.external.freezeSelections(
        session.workspaceId,
        session.approvalMode,
        input.mcpTools ?? [],
        signal,
      );
    }
    const candidates = this.options.discovery
      ? await this.options.discovery.freezeCandidates(
          session.workspaceId,
          session.approvalMode,
          signal,
        )
      : [];
    let skills: readonly FrozenSkill[] = [];
    if ((input.skills?.length ?? 0) > 0) {
      if (!this.options.skills) throw new RuntimeError('SKILLS_UNAVAILABLE', 'Skill不可用。');
      skills = await this.options.skills.freezeSelections(
        session.workspaceId,
        input.skills ?? [],
        signal,
      );
    }
    signal.throwIfAborted();
    const diagnostics =
      this.options.discovery?.diagnostics?.(session.workspaceId, session.approvalMode) ?? [];
    const mentionedSkills = await freezeSkillMentions(
      this.options.skills,
      session.workspaceId,
      input.text ?? '',
      signal,
    );
    const frozen = Value.Clone({
      external,
      candidates,
      skills,
      skillCandidates,
      diagnostics,
      mentionedSkills,
    });
    combinedSkills(frozen);
    return frozen;
  }

  public async restore(
    input: FrozenInputCapabilities,
    signal: AbortSignal,
    dropInvalidInherited = false,
  ): Promise<FrozenInputCapabilities> {
    let external = input.external;
    let candidates = input.candidates;
    if (external.length > 0 || candidates.length > 0) {
      if (!this.options.external) throw new RuntimeError('MCP_UNAVAILABLE', 'MCP不可用。');
      external = await this.options.external.restoreBindings(external, signal);
      candidates = await this.options.external.restoreBindings(candidates, signal);
    }
    const inherited = dropInvalidInherited
      ? await availableSkillHistory(
          input.inheritedSkills ?? [],
          combinedSkills({ skills: input.skills, mentionedSkills: input.mentionedSkills ?? [] }),
          this.options.skills,
          signal,
        )
      : { skills: input.inheritedSkills ?? [], diagnostics: input.skillDiagnostics ?? [] };
    const skills = combinedSkills({ ...input, inheritedSkills: inherited.skills });
    if (skills.length > 0) {
      if (!this.options.skills) throw new RuntimeError('SKILLS_UNAVAILABLE', 'Skill不可用。');
      await this.options.skills.validateBindings(skills, signal);
    }
    return {
      external,
      candidates,
      skills: input.skills,
      skillCandidates: input.skillCandidates,
      diagnostics: input.diagnostics ?? [],
      mentionedSkills: input.mentionedSkills ?? [],
      inheritedSkills: inherited.skills,
      skillDiagnostics: inherited.diagnostics,
    };
  }
}
