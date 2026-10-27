import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import {
  FrozenSkillSchema,
  ToolDiscoveryDiagnosticSchema,
  type FrozenSkill,
  type InputRequest,
  type SessionSummary,
  type SkillSelection,
  type WorkState,
  type ToolDiscoveryDiagnostic,
} from '@my-pi-harness/protocol';
import {
  decodeFrozenMcpTools,
  externalBindingKey,
  type ExternalTools,
  type FrozenMcpTool,
} from '../tools/external.js';
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
const QueueCapabilityMetadataSchema = Type.Object(
  {
    version: Type.Literal(1),
    requestId: Type.String({ minLength: 1 }),
    mcpBindings: Type.Optional(Type.String({ maxLength: 2_000_000 })),
    candidateBindings: Type.Optional(Type.String({ maxLength: 4_000_000 })),
    skillBindings: Type.Optional(Type.String({ maxLength: 3_000_000 })),
    discoveryDiagnostics: Type.Optional(Type.String({ maxLength: 300_000 })),
    mentionedSkillBindings: Type.Optional(Type.String({ maxLength: 3_000_000 })),
    inheritedSkillBindings: Type.Optional(Type.String({ maxLength: 3_000_000 })),
  },
  { additionalProperties: false },
);

const frozenSkillsSchema = Type.Array(FrozenSkillSchema, { maxItems: 16 });

function decodeSkillBindings(encoded: string | undefined, message: string): FrozenSkill[] {
  let skills: unknown = [];
  if (encoded) {
    try {
      skills = JSON.parse(encoded);
    } catch (cause) {
      throw new RuntimeError('SKILL_BINDING_INVALID', message, { cause });
    }
  }
  if (!Value.Check(frozenSkillsSchema, skills))
    throw new RuntimeError('SKILL_BINDING_INVALID', message);
  return skills;
}

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

export function encodeInputCapabilities(input: FrozenInputCapabilities): {
  mcpBindings: string;
  candidateBindings: string;
  skillBindings: string;
  discoveryDiagnostics: string;
  mentionedSkillBindings: string;
  inheritedSkillBindings: string;
} {
  return {
    mcpBindings: JSON.stringify(input.external),
    candidateBindings: JSON.stringify(input.candidates),
    skillBindings: JSON.stringify(input.skills),
    discoveryDiagnostics: JSON.stringify(input.diagnostics ?? []),
    mentionedSkillBindings: JSON.stringify(input.mentionedSkills ?? []),
    inheritedSkillBindings: JSON.stringify(input.inheritedSkills ?? []),
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
    const encoded = this.options.store.getQueuePrivateData(sessionId, inputId);
    if (encoded === null) throw new RuntimeError('INPUT_BINDING_INVALID', '排队输入缺少接受记录。');
    let input: unknown;
    try {
      input = JSON.parse(encoded);
    } catch (cause) {
      throw new RuntimeError('INPUT_BINDING_INVALID', '排队输入私有数据无效。', { cause });
    }
    if (!Value.Check(QueueCapabilityMetadataSchema, input))
      throw new RuntimeError('INPUT_BINDING_INVALID', '排队输入私有数据无效。');
    return input;
  }

  public queued(sessionId: string, inputId: string): FrozenInputCapabilities {
    const metadata = this.metadata(sessionId, inputId);
    const skills = decodeSkillBindings(metadata.skillBindings, '保存的Skill无效。');
    const mentionedSkills = decodeSkillBindings(
      metadata.mentionedSkillBindings,
      '保存的明确Skill调用无效。',
    );
    const inheritedSkills = decodeSkillBindings(
      metadata.inheritedSkillBindings,
      '保存的继承Skill上下文无效。',
    );
    let diagnostics: unknown = [];
    if (metadata.discoveryDiagnostics) {
      try {
        diagnostics = JSON.parse(metadata.discoveryDiagnostics);
      } catch (cause) {
        throw new RuntimeError('INPUT_BINDING_INVALID', '保存的工具发现状态无效。', { cause });
      }
    }
    if (!Value.Check(Type.Array(ToolDiscoveryDiagnosticSchema, { maxItems: 512 }), diagnostics))
      throw new RuntimeError('INPUT_BINDING_INVALID', '保存的工具发现状态无效。');
    return {
      external: metadata.mcpBindings ? decodeFrozenMcpTools(metadata.mcpBindings) : [],
      candidates: metadata.candidateBindings
        ? decodeFrozenMcpTools(metadata.candidateBindings)
        : [],
      skills,
      diagnostics,
      mentionedSkills,
      inheritedSkills,
    };
  }

  public async freeze(
    session: SessionSummary,
    input: Pick<InputRequest, 'mcpTools' | 'skills'> & { text?: string },
    mode: WorkState['mode'],
    signal: AbortSignal,
  ): Promise<FrozenInputCapabilities> {
    let external: readonly FrozenMcpTool[] = [];
    if ((input.mcpTools?.length ?? 0) > 0) {
      if (!this.options.external) throw new RuntimeError('MCP_UNAVAILABLE', 'MCP不可用。');
      external = await this.options.external.freezeSelections(
        session.workspaceId,
        session.approvalMode,
        mode,
        input.mcpTools ?? [],
        signal,
      );
    }
    const candidates = this.options.discovery
      ? await this.options.discovery.freezeCandidates(
          session.workspaceId,
          session.approvalMode,
          mode,
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
