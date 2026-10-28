import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import {
  FrozenSkillSchema,
  FrozenMcpToolsSchema,
  ToolDiscoveryDiagnosticSchema,
  type FrozenSkill,
  type InputRequest,
  type SessionSummary,
  type SkillSelection,
  type ToolDiscoveryDiagnostic,
} from '@my-pi-harness/protocol';
import { externalBindingKey, type ExternalTools, type FrozenMcpTool } from '../tools/external.js';
import type { SkillsPort, ToolDiscoveryPort } from './ports.js';
import type { RuntimeStore } from '../sessions/ports.js';
import { RuntimeError } from '../errors.js';
import { freezeSkillMentions } from './skill-mentions.js';
import { availableSkillHistory, type SkillContextDiagnostic } from './skill-history.js';

export interface FrozenInputCapabilities {
  external: readonly FrozenMcpTool[];
  candidates: readonly FrozenMcpTool[];
  skills: readonly FrozenSkill[];
  diagnostics?: readonly ToolDiscoveryDiagnostic[];
  mentionedSkills?: readonly FrozenSkill[];
  inheritedSkills?: readonly FrozenSkill[];
  skillDiagnostics?: readonly SkillContextDiagnostic[];
}

interface InputCapabilityData {
  mcpBindings: readonly FrozenMcpTool[];
  candidateBindings: readonly FrozenMcpTool[];
  skillBindings: readonly FrozenSkill[];
  discoveryDiagnostics: readonly ToolDiscoveryDiagnostic[];
  mentionedSkillBindings: readonly FrozenSkill[];
  inheritedSkillBindings: readonly FrozenSkill[];
}

const frozenSkillsSchema = Type.Array(FrozenSkillSchema, { maxItems: 16 });
const diagnosticsSchema = Type.Array(ToolDiscoveryDiagnosticSchema, { maxItems: 512 });
const QueueCapabilityMetadataSchema = Type.Object(
  {
    version: Type.Literal(1),
    requestId: Type.String({ minLength: 1 }),
    mcpBindings: FrozenMcpToolsSchema,
    candidateBindings: FrozenMcpToolsSchema,
    skillBindings: frozenSkillsSchema,
    discoveryDiagnostics: diagnosticsSchema,
    mentionedSkillBindings: frozenSkillsSchema,
    inheritedSkillBindings: frozenSkillsSchema,
  },
  { additionalProperties: false },
);

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
    skillBindings: input.skills,
    discoveryDiagnostics: input.diagnostics ?? [],
    mentionedSkillBindings: input.mentionedSkills ?? [],
    inheritedSkillBindings: input.inheritedSkills ?? [],
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

  public metadata(
    sessionId: string,
    inputId: string,
  ): Static<typeof QueueCapabilityMetadataSchema> {
    const input = this.options.store.getQueuePrivateData(sessionId, inputId);
    if (input === null) throw new RuntimeError('INPUT_BINDING_INVALID', '排队输入缺少接受记录。');
    if (!Value.Check(QueueCapabilityMetadataSchema, input))
      throw new RuntimeError('INPUT_BINDING_INVALID', '排队输入私有数据无效。');
    return input;
  }

  public queued(sessionId: string, inputId: string): FrozenInputCapabilities {
    const metadata = this.metadata(sessionId, inputId);
    return {
      external: metadata.mcpBindings,
      candidates: metadata.candidateBindings,
      skills: metadata.skillBindings,
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
    const frozen = Value.Clone({ external, candidates, skills, diagnostics, mentionedSkills });
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
      diagnostics: input.diagnostics ?? [],
      mentionedSkills: input.mentionedSkills ?? [],
      inheritedSkills: inherited.skills,
      skillDiagnostics: inherited.diagnostics,
    };
  }
}
