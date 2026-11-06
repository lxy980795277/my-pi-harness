import type { SkillResourceLease, CommandResourceLease } from '@my-pi-harness/tools';
import { Value } from 'typebox/value';
import type { ToolContent } from '@my-pi-harness/tools';
import type { FrozenSkill, SkillCandidate } from '@my-pi-harness/protocol';
import { RuntimeError } from '../errors';
import type { SkillsPort } from './ports';

interface RunSkillsOptions {
  workspaceId: string | null;
  initial: readonly FrozenSkill[];
  candidates: readonly SkillCandidate[];
  port?: SkillsPort;
}

/** Accepted Skill bodies and leases belong to one Run; candidate metadata has no active lease. */
export class RunSkills {
  private readonly active = new Map<string, FrozenSkill>();
  private readonly staged = new Map<string, FrozenSkill>();
  private readonly candidates = new Map<string, SkillCandidate>();
  public resourcesChanged = false;
  private readonly resources = new Map<string, SkillResourceLease>();
  private readonly releases: (() => void)[] = [];

  public constructor(private readonly options: RunSkillsOptions) {
    for (const candidate of options.candidates)
      this.candidates.set(candidate.selection.id, Value.Clone(candidate));
    for (const skill of options.initial) {
      const frozen = Value.Clone(skill);
      delete frozen.resourceDirectory;
      this.active.set(skill.selection.id, frozen);
    }
    if (options.port && options.initial.length > 0)
      this.releases.push(options.port.retainBindings(options.initial));
  }

  public skills(): readonly FrozenSkill[] {
    return [...this.active.values()];
  }

  public pending(): readonly FrozenSkill[] {
    return [...this.staged.values()];
  }

  public assertCurrent(): void {
    this.options.port?.assertBindingsCurrent(this.skills());
  }

  public async validate(signal: AbortSignal): Promise<void> {
    await this.options.port?.validateBindings(this.skills(), signal);
  }

  /** Explicit accepted inputs cannot replace a Skill already selected by this Run. */
  public assertAdditions(skills: readonly FrozenSkill[]): void {
    this.options.port?.assertBindingsCurrent(skills);
    const selected = new Map([...this.active, ...this.staged]);
    for (const skill of skills) {
      const prior = selected.get(skill.selection.id);
      if (
        prior &&
        (prior.selection.contentHash !== skill.selection.contentHash ||
          JSON.stringify(prior.authorization) !== JSON.stringify(skill.authorization))
      )
        throw new RuntimeError('SKILL_CONFLICT', '不能替换本次运行已冻结的Skill版本。');
      selected.set(skill.selection.id, skill);
    }
    if (selected.size > 16) throw new RuntimeError('SKILL_LIMIT', '最多激活16个Skill。');
  }

  public stage(skills: readonly FrozenSkill[]): void {
    this.assertAdditions(skills);
    for (const skill of skills)
      if (!this.active.has(skill.selection.id))
        this.staged.set(skill.selection.id, Value.Clone(skill));
  }

  /** The model chooses an id; the host resolves the exact accepted content and authorization. */
  public async resolve(id: string, signal: AbortSignal): Promise<FrozenSkill> {
    const existing = this.active.get(id) ?? this.staged.get(id);
    if (existing) return existing;
    const candidate = this.candidates.get(id);
    if (!candidate) throw new RuntimeError('SKILL_NOT_AVAILABLE', '本次运行的目录中没有此Skill。');
    if (!this.options.port) throw new RuntimeError('SKILLS_UNAVAILABLE', 'Skill运行时不可用。');
    return await this.options.port.loadCandidate(this.options.workspaceId, candidate, signal);
  }

  public async readResource(id: string, path: string, signal: AbortSignal): Promise<ToolContent[]> {
    const skill = this.active.get(id);
    if (!skill) throw new RuntimeError('SKILL_NOT_ACTIVE', 'Skill尚未激活。');
    if (!this.options.port) throw new RuntimeError('SKILLS_UNAVAILABLE', 'Skill运行时不可用。');
    await this.options.port.validateBindings([skill], signal);
    return await this.options.port.loadResource(skill, path, signal);
  }

  public async resourceDirectory(
    skill: FrozenSkill,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    let lease = this.resources.get(skill.selection.id);
    if (!lease && this.options.port?.materializeBindings) {
      lease = await this.options.port.materializeBindings([skill], signal);
      this.resources.set(skill.selection.id, lease);
    }
    const directory = lease?.bindings.find(
      (binding) => binding.selection.id === skill.selection.id,
    )?.directory;
    if (directory !== undefined && skill.resourceDirectory !== directory) {
      const bound = { ...skill, resourceDirectory: directory };
      if (this.active.has(skill.selection.id)) this.active.set(skill.selection.id, bound);
      else if (this.staged.has(skill.selection.id)) this.staged.set(skill.selection.id, bound);
      this.resourcesChanged = true;
    }
    return directory;
  }
  public async prepareResources(signal: AbortSignal): Promise<void> {
    for (const skill of this.skills()) await this.resourceDirectory(skill, signal);
  }

  public async retainCommandResources(signal: AbortSignal): Promise<CommandResourceLease> {
    const skills = [...this.skills()];
    const held: SkillResourceLease[] = [];
    try {
      for (const skill of skills) {
        await this.resourceDirectory(skill, signal);
        const source = this.resources.get(skill.selection.id);
        if (source) held.push(await source.retain(signal));
      }
    } catch (error) {
      await Promise.all(held.map((lease) => lease.release()));
      throw error;
    }
    return {
      readOnlyDirectories: held.flatMap((lease) => lease.readOnlyDirectories),
      verify: async (current) => {
        this.options.port?.assertBindingsCurrent(skills);
        for (const lease of held) await lease.verify(current);
      },
      release: async () => {
        await Promise.all(held.map((lease) => lease.release()));
      },
    };
  }

  /** Retain before committing; the caller releases this lease if persistence fails. */
  public retainPending(): (() => void) | undefined {
    this.options.port?.assertBindingsCurrent([...this.skills(), ...this.pending()]);
    if (this.staged.size === 0) return undefined;
    return this.options.port?.retainBindings(this.pending());
  }

  public commit(release: (() => void) | undefined): void {
    if (release) this.releases.push(release);
    for (const [id, skill] of this.staged) this.active.set(id, skill);
    this.staged.clear();
    this.resourcesChanged = false;
  }

  public async close(): Promise<void> {
    const failures: unknown[] = [];
    const settled = await Promise.allSettled(
      [...this.resources.values()].map((lease) => lease.release()),
    );
    for (const result of settled) if (result.status === 'rejected') failures.push(result.reason);
    this.resources.clear();
    for (const release of this.releases.splice(0).reverse())
      try {
        release();
      } catch (error) {
        failures.push(error);
      }
    this.staged.clear();
    if (failures.length) throw new AggregateError(failures, 'Skill资源清理失败。');
  }
}
