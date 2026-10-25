import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import {
  FrozenSkillSchema,
  type FrozenSkill,
  type InputRequest,
  type SessionSummary,
  type SkillSelection,
  type WorkState,
} from '@my-pi-harness/protocol';
import {
  decodeFrozenMcpTools,
  externalBindingKey,
  type ExternalTools,
  type FrozenMcpTool,
} from './external-tools.js';
import type { SkillsPort, ToolDiscoveryPort } from './capability-ports.js';
import type { RuntimeStore } from './runtime-ports.js';
import { RuntimeError } from './errors.js';

export interface FrozenInputCapabilities {
  external: readonly FrozenMcpTool[];
  candidates: readonly FrozenMcpTool[];
  skills: readonly FrozenSkill[];
}
export const QueueCapabilityMetadataSchema = Type.Object(
  {
    version: Type.Literal(1),
    requestId: Type.String({ minLength: 1 }),
    mcpBindings: Type.Optional(Type.String({ maxLength: 2_000_000 })),
    candidateBindings: Type.Optional(Type.String({ maxLength: 4_000_000 })),
    skillBindings: Type.Optional(Type.String({ maxLength: 3_000_000 })),
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
      input.skills
        .map((skill) => [skill.selection.id, skill.selection.contentHash, skill.authorization])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ),
  ]);
}
export function encodeInputCapabilities(input: FrozenInputCapabilities): {
  mcpBindings: string;
  candidateBindings: string;
  skillBindings: string;
} {
  return {
    mcpBindings: JSON.stringify(input.external),
    candidateBindings: JSON.stringify(input.candidates),
    skillBindings: JSON.stringify(input.skills),
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
    let skills: unknown = [];
    if (metadata.skillBindings) {
      try {
        skills = JSON.parse(metadata.skillBindings);
      } catch (cause) {
        throw new RuntimeError('SKILL_BINDING_INVALID', '保存的Skill无效。', { cause });
      }
    }
    if (!Value.Check(Type.Array(FrozenSkillSchema, { maxItems: 16 }), skills))
      throw new RuntimeError('SKILL_BINDING_INVALID', '保存的Skill无效。');
    return {
      external: metadata.mcpBindings ? decodeFrozenMcpTools(metadata.mcpBindings) : [],
      candidates: metadata.candidateBindings
        ? decodeFrozenMcpTools(metadata.candidateBindings)
        : [],
      skills,
    };
  }

  public async freeze(
    session: SessionSummary,
    input: Pick<InputRequest, 'mcpTools' | 'skills'>,
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
    return Value.Clone({ external, candidates, skills });
  }

  public async restore(
    input: FrozenInputCapabilities,
    signal: AbortSignal,
  ): Promise<FrozenInputCapabilities> {
    let external = input.external;
    let candidates = input.candidates;
    if (external.length > 0 || candidates.length > 0) {
      if (!this.options.external) throw new RuntimeError('MCP_UNAVAILABLE', 'MCP不可用。');
      external = await this.options.external.restoreBindings(external, signal);
      candidates = await this.options.external.restoreBindings(candidates, signal);
    }
    if (input.skills.length > 0) {
      if (!this.options.skills) throw new RuntimeError('SKILLS_UNAVAILABLE', 'Skill不可用。');
      await this.options.skills.validateBindings(input.skills, signal);
    }
    return { external, candidates, skills: input.skills };
  }
}
