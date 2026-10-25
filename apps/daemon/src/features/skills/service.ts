import { realpath, rm } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import {
  SkillCatalog,
  SkillError,
  downloadGitHubSkill,
  installSkillFiles,
  type SkillRoot,
  type SkillResourceContent,
} from '@my-pi-harness/integrations';
import type {
  FrozenSkill,
  SkillCreateInput,
  SkillDetail,
  SkillInstallInput,
  SkillSelection,
  SkillView,
  Workspace,
} from '@my-pi-harness/protocol';
import type { ExtensionRepository, StoredSkill } from '@my-pi-harness/storage';

export interface SkillsServiceOptions {
  repository: ExtensionRepository;
  profileDirectory: string;
  resolveWorkspace(id: string): Promise<Workspace>;
  githubFetch?: typeof fetch;
}
/** Owns registered Skill roots and immutable resources; instruction text never grants tool access. */
export class SkillsService {
  private readonly catalog: SkillCatalog;
  private readonly operations = new Set<AbortController>();
  private readonly settlements = new Set<Promise<void>>();
  private stopped = false;
  public constructor(private readonly options: SkillsServiceOptions) {
    this.catalog = new SkillCatalog({
      snapshotDirectory: join(options.profileDirectory, 'skill-versions'),
    });
  }
  private async roots(workspaceId: string | null): Promise<SkillRoot[]> {
    const roots: SkillRoot[] = [
      {
        path: join(this.options.profileDirectory, 'skills'),
        scope: 'user',
        workspaceId: null,
        pluginId: null,
        managed: true,
      },
    ];
    if (workspaceId !== null) {
      const workspace = await this.options.resolveWorkspace(workspaceId);
      roots.unshift(
        {
          path: join(workspace.rootPath, '.my-pi-harness', 'skills'),
          scope: 'project',
          workspaceId,
          pluginId: null,
          managed: true,
        },
        {
          path: join(workspace.rootPath, '.agents', 'skills'),
          scope: 'project',
          workspaceId,
          pluginId: null,
          managed: false,
        },
      );
    }
    for (const plugin of this.options.repository.plugins()) {
      if (
        !/^[a-z][a-z0-9-]*$/.test(plugin.id) ||
        plugin.directory !== join(this.options.profileDirectory, 'plugins', plugin.id)
      )
        throw new SkillError('SKILL_OWNER', 'Plugin installation root is inconsistent');
      if (plugin.enabled)
        roots.push({
          path: join(plugin.directory, 'skills'),
          scope: 'plugin',
          workspaceId: null,
          pluginId: plugin.id,
          managed: false,
        });
    }
    return roots;
  }
  private async discover(workspaceId: string | null, signal: AbortSignal) {
    return await this.catalog.discover(await this.roots(workspaceId), signal);
  }
  private enabled(id: string): boolean {
    const control = this.options.repository.skills().find((entry) => entry.id === id);
    if (control !== undefined && !control.enabled) return false;
    return true;
  }
  public async list(workspaceId: string | null, signal: AbortSignal): Promise<SkillView[]> {
    const skills = await this.discover(workspaceId, signal);
    const seen = new Set<string>();
    return skills.map((skill) => {
      let enabled = this.enabled(skill.id);
      if (skill.pluginId !== null) {
        const plugin = this.options.repository
          .plugins()
          .find((entry) => entry.id === skill.pluginId);
        const component = plugin?.components.find(
          (entry) => entry.kind === 'skill' && entry.referenceId === skill.id,
        );
        if (component !== undefined && !component.enabled) enabled = false;
      }
      const shadowed = seen.has(skill.name);
      if (enabled) seen.add(skill.name);
      return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        scope: skill.scope,
        pluginId: skill.pluginId,
        workspaceId: skill.workspaceId,
        contentHash: skill.contentHash,
        enabled,
        shadowed,
        managed: skill.managed && skill.pluginId === null,
        resourceCount: skill.resources.length,
        source: skill.source,
      };
    });
  }
  public async detail(
    id: string,
    workspaceId: string | null,
    signal: AbortSignal,
  ): Promise<SkillDetail> {
    const entry = (await this.discover(workspaceId, signal)).find((skill) => skill.id === id);
    const view = (await this.list(workspaceId, signal)).find((skill) => skill.id === id);
    if (entry === undefined || view === undefined)
      throw new SkillError('SKILL_NOT_FOUND', 'Skill is not registered in this workspace');
    return {
      ...view,
      content: entry.content,
      resources: entry.resources,
      allowedTools: entry.allowedTools,
    };
  }
  public async freezeSelections(
    workspaceId: string | null,
    selections: readonly SkillSelection[],
    signal: AbortSignal,
  ): Promise<FrozenSkill[]> {
    if (this.stopped) throw new SkillError('SKILL_CLOSED', 'Skills service is closing');
    if (
      selections.length > 16 ||
      new Set(selections.map((entry) => entry.id)).size !== selections.length
    )
      throw new SkillError('SKILL_SELECTION', 'Select at most 16 distinct Skills');
    const skills = await this.discover(workspaceId, signal);
    const views = await this.list(workspaceId, signal);
    const output: FrozenSkill[] = [];
    for (const selection of selections) {
      const skill = skills.find((entry) => entry.id === selection.id);
      const view = views.find((entry) => entry.id === selection.id);
      if (
        skill === undefined ||
        view === undefined ||
        !view.enabled ||
        view.shadowed ||
        skill.contentHash !== selection.contentHash
      )
        throw new SkillError(
          'SKILL_STALE',
          'Skill was disabled, replaced or changed; select its current version',
        );
      const record = this.options.repository.skills().find((entry) => entry.id === skill.id);
      const plugin = this.options.repository.plugins().find((entry) => entry.id === skill.pluginId);
      const frozen = await this.catalog.freeze(skill, signal, {
        skillEpoch: record?.revision ?? 0,
        pluginId: skill.pluginId,
        pluginEpoch: plugin?.revision ?? 0,
        pluginGeneration: plugin?.generation ?? null,
      });
      let source = skill.source;
      if (record?.source.startsWith('github:')) source = `${record.source} (${skill.source})`;
      if (plugin !== undefined)
        source = `plugin:${plugin.id}@${plugin.generation} (${skill.source})`;
      output.push({ ...frozen, source });
    }
    this.assertBindingsCurrent(output);
    return output;
  }
  /** Validate frozen content and current controls, without reading newer source instructions. */
  public async validateBindings(
    skills: readonly FrozenSkill[],
    signal: AbortSignal,
  ): Promise<void> {
    for (const skill of skills) {
      this.assertBindingsCurrent([skill]);
      await this.catalog.verifySnapshot(skill, signal);
    }
  }
  public assertBindingsCurrent(skills: readonly FrozenSkill[]): void {
    for (const skill of skills) {
      const record = this.options.repository
        .skills()
        .find((entry) => entry.id === skill.selection.id);
      if (
        !this.enabled(skill.selection.id) ||
        (record?.revision ?? 0) !== skill.authorization.skillEpoch
      )
        throw new SkillError('SKILL_REVOKED', 'Skill authorization has changed');
      if (skill.authorization.pluginId !== null) {
        const plugin = this.options.repository
          .plugins()
          .find((entry) => entry.id === skill.authorization.pluginId);
        const component = plugin?.components.find(
          (entry) => entry.referenceId === skill.selection.id && entry.kind === 'skill',
        );
        if (
          plugin === undefined ||
          !plugin.enabled ||
          plugin.revision !== skill.authorization.pluginEpoch ||
          plugin.generation !== skill.authorization.pluginGeneration ||
          component === undefined ||
          !component.enabled
        )
          throw new SkillError('SKILL_REVOKED', 'Plugin Skill authorization has changed');
      }
    }
  }
  public retainBindings(skills: readonly FrozenSkill[]): () => void {
    this.assertBindingsCurrent(skills);
    return this.catalog.retainBindings(skills);
  }
  public async loadResource(
    skill: FrozenSkill,
    path: string,
    signal: AbortSignal,
  ): Promise<SkillResourceContent> {
    await this.validateBindings([skill], signal);
    return await this.catalog.loadResource(skill, path, signal);
  }
  public async readResource(
    id: string,
    workspaceId: string | null,
    contentHash: string,
    path: string,
    signal: AbortSignal,
  ): Promise<SkillResourceContent> {
    const [skill] = await this.freezeSelections(workspaceId, [{ id, contentHash }], signal);
    if (skill === undefined) throw new SkillError('SKILL_NOT_FOUND', 'Skill could not be loaded');
    return await this.loadResource(skill, path, signal);
  }
  public async resolveDirectory(
    id: string,
    workspaceId: string | null,
    signal: AbortSignal,
  ): Promise<string> {
    const detail = await this.detail(id, workspaceId, signal);
    return detail.source;
  }
  private async installationRoot(
    scope: SkillCreateInput['scope'],
    workspaceId: string | null,
  ): Promise<string> {
    if (scope === 'user') {
      if (workspaceId !== null)
        throw new SkillError('SKILL_SCOPE', 'User Skills do not belong to a workspace');
      return join(this.options.profileDirectory, 'skills');
    }
    if (workspaceId === null)
      throw new SkillError('SKILL_SCOPE', 'Project Skills require a registered workspace');
    const workspace = await this.options.resolveWorkspace(workspaceId);
    return join(workspace.rootPath, '.my-pi-harness', 'skills');
  }
  private async ownOperation<T>(
    signal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.stopped) throw new SkillError('SKILL_CLOSED', 'Skills service is closing');
    const controller = new AbortController();
    this.operations.add(controller);
    let settle: () => void = () => undefined;
    const settlement = new Promise<void>((resolve) => {
      settle = resolve;
    });
    this.settlements.add(settlement);
    try {
      return await operation(AbortSignal.any([signal, controller.signal]));
    } finally {
      this.operations.delete(controller);
      settle();
      this.settlements.delete(settlement);
    }
  }
  private async register(
    directory: string,
    workspaceId: string | null,
    source: string,
    signal: AbortSignal,
  ): Promise<SkillView> {
    const view = (await this.list(workspaceId, signal)).find((entry) => entry.source === directory);
    if (view === undefined)
      throw new SkillError(
        'SKILL_INSTALL',
        'Installed Skill did not appear in its registered scope',
      );
    const previous = this.options.repository.skills().find((entry) => entry.id === view.id);
    this.options.repository.saveSkill(
      {
        id: view.id,
        revision: (previous?.revision ?? 0) + 1,
        enabled: true,
        managed: true,
        directory,
        scope: view.scope,
        pluginId: null,
        workspaceId: view.workspaceId,
        source,
        contentHash: view.contentHash,
      },
      previous?.revision ?? null,
    );
    return { ...view, enabled: true };
  }
  public async create(input: SkillCreateInput, signal: AbortSignal): Promise<SkillView> {
    return await this.ownOperation(signal, async (operationSignal) => {
      const root = await this.installationRoot(input.scope, input.workspaceId);
      const text = `---\nname: ${JSON.stringify(input.name)}\ndescription: ${JSON.stringify(input.description)}\n---\n\n${input.content}\n`;
      const directory = await installSkillFiles(
        root,
        input.name,
        [{ path: 'SKILL.md', content: Buffer.from(text) }],
        operationSignal,
      );
      try {
        return await this.register(directory, input.workspaceId, 'created', operationSignal);
      } catch (error: unknown) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
    });
  }
  public async install(input: SkillInstallInput, signal: AbortSignal): Promise<SkillView> {
    return await this.ownOperation(signal, async (operationSignal) => {
      const root = await this.installationRoot(input.scope, input.workspaceId);
      const downloaded = await downloadGitHubSkill(
        input,
        operationSignal,
        this.options.githubFetch,
      );
      const directory = await installSkillFiles(
        root,
        downloaded.name,
        downloaded.files,
        operationSignal,
      );
      try {
        return await this.register(
          directory,
          input.workspaceId,
          `github:${input.owner}/${input.repository}@${downloaded.commit}/${input.path}`,
          operationSignal,
        );
      } catch (error: unknown) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
    });
  }
  private async controlCore(
    id: string,
    workspaceId: string | null,
    contentHash: string,
    enabled: boolean,
    signal: AbortSignal,
  ): Promise<SkillView> {
    const detail = await this.detail(id, workspaceId, signal);
    if (detail.contentHash !== contentHash)
      throw new SkillError('SKILL_STALE', 'Skill version changed');
    if (detail.pluginId !== null)
      throw new SkillError('SKILL_OWNER', 'Manage this Skill through its plugin');
    const previous = this.options.repository.skills().find((entry) => entry.id === id);
    const record: StoredSkill = {
      id,
      revision: (previous?.revision ?? 0) + 1,
      enabled,
      managed: detail.managed,
      directory: detail.source,
      scope: detail.scope,
      pluginId: null,
      workspaceId: detail.workspaceId,
      source: previous?.source ?? 'discovered',
      contentHash,
    };
    this.options.repository.saveSkill(record, previous?.revision ?? null);
    return { ...detail, enabled };
  }
  private async removeCore(
    id: string,
    workspaceId: string | null,
    contentHash: string,
    signal: AbortSignal,
  ): Promise<void> {
    const detail = await this.detail(id, workspaceId, signal);
    const record = this.options.repository.skills().find((entry) => entry.id === id);
    if (detail.contentHash !== contentHash)
      throw new SkillError('SKILL_STALE', 'Skill version changed');
    if (
      !detail.managed ||
      detail.pluginId !== null ||
      record === undefined ||
      !record.managed ||
      record.directory !== detail.source ||
      record.scope !== detail.scope ||
      record.workspaceId !== detail.workspaceId
    )
      throw new SkillError('SKILL_OWNER', 'Only explicitly installed Skills can be uninstalled');
    this.catalog.assertRemovable(id);
    const root = await this.installationRoot(
      record.scope === 'project' ? 'project' : 'user',
      record.workspaceId,
    );
    const location = relative(root, record.directory);
    if (
      location.startsWith('..') ||
      isAbsolute(location) ||
      location.includes('/') ||
      location.includes('\\')
    )
      throw new SkillError('SKILL_OWNER', 'Installed Skill ownership is invalid');
    if ((await realpath(record.directory)) !== record.directory)
      throw new SkillError('SKILL_OWNER', 'Skill directory changed identity');
    this.catalog.assertRemovable(id);
    this.options.repository.saveSkill(
      { ...record, revision: record.revision + 1, enabled: false },
      record.revision,
    );
    await rm(record.directory, { recursive: true });
  }
  public async control(
    id: string,
    workspaceId: string | null,
    contentHash: string,
    enabled: boolean,
    signal: AbortSignal,
  ): Promise<SkillView> {
    return await this.ownOperation(
      signal,
      async (owned) => await this.controlCore(id, workspaceId, contentHash, enabled, owned),
    );
  }
  public async remove(
    id: string,
    workspaceId: string | null,
    contentHash: string,
    signal: AbortSignal,
  ): Promise<void> {
    await this.ownOperation(
      signal,
      async (owned) => await this.removeCore(id, workspaceId, contentHash, owned),
    );
  }
  public assertRemovable(id: string): void {
    this.catalog.assertRemovable(id);
  }
  public stopAccepting(): void {
    this.stopped = true;
    for (const controller of this.operations) controller.abort();
  }
  public async close(): Promise<void> {
    this.stopAccepting();
    await Promise.all(this.settlements);
  }
}
