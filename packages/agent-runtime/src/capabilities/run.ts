import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { ExecutionContent } from '@my-pi-harness/execution';
import type { FrozenSkill, ToolDiscoveryDiagnostic } from '@my-pi-harness/protocol';
import type { FrozenMcpTool } from '../tools/external.js';
import type { EventInput } from '../sessions/ports.js';
import { RuntimeError } from '../errors.js';
import { RunToolset, type RunToolDefinition } from '../tools/toolset.js';
import type { RunControls, SkillsPort } from './ports.js';
import { snapshotPrivateData } from '../context/codec.js';
import {
  DEFAULT_TOOL_SEARCH_LIMIT,
  MAX_TOOL_SEARCH_RESULTS,
  MAX_VISIBLE_TOOLS,
  ToolCatalogSearch,
  type ToolSearchDocument,
} from './search.js';

interface RunCapabilitiesOptions {
  runId: string;
  workspaceId: string | null;
  initial: RunToolset;
  candidates: readonly FrozenMcpTool[];
  workspaceCandidates?: readonly RunToolDefinition[];
  skills: readonly FrozenSkill[];
  skillPort?: SkillsPort;
  search?: ToolCatalogSearch;
  diagnostics?: readonly ToolDiscoveryDiagnostic[];
  commit(events: readonly EventInput[]): void;
}

const empty = { additionalProperties: false } as const;

const names = Type.Array(Type.String({ minLength: 1, maxLength: 100 }), {
  minItems: 1,
  maxItems: 64,
  uniqueItems: true,
});

export const DISCOVERY_TOOL_DEFINITIONS: readonly RunToolDefinition[] = [
  {
    name: 'tool_search',
    description:
      "Find and automatically load matching tools from this Run's frozen authorized catalog. Search by service, original tool name, or task. Default 8 results, maximum 10; complete schemas become available in the next model request. Loading does not grant execution permission.",
    parameters: Type.Object(
      {
        query: Type.String({ minLength: 1, maxLength: 200 }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TOOL_SEARCH_RESULTS })),
      },
      empty,
    ),
  },
  {
    name: 'load_tools',
    description:
      'Make named tools from the frozen MCP catalog visible for the next model request. This does not bypass approval or grant Server access.',
    parameters: Type.Object({ names }, empty),
  },
];

export const SKILL_TOOL_DEFINITIONS: readonly RunToolDefinition[] = [
  {
    name: 'skill_search',
    description:
      'Find enabled Skill metadata. Loading its exact content hash is a separate operation.',
    parameters: Type.Object({ query: Type.String({ maxLength: 200 }) }, empty),
  },
  {
    name: 'load_skill',
    description:
      'Activate the exact enabled Skill version for the next request. Instructions do not grant tool permissions.',
    parameters: Type.Object(
      {
        id: Type.String({ maxLength: 160 }),
        contentHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
      },
      empty,
    ),
  },
  {
    name: 'read_skill_resource',
    description:
      'Read a bounded resource belonging to an active frozen Skill; arbitrary filesystem paths and URLs are not accepted.',
    parameters: Type.Object(
      {
        skillId: Type.String({ maxLength: 160 }),
        path: Type.String({ minLength: 1, maxLength: 1024 }),
      },
      empty,
    ),
  },
  {
    name: 'request_skill_tools',
    description:
      'Request explicit user approval for concrete frozen tools needed by an active Skill. This Run-scoped grant never overrides Plan, startup trust, workspace limits or per-call tool approval.',
    parameters: Type.Object({ skillId: Type.String({ maxLength: 160 }), names }, empty),
  },
  {
    name: 'revoke_skill_tools',
    description:
      "Revoke this Run's explicit Skill tool grant. The host stops the Run so no previous grant can be used by later queued calls.",
    parameters: Type.Object({ skillId: Type.String({ maxLength: 160 }) }, empty),
  },
];

/** One Run's immutable candidates and request-bound visible version; staging never changes current execution. */
export class RunCapabilities implements RunControls {
  public active: RunToolset;
  public revision = 1;
  private readonly pendingNames = new Set<string>();
  private readonly candidates = new Map<string, FrozenMcpTool>();
  private readonly workspaceCandidates = new Map<string, RunToolDefinition>();
  private readonly activeSkills = new Map<string, FrozenSkill>();
  private readonly pendingSkills = new Map<string, FrozenSkill>();
  private readonly releases: (() => void)[] = [];
  private readonly grants = new Set<string>();
  private closed = false;
  private readonly search: ToolCatalogSearch;
  private readonly diagnostics: readonly ToolDiscoveryDiagnostic[];

  public constructor(private readonly options: RunCapabilitiesOptions) {
    this.active = options.initial;
    this.search = options.search ?? new ToolCatalogSearch();
    this.diagnostics = Value.Clone(options.diagnostics ?? []);
    if (this.active.records.length > MAX_VISIBLE_TOOLS)
      throw new RuntimeError('TOOL_LIMIT', '本次运行最多同时提供64个工具。');
    for (const tool of options.workspaceCandidates ?? [])
      this.workspaceCandidates.set(tool.name, tool);
    for (const tool of options.candidates) {
      if (this.candidates.has(tool.definition.name))
        throw new RuntimeError('TOOL_NAME_CONFLICT', '候选工具名称冲突。');
      this.candidates.set(tool.definition.name, Value.Clone(tool));
    }
    if (this.candidates.size > 512 || JSON.stringify(options.candidates).length > 4_000_000)
      throw new RuntimeError('TOOL_CATALOG_LIMIT', '候选工具目录超过本次运行限制。');
    for (const skill of options.skills)
      this.activeSkills.set(skill.selection.id, Value.Clone(skill));
    if (options.skillPort && options.skills.length > 0)
      this.releases.push(options.skillPort.retainBindings(options.skills));
  }

  public skills(): readonly FrozenSkill[] {
    return [...this.activeSkills.values()];
  }
  public has(name: string): boolean {
    return [...DISCOVERY_TOOL_DEFINITIONS, ...SKILL_TOOL_DEFINITIONS].some(
      (tool) => tool.name === name,
    );
  }
  public assertCurrent(): void {
    this.options.skillPort?.assertBindingsCurrent(this.skills());
  }
  public async validate(signal: AbortSignal): Promise<void> {
    if (this.options.skillPort)
      await this.options.skillPort.validateBindings(this.skills(), signal);
  }

  /** Validate text-invoked additions before their owning user input is committed. */
  public assertSkillAdditions(skills: readonly FrozenSkill[]): void {
    if (this.closed) throw new RuntimeError('RUN_CLOSED', '本次运行已结束。');
    const selections = new Map([...this.activeSkills, ...this.pendingSkills]);
    for (const skill of skills) {
      const previous = selections.get(skill.selection.id);
      if (
        previous &&
        (previous.selection.contentHash !== skill.selection.contentHash ||
          JSON.stringify(previous.authorization) !== JSON.stringify(skill.authorization))
      )
        throw new RuntimeError('SKILL_CONFLICT', '不能替换本次运行已冻结的Skill版本。');
      selections.set(skill.selection.id, skill);
    }
    if (selections.size > 16) throw new RuntimeError('SKILL_LIMIT', '最多激活16个Skill。');
    this.assertStageLimit(this.skillToolNames(skills));
  }

  /** Staging text-invoked instructions still requires the next-request durable visibility barrier. */
  public stageSkills(skills: readonly FrozenSkill[]): void {
    this.assertSkillAdditions(skills);
    for (const skill of skills)
      if (!this.activeSkills.has(skill.selection.id))
        this.pendingSkills.set(skill.selection.id, Value.Clone(skill));
    this.stage(this.skillToolNames(skills));
  }

  private skillToolNames(skills: readonly FrozenSkill[]): string[] {
    if (this.options.workspaceId === null) return [];
    return [
      ...new Set(
        skills
          .flatMap((skill) => skill.allowedTools)
          .filter((name) => this.workspaceCandidates.has(name)),
      ),
    ];
  }

  public async execute(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<ExecutionContent[]> {
    signal.throwIfAborted();
    if (this.closed) throw new RuntimeError('RUN_CLOSED', '本次运行已结束。');
    let result: unknown;
    if (name === 'tool_search') {
      const query = args['query'];
      const limit = args['limit'] ?? DEFAULT_TOOL_SEARCH_LIMIT;
      if (
        typeof query !== 'string' ||
        query.trim().length === 0 ||
        query.length > 200 ||
        typeof limit !== 'number' ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > MAX_TOOL_SEARCH_RESULTS
      )
        throw new RuntimeError(
          'TOOL_ARGUMENTS_INVALID',
          '搜索内容不能为空，limit须为1到10的整数。',
        );
      const visible = this.visibleNames();
      const remaining = MAX_VISIBLE_TOOLS - visible.size;
      if (remaining <= 0) throw new RuntimeError('TOOL_LIMIT', '本次运行的工具数量已达64个上限。');
      const documents: ToolSearchDocument[] = [
        ...[...this.candidates.values()].map((tool) => ({
          definition: tool.definition,
          label:
            tool.displayName ?? `${tool.selection.serverId} / ${tool.selection.remoteToolName}`,
          source: 'mcp',
          originalName: tool.selection.remoteToolName,
        })),
        ...[...this.workspaceCandidates.values()].map((definition) => ({
          definition,
          label: definition.name,
          originalName: definition.name,
          source: 'workspace',
        })),
      ].filter(({ definition }) => !visible.has(definition.name));
      const matches = await this.search.search(documents, query, signal);
      signal.throwIfAborted();
      if (this.closed) throw new RuntimeError('RUN_CLOSED', '本次运行已结束。');
      const currentVisible = this.visibleNames();
      const selected = matches
        .filter(({ definition }) => !currentVisible.has(definition.name))
        .slice(0, Math.min(limit, MAX_VISIBLE_TOOLS - currentVisible.size));
      const loaded = selected.map(({ definition }) => definition.name);
      this.stage(loaded);
      result = {
        loaded,
        availableFrom: 'next-model-request',
        matches: selected.map(({ definition, label, source }) => ({
          name: definition.name,
          label,
          description: definition.description.slice(0, 160),
          source,
        })),
        ...(selected.length === 0
          ? {
              message:
                'No matching unloaded tools. Inspect discovery status, try another service or task phrase, or use an already loaded tool. A missing result does not establish an OAuth failure.',
              discovery: this.diagnostics,
            }
          : {}),
      };
    } else if (name === 'load_tools') {
      const input = args['names'];
      if (!Value.Check(names, input))
        throw new RuntimeError('TOOL_ARGUMENTS_INVALID', '工具名称无效。');
      for (const item of input)
        if (!this.candidates.has(item) && !this.workspaceCandidates.has(item))
          throw new RuntimeError('TOOL_NOT_AVAILABLE', `候选中没有工具：${item}`);
      this.stage(input);
      result = { stagedForNextRequest: input };
    } else {
      const port = this.options.skillPort;
      if (!port) throw new RuntimeError('SKILLS_UNAVAILABLE', 'Skill运行时不可用。');
      if (name === 'skill_search') {
        const query = String(args['query']).toLowerCase();
        result = (await port.list(this.options.workspaceId, signal))
          .filter(
            (skill) =>
              skill.enabled &&
              !skill.shadowed &&
              `${skill.name} ${skill.description}`.toLowerCase().includes(query),
          )
          .slice(0, 30);
      } else if (name === 'load_skill') {
        const selection = { id: String(args['id']), contentHash: String(args['contentHash']) };
        const existing =
          this.activeSkills.get(selection.id) ?? this.pendingSkills.get(selection.id);
        if (existing) {
          if (existing.selection.contentHash !== selection.contentHash)
            throw new RuntimeError('SKILL_CONFLICT', '不能替换本次运行已冻结的Skill版本。');
          return [{ type: 'text' as const, text: '此Skill版本已激活。' }];
        }
        const loaded = await port.freezeSelections(this.options.workspaceId, [selection], signal);
        this.stageSkills(loaded);
        result = { stagedForNextRequest: selection };
      } else {
        const skill = this.activeSkills.get(String(args['skillId']));
        if (!skill) throw new RuntimeError('SKILL_NOT_ACTIVE', 'Skill尚未激活。');
        await port.validateBindings([skill], signal);
        if (name === 'read_skill_resource')
          return await port.loadResource(skill, String(args['path']), signal);
        if (name === 'revoke_skill_tools') {
          this.revoke(skill.selection.id);
          return [{ type: 'text' as const, text: 'Skill工具授权已撤销，本次运行停止。' }];
        }
        if (name !== 'request_skill_tools')
          throw new RuntimeError('TOOL_NOT_AVAILABLE', '控制工具不存在。');
        const requested = args['names'];
        if (!Value.Check(names, requested))
          throw new RuntimeError('TOOL_ARGUMENTS_INVALID', '工具名称无效。');
        for (const item of requested)
          if (
            !this.candidates.has(item) &&
            !this.workspaceCandidates.has(item) &&
            !this.active.records.some((tool) => tool.definition.name === item)
          )
            throw new RuntimeError('TOOL_NOT_AVAILABLE', `本次运行未授权候选：${item}`);
        this.assertStageLimit(requested);
        this.options.commit([
          {
            type: 'run.skill_tools_granted',
            runId: this.options.runId,
            at: Date.now(),
            data: { skill: skill.selection, names: requested },
          },
        ]);
        this.grants.add(skill.selection.id);
        this.stage(
          requested.filter(
            (item) => this.candidates.has(item) || this.workspaceCandidates.has(item),
          ),
        );
        result = {
          grantedForThisRun: requested,
          skill: skill.selection,
          approvalsStillRequired: true,
        };
      }
    }
    return [{ type: 'text' as const, text: JSON.stringify(result) }];
  }

  private revoke(skillId: string): void {
    if (!this.grants.has(skillId))
      throw new RuntimeError('SKILL_GRANT_NOT_FOUND', '本次运行没有此Skill工具授权。');
    this.options.commit([
      {
        type: 'run.skill_tools_revoked',
        runId: this.options.runId,
        at: Date.now(),
        data: { skillId },
      },
    ]);
    this.grants.delete(skillId);
  }

  private visibleNames(): Set<string> {
    return new Set([...this.active.definitions.map(({ name }) => name), ...this.pendingNames]);
  }

  private stage(names: readonly string[]): void {
    this.assertStageLimit(names);
    for (const name of names)
      if (!this.active.records.some(({ definition }) => definition.name === name))
        this.pendingNames.add(name);
  }

  private assertStageLimit(names: readonly string[]): void {
    if (new Set([...this.visibleNames(), ...names]).size > MAX_VISIBLE_TOOLS)
      throw new RuntimeError('TOOL_LIMIT', '本次运行最多同时提供64个工具。');
  }

  /** Persist the next visible version before publishing it to Pi, budget or execution. */
  public advance(): boolean {
    if (this.pendingNames.size === 0 && this.pendingSkills.size === 0) return false;
    const records = [...this.active.records];
    for (const name of this.pendingNames) {
      if (records.some((tool) => tool.definition.name === name)) continue;
      const external = this.candidates.get(name);
      if (!external) {
        const definition = this.workspaceCandidates.get(name);
        if (!definition) throw new RuntimeError('TOOL_NOT_AVAILABLE', '候选工具已失效。');
        records.push({ definition, source: { kind: 'workspace' }, fingerprint: '' });
        continue;
      }
      records.push({
        definition: external.definition,
        external,
        fingerprint: external.selection.definitionFingerprint,
        source: {
          kind: 'mcp',
          serverId: external.selection.serverId,
          serverRevision: external.selection.serverRevision,
          remoteToolName: external.selection.remoteToolName,
        },
      });
    }
    const next = new RunToolset(records);
    const skills = [...this.activeSkills.values(), ...this.pendingSkills.values()];
    const pendingSkills = [...this.pendingSkills.values()];
    this.options.skillPort?.assertBindingsCurrent(skills);
    const release =
      pendingSkills.length > 0 ? this.options.skillPort?.retainBindings(pendingSkills) : undefined;
    try {
      this.options.commit([
        {
          type: 'run.tools_loaded',
          runId: this.options.runId,
          at: Date.now(),
          data: {
            revision: this.revision + 1,
            names: next.definitions.map((tool) => tool.name),
            skills: skills.map((skill) => skill.selection),
          },
          privateData: snapshotPrivateData({
            version: 1,
            revision: this.revision + 1,
            tools: next.records,
            skills,
          }),
        },
      ]);
    } catch (cause) {
      release?.();
      throw new RuntimeError('CAPABILITY_PERSISTENCE_FAILED', '工具可见版本未能持久化。', {
        cause,
      });
    }
    if (release) this.releases.push(release);
    this.active = next;
    for (const skill of this.pendingSkills.values())
      this.activeSkills.set(skill.selection.id, skill);
    this.pendingSkills.clear();
    this.pendingNames.clear();
    this.revision += 1;
    return true;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.grants.clear();
    for (const release of this.releases.splice(0).reverse()) release();
  }
}
