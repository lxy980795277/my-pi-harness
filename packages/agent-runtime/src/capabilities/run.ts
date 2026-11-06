import type { CommandResourceLease } from '@my-pi-harness/tools';
import { Value } from 'typebox/value';
import type { ToolContent } from '@my-pi-harness/tools';
import type { ToolDiscoveryDiagnostic } from '@my-pi-harness/protocol';
import type { FrozenSkill, SkillCandidate } from '@my-pi-harness/protocol/internal';
import type { FrozenMcpTool } from '../tools/external';
import type { EventInput } from '../sessions/ports';
import { RuntimeError } from '../errors';
import { RunToolset, type RunToolRecord, type RunToolSelection } from '../tools/toolset';
import type { RunControls, SkillsPort } from './ports';
import { snapshotPrivateData } from '../context/codec';
import { RunSkills } from './skills';
import {
  MAX_VISIBLE_TOOLS,
  ToolCatalogSearch,
  type ToolSearchDocument,
} from '@my-pi-harness/tools';

interface RunCapabilitiesOptions {
  runId: string;
  workspaceId: string | null;
  initial: RunToolset;
  candidates: readonly FrozenMcpTool[];
  nativeCandidates?: readonly RunToolRecord[];
  skills: readonly FrozenSkill[];
  skillCandidates?: readonly SkillCandidate[];
  skillPort?: SkillsPort;
  search?: ToolCatalogSearch;
  diagnostics?: readonly ToolDiscoveryDiagnostic[];
  commit(events: readonly EventInput[]): void;
}

/** Frozen candidates, staging and publication of the next model-visible tool collection. */
export class RunCapabilities implements RunControls {
  public active: RunToolset;
  public revision = 1;
  private readonly pendingNames = new Set<string>();
  private readonly candidates = new Map<string, RunToolSelection>();
  private readonly skillState: RunSkills;
  private readonly catalogSearch: ToolCatalogSearch;
  private readonly diagnostics: readonly ToolDiscoveryDiagnostic[];
  private closed = false;

  public constructor(private readonly options: RunCapabilitiesOptions) {
    this.active = options.initial;
    this.catalogSearch = options.search ?? new ToolCatalogSearch();
    this.diagnostics = Value.Clone(options.diagnostics ?? []);
    if (this.active.records.length > MAX_VISIBLE_TOOLS)
      throw new RuntimeError('TOOL_LIMIT', '本次运行最多同时提供64个工具。');
    for (const tool of options.nativeCandidates ?? []) {
      this.candidates.set(tool.definition.name, tool);
    }
    for (const tool of options.candidates) {
      if (this.candidates.has(tool.definition.name))
        throw new RuntimeError('TOOL_NAME_CONFLICT', '候选工具名称冲突。');
      this.candidates.set(tool.definition.name, {
        definition: tool.definition,
        external: tool,
        source: {
          kind: 'mcp',
          serverId: tool.selection.serverId,
          serverRevision: tool.selection.serverRevision,
          remoteToolName: tool.selection.remoteToolName,
        },
      });
    }
    for (const tool of options.initial.records) this.candidates.set(tool.definition.name, tool);
    if (options.candidates.length > 512 || JSON.stringify(options.candidates).length > 4_000_000)
      throw new RuntimeError('TOOL_CATALOG_LIMIT', '候选工具目录超过本次运行限制。');
    this.skillState = new RunSkills({
      workspaceId: options.workspaceId,
      initial: options.skills,
      candidates: options.skillCandidates ?? [],
      ...(options.skillPort ? { port: options.skillPort } : {}),
    });
  }

  public skills(): readonly FrozenSkill[] {
    return this.skillState.skills();
  }

  /** Request preparation may expose only operations present in this accepted catalog. */
  public canProvide(name: string): boolean {
    return this.candidates.has(name);
  }

  public async retainCommandResources(signal: AbortSignal): Promise<CommandResourceLease> {
    this.assertOpen();
    return this.skillState.retainCommandResources(signal);
  }

  public async prepareResources(signal: AbortSignal): Promise<void> {
    this.assertOpen();
    await this.skillState.prepareResources(signal);
  }

  public assertCurrent(): void {
    this.skillState.assertCurrent();
  }

  public async validate(signal: AbortSignal): Promise<void> {
    await this.skillState.validate(signal);
  }

  public assertSkillAdditions(skills: readonly FrozenSkill[]): void {
    this.assertOpen();
    this.skillState.assertAdditions(skills);
    this.assertStageLimit(this.skillToolNames(skills));
  }

  public stageSkills(skills: readonly FrozenSkill[]): void {
    this.assertSkillAdditions(skills);
    this.ensure(this.skillToolNames(skills));
    this.skillState.stage(skills);
  }

  private skillToolNames(skills: readonly FrozenSkill[]): string[] {
    const names = skills
      .flatMap((skill) => skill.allowedTools)
      .filter((name) => this.candidates.get(name)?.source.kind === 'workspace');
    if (
      skills.some((skill) => skill.resources.length > 0) &&
      this.candidates.has('read_skill_resource')
    )
      names.push('read_skill_resource');
    return [...new Set(names)];
  }

  public async readResource(id: string, path: string, signal: AbortSignal): Promise<ToolContent[]> {
    signal.throwIfAborted();
    this.assertOpen();
    return this.skillState.readResource(id, path, signal);
  }
  public async loadSkill(id: string, signal: AbortSignal): Promise<ToolContent[]> {
    signal.throwIfAborted();
    this.assertOpen();
    const skill = await this.skillState.resolve(id, signal);
    signal.throwIfAborted();
    this.stageSkills([skill]);
    const resourceDirectory = await this.skillState.resourceDirectory(skill, signal);
    return [
      {
        type: 'text',
        text: JSON.stringify({
          id: skill.selection.id,
          resourceDirectory,
          availableFrom: 'next-model-request',
        }),
      },
    ];
  }
  public async search(query: string, limit: number, signal: AbortSignal): Promise<ToolContent[]> {
    signal.throwIfAborted();
    this.assertOpen();
    const documents: ToolSearchDocument[] = [...this.candidates.values()].map((tool) => ({
      definition: tool.definition,
      label: tool.external?.displayName ?? tool.definition.name,
      source: tool.source.kind,
      originalName: tool.external?.selection.remoteToolName ?? tool.definition.name,
    }));
    const matches = await this.catalogSearch.search(documents, query, signal);
    signal.throwIfAborted();
    this.assertOpen();
    const visible = this.visibleNames();
    let remaining = MAX_VISIBLE_TOOLS - visible.size;
    const selected = matches
      .filter(({ definition }) => {
        if (visible.has(definition.name)) return true;
        if (remaining <= 0) return false;
        remaining -= 1;
        return true;
      })
      .slice(0, limit);
    this.ensure(selected.map(({ definition }) => definition.name));
    return [
      {
        type: 'text',
        text: JSON.stringify({
          matches: selected.map(({ definition, label, source }) => ({
            name: definition.name,
            label,
            description: definition.description.slice(0, 160),
            source,
            availability: this.active.definitions.some((tool) => tool.name === definition.name)
              ? 'already-available'
              : 'next-model-request',
          })),
          ...(selected.length === 0
            ? {
                message:
                  'No matching available tools. Try a service, exact tool name or task phrase. An empty result does not establish an OAuth failure.',
                discovery: this.diagnostics,
              }
            : {}),
        }),
      },
    ];
  }

  /** Host-owned dependencies use the same accepted candidate and durable publication path as discovery. */
  public ensure(names: readonly string[]): void {
    this.assertOpen();
    for (const name of names)
      if (!this.candidates.has(name))
        throw new RuntimeError('TOOL_NOT_AVAILABLE', `候选中没有工具：${name}`);
    this.assertStageLimit(names);
    for (const name of names)
      if (!this.active.definitions.some((tool) => tool.name === name)) this.pendingNames.add(name);
  }

  private visibleNames(): Set<string> {
    return new Set([...this.active.definitions.map(({ name }) => name), ...this.pendingNames]);
  }

  private assertStageLimit(names: readonly string[]): void {
    if (new Set([...this.visibleNames(), ...names]).size > MAX_VISIBLE_TOOLS)
      throw new RuntimeError('TOOL_LIMIT', '本次运行最多同时提供64个工具。');
  }

  private assertOpen(): void {
    if (this.closed) throw new RuntimeError('RUN_CLOSED', '本次运行已结束。');
  }

  /** Persist before publishing to Pi, context budgeting or execution. */
  public advance(): boolean {
    this.assertOpen();
    if (
      this.pendingNames.size === 0 &&
      this.skillState.pending().length === 0 &&
      !this.skillState.resourcesChanged
    )
      return false;
    const records: RunToolSelection[] = [...this.active.records];
    for (const name of this.pendingNames) {
      const record = this.candidates.get(name);
      if (!record) throw new RuntimeError('TOOL_NOT_AVAILABLE', '候选工具已失效。');
      records.push(record);
    }
    const next = new RunToolset(records);
    const skills = [...this.skillState.skills(), ...this.skillState.pending()];
    const release = this.skillState.retainPending();
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
    this.skillState.commit(release);
    this.active = next;
    this.pendingNames.clear();
    this.revision += 1;
    return true;
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.skillState.close();
    this.pendingNames.clear();
  }
}
