import { lstat, mkdir, realpath, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BUILTIN_PLUGINS,
  BUILTIN_PLUGIN_RESOURCE_DIRECTORY,
  SkillError,
  SkillCatalog,
  installSkillFiles,
  readSkillTree,
  syncSkillDirectory,
} from '@my-pi-harness/integrations';
import type { PluginComponent, PluginManifest, PluginView } from '@my-pi-harness/protocol';
import type { ExtensionRepository, StoredPlugin } from '@my-pi-harness/storage';
import type { SkillsService } from '../skills/service.js';

export interface PluginAppPort {
  install(
    pluginId: string,
    app: PluginManifest['apps'][number],
    signal: AbortSignal,
  ): Promise<string>;
  setEnabled(
    pluginId: string,
    componentId: string,
    referenceId: string,
    enabled: boolean,
  ): Promise<void>;
  remove(pluginId: string, componentId: string, referenceId: string): Promise<void>;
}
export interface PluginServiceOptions {
  repository: ExtensionRepository;
  profileDirectory: string;
  skills: SkillsService;
  apps?: PluginAppPort;
  resourceDirectory?: string;
}
/** Plugin ownership is saved by exact references; names never identify removable MCP servers. */
export class PluginService {
  private readonly pending = new Set<string>();
  private readonly busy = new Set<string>();
  private readonly operations = new Set<AbortController>();
  private readonly settlements = new Set<Promise<void>>();
  private stopped = false;
  public constructor(private readonly options: PluginServiceOptions) {}
  private manifest(id: string): PluginManifest {
    const manifest = BUILTIN_PLUGINS.find((entry) => entry.id === id);
    if (!manifest) throw new SkillError('PLUGIN_NOT_FOUND', 'Unknown built-in plugin');
    return manifest;
  }
  public list(): PluginView[] {
    return BUILTIN_PLUGINS.map((manifest) => {
      const installed = this.options.repository.plugins().find((entry) => entry.id === manifest.id);
      if (installed === undefined)
        return { manifest, installed: false, enabled: false, revision: 0, components: [] };
      return {
        manifest,
        installed: true,
        enabled: installed.enabled,
        revision: installed.revision,
        components: installed.components,
      };
    });
  }
  private stored(id: string, expectedRevision: number): StoredPlugin {
    const plugin = this.options.repository.plugins().find((entry) => entry.id === id);
    if (plugin === undefined || plugin.revision !== expectedRevision)
      throw new SkillError('PLUGIN_CONFLICT', 'Plugin installation changed');
    return plugin;
  }
  private resourceRoot(): string {
    if (this.options.resourceDirectory !== undefined) return this.options.resourceDirectory;
    return BUILTIN_PLUGIN_RESOURCE_DIRECTORY;
  }
  private async installCore(id: string, signal: AbortSignal): Promise<PluginView> {
    const manifest = this.manifest(id);
    if (this.pending.has(id) || this.options.repository.plugins().some((entry) => entry.id === id))
      throw new SkillError('PLUGIN_CONFLICT', 'Plugin is already installed or installing');
    this.pending.add(id);
    const root = join(this.options.profileDirectory, 'plugins');
    const staging = join(root, `.install-${randomUUID()}`);
    const directory = join(root, id);
    const components: PluginComponent[] = [];
    let moved = false;
    try {
      if ((await realpath(this.options.profileDirectory)) !== this.options.profileDirectory)
        throw new SkillError('PLUGIN_OWNER', 'Plugin profile root changed');
      try {
        const status = await lstat(root);
        if (!status.isDirectory() || status.isSymbolicLink())
          throw new SkillError(
            'PLUGIN_OWNER',
            'Plugin installation root is not a regular directory',
          );
      } catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        await mkdir(root, { mode: 0o700 });
      }
      try {
        await lstat(directory);
        throw new SkillError('PLUGIN_CONFLICT', 'Plugin destination already exists');
      } catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      await mkdir(staging, { recursive: true, mode: 0o700 });
      for (const skill of manifest.skills) {
        const files = await readSkillTree(join(this.resourceRoot(), id, 'skills', skill), signal);
        await installSkillFiles(join(staging, 'skills'), skill, files, signal);
      }
      for (const app of manifest.apps) {
        if (this.options.apps === undefined)
          throw new SkillError(
            'PLUGIN_APPS_UNAVAILABLE',
            'Plugin app integration has not been configured',
          );
        const referenceId = await this.options.apps.install(id, app, signal);
        components.push({ id: app.id, kind: 'app', enabled: true, referenceId });
      }
      signal.throwIfAborted();
      await rename(staging, directory);
      moved = true;
      await syncSkillDirectory(root);
      await syncSkillDirectory(this.options.profileDirectory);
      const catalog = new SkillCatalog({
        snapshotDirectory: join(this.options.profileDirectory, 'skill-versions'),
      });
      const skills = await catalog.discover(
        [
          {
            path: join(directory, 'skills'),
            scope: 'plugin',
            pluginId: id,
            workspaceId: null,
            managed: false,
          },
        ],
        signal,
      );
      for (const name of manifest.skills) {
        const skill = skills.find((entry) => entry.name === name);
        if (skill === undefined)
          throw new SkillError('PLUGIN_RESOURCE', 'Installed plugin Skill was not discovered');
        components.push({
          id: `skill:${name}`,
          kind: 'skill',
          enabled: true,
          referenceId: skill.id,
        });
      }
      signal.throwIfAborted();
      this.options.repository.savePlugin(
        { id, generation: randomUUID(), revision: 1, enabled: true, directory, components },
        null,
      );
      const result = this.list().find((entry) => entry.manifest.id === id);
      if (!result) throw new SkillError('PLUGIN_INSTALL', 'Plugin registration failed');
      return result;
    } catch (error: unknown) {
      for (const component of components)
        if (component.kind === 'app' && this.options.apps !== undefined)
          await this.options.apps.remove(id, component.id, component.referenceId);
      const record = this.options.repository.plugins().find((entry) => entry.id === id);
      if (record !== undefined) this.options.repository.removePlugin(id, record.revision);
      if (moved) await rm(directory, { recursive: true, force: true });
      throw error;
    } finally {
      await rm(staging, { recursive: true, force: true });
      this.pending.delete(id);
    }
  }
  private async controlCore(
    id: string,
    expectedRevision: number,
    enabled: boolean,
  ): Promise<PluginView> {
    const plugin = this.stored(id, expectedRevision);
    for (const component of plugin.components)
      if (component.kind === 'app' && this.options.apps !== undefined)
        await this.options.apps.setEnabled(
          id,
          component.id,
          component.referenceId,
          enabled && component.enabled,
        );
    this.options.repository.savePlugin(
      { ...plugin, revision: plugin.revision + 1, enabled },
      plugin.revision,
    );
    return this.list().find((entry) => entry.manifest.id === id) ?? this.missing();
  }
  private missing(): never {
    throw new SkillError('PLUGIN_NOT_FOUND', 'Plugin disappeared');
  }
  private async componentCore(
    id: string,
    componentId: string,
    expectedRevision: number,
    enabled: boolean,
  ): Promise<PluginView> {
    const plugin = this.stored(id, expectedRevision);
    const component = plugin.components.find((entry) => entry.id === componentId);
    if (!component) throw new SkillError('PLUGIN_COMPONENT', 'Plugin component does not exist');
    if (component.kind === 'app' && this.options.apps !== undefined)
      await this.options.apps.setEnabled(
        id,
        component.id,
        component.referenceId,
        plugin.enabled && enabled,
      );
    this.options.repository.savePlugin(
      {
        ...plugin,
        revision: plugin.revision + 1,
        components: plugin.components.map((entry) => {
          if (entry.id === componentId) return { ...entry, enabled };
          return entry;
        }),
      },
      plugin.revision,
    );
    return this.list().find((entry) => entry.manifest.id === id) ?? this.missing();
  }
  private async removeCore(id: string, expectedRevision: number): Promise<void> {
    this.manifest(id);
    const plugin = this.stored(id, expectedRevision);
    const expectedDirectory = resolve(this.options.profileDirectory, 'plugins', id);
    if (resolve(plugin.directory) !== expectedDirectory)
      throw new SkillError(
        'PLUGIN_OWNER',
        'Plugin installation directory does not match its owner',
      );
    if ((await realpath(plugin.directory)) !== expectedDirectory)
      throw new SkillError('PLUGIN_OWNER', 'Plugin directory changed identity');
    for (const component of plugin.components)
      if (component.kind === 'skill') this.options.skills.assertRemovable(component.referenceId);
    const removing = this.options.repository.savePlugin(
      { ...plugin, revision: plugin.revision + 1, enabled: false },
      plugin.revision,
    );
    for (const component of plugin.components)
      if (component.kind === 'app' && this.options.apps !== undefined)
        await this.options.apps.remove(id, component.id, component.referenceId);
    await rm(plugin.directory, { recursive: true });
    this.options.repository.removePlugin(id, removing.revision);
  }
  private async ownOperation<T>(
    id: string,
    signal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.stopped) throw new SkillError('PLUGIN_CLOSED', 'Plugin service is closing');
    if (this.busy.has(id))
      throw new SkillError('PLUGIN_BUSY', 'Another operation owns this plugin');
    const controller = new AbortController();
    this.operations.add(controller);
    this.busy.add(id);
    let settle: () => void = () => undefined;
    const settlement = new Promise<void>((resolve) => {
      settle = resolve;
    });
    this.settlements.add(settlement);
    try {
      return await operation(AbortSignal.any([signal, controller.signal]));
    } finally {
      settle();
      this.settlements.delete(settlement);
      this.operations.delete(controller);
      this.busy.delete(id);
    }
  }
  public async install(id: string, signal: AbortSignal): Promise<PluginView> {
    return await this.ownOperation(id, signal, async (owned) => await this.installCore(id, owned));
  }
  public async control(
    id: string,
    expectedRevision: number,
    enabled: boolean,
  ): Promise<PluginView> {
    return await this.ownOperation(
      id,
      new AbortController().signal,
      async () => await this.controlCore(id, expectedRevision, enabled),
    );
  }
  public async component(
    id: string,
    componentId: string,
    expectedRevision: number,
    enabled: boolean,
  ): Promise<PluginView> {
    return await this.ownOperation(
      id,
      new AbortController().signal,
      async () => await this.componentCore(id, componentId, expectedRevision, enabled),
    );
  }
  public async remove(id: string, expectedRevision: number): Promise<void> {
    await this.ownOperation(
      id,
      new AbortController().signal,
      async () => await this.removeCore(id, expectedRevision),
    );
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
