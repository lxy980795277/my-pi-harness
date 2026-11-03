import { Value } from 'typebox/value';
import type { ExecutionContent } from '@my-pi-harness/execution';
import type { FrozenSkill, SkillCandidate } from '@my-pi-harness/protocol';
import { RuntimeError } from '../errors.js';
import type { SkillsPort } from './ports.js';

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
  private readonly releases: (() => void)[] = [];

  public constructor(private readonly options: RunSkillsOptions) {
    for (const candidate of options.candidates)
      this.candidates.set(candidate.selection.id, Value.Clone(candidate));
    for (const skill of options.initial) this.active.set(skill.selection.id, Value.Clone(skill));
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

  public async readResource(
    id: string,
    path: string,
    signal: AbortSignal,
  ): Promise<ExecutionContent[]> {
    const skill = this.active.get(id);
    if (!skill) throw new RuntimeError('SKILL_NOT_ACTIVE', 'Skill尚未激活。');
    if (!this.options.port) throw new RuntimeError('SKILLS_UNAVAILABLE', 'Skill运行时不可用。');
    await this.options.port.validateBindings([skill], signal);
    return await this.options.port.loadResource(skill, path, signal);
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
  }

  public close(): void {
    for (const release of this.releases.splice(0).reverse()) release();
    this.staged.clear();
  }
}
