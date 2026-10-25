import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SkillError } from './errors.js';
import {
  checkedSkillDirectory,
  readSkillFile,
  readSkillTree,
  resourceIndex,
  skillHash,
  skillResourcePath,
  writeOwnedSkillFile,
  syncSkillDirectory,
} from './files.js';
import { parseSkill } from './parser.js';
import type {
  DiscoveredSkill,
  FrozenSkill,
  SkillCatalogOptions,
  SkillResourceContent,
  SkillRoot,
} from './types.js';

const precedence = { project: 0, user: 1, plugin: 2, system: 3 };
/** Filesystem catalog owns content snapshots, never execution permission. */
export class SkillCatalog {
  private readonly leases = new Map<string, number>();
  public constructor(private readonly options: SkillCatalogOptions) {}

  public async discover(
    roots: readonly SkillRoot[],
    signal: AbortSignal,
  ): Promise<DiscoveredSkill[]> {
    const output: DiscoveredSkill[] = [];
    for (const root of roots) {
      signal.throwIfAborted();
      let entries;
      try {
        entries = await readdir(root.path, { withFileTypes: true });
      } catch (error: unknown) {
        if (isMissing(error)) continue;
        throw error;
      }
      await checkedSkillDirectory(root.path);
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink())
          throw new SkillError('SKILL_SYMLINK', 'Skill directory entries cannot be links');
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const directory = join(root.path, entry.name);
        let files;
        try {
          files = await readSkillTree(directory, signal);
        } catch (error: unknown) {
          if (isMissing(error)) continue;
          throw error;
        }
        const main = files.find((file) => file.path === 'SKILL.md');
        if (!main) continue;
        const parsed = parseSkill(
          new TextDecoder('utf-8', { fatal: true }).decode(main.content),
          entry.name,
        );
        const resources = resourceIndex(files);
        const contentHash = skillHash(
          JSON.stringify([
            parsed.name,
            parsed.description,
            parsed.content,
            parsed.allowedTools,
            resources,
          ]),
        );
        const id = `skill_${skillHash(JSON.stringify([root.scope, root.pluginId, root.workspaceId, root.path, parsed.name])).slice(0, 32)}`;
        output.push({
          ...parsed,
          ...root,
          root: root.path,
          directory,
          id,
          contentHash,
          resources,
          shadowed: false,
          source: directory,
        });
      }
    }
    const rootOrder = new Map(roots.map((root, index) => [root.path, index]));
    output.sort(
      (a, b) =>
        precedence[a.scope] - precedence[b.scope] ||
        (rootOrder.get(a.root) ?? 0) - (rootOrder.get(b.root) ?? 0) ||
        a.name.localeCompare(b.name),
    );
    const names = new Set<string>();
    for (const skill of output) {
      skill.shadowed = names.has(skill.name);
      names.add(skill.name);
    }
    return output;
  }

  public async freeze(
    skill: DiscoveredSkill,
    signal: AbortSignal,
    authorization: FrozenSkill['authorization'] = {
      skillEpoch: 0,
      pluginId: null,
      pluginEpoch: 0,
      pluginGeneration: null,
    },
  ): Promise<FrozenSkill> {
    const files = await readSkillTree(skill.directory, signal);
    const main = files.find((file) => file.path === 'SKILL.md');
    if (!main) throw new SkillError('SKILL_CHANGED', 'SKILL.md disappeared');
    const parsed = parseSkill(
      new TextDecoder('utf-8', { fatal: true }).decode(main.content),
      skill.name,
    );
    const resources = resourceIndex(files);
    const contentHash = skillHash(
      JSON.stringify([
        parsed.name,
        parsed.description,
        parsed.content,
        parsed.allowedTools,
        resources,
      ]),
    );
    if (contentHash !== skill.contentHash)
      throw new SkillError('SKILL_CHANGED', 'Skill content changed; select the new version');
    await mkdir(this.options.snapshotDirectory, { recursive: true, mode: 0o700 });
    await checkedSkillDirectory(this.options.snapshotDirectory);
    const destination = join(this.options.snapshotDirectory, contentHash);
    const staging = join(this.options.snapshotDirectory, `.stage-${randomUUID()}`);
    await mkdir(staging, { mode: 0o700 });
    try {
      const directories = new Set([staging]);
      for (const file of files) {
        signal.throwIfAborted();
        const target = join(staging, file.path);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        let parent = dirname(target);
        while (parent.length >= staging.length) {
          directories.add(parent);
          if (parent === staging) break;
          parent = dirname(parent);
        }
        await writeOwnedSkillFile(target, file.content, 0o400, signal);
      }
      for (const directory of [...directories].sort((a, b) => b.length - a.length))
        await syncSkillDirectory(directory);
      signal.throwIfAborted();
      try {
        await rename(staging, destination);
        await syncSkillDirectory(this.options.snapshotDirectory);
      } catch (error: unknown) {
        if (!isExists(error)) throw error;
        await this.verifySnapshot(
          {
            selection: { id: skill.id, contentHash },
            authorization,
            ...parsed,
            scope: skill.scope,
            source: skill.source,
            resources,
          },
          signal,
        );
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    return {
      selection: { id: skill.id, contentHash },
      authorization,
      ...parsed,
      scope: skill.scope,
      source: skill.source,
      resources,
    };
  }

  public async verifySnapshot(skill: FrozenSkill, signal: AbortSignal): Promise<void> {
    const directory = join(this.options.snapshotDirectory, skill.selection.contentHash);
    const actual = await readSkillTree(directory, signal);
    const main = actual.find((file) => file.path === 'SKILL.md');
    if (!main) throw new SkillError('SKILL_SNAPSHOT', 'Frozen Skill content is missing');
    const parsed = parseSkill(
      new TextDecoder('utf-8', { fatal: true }).decode(main.content),
      skill.name,
    );
    const resources = resourceIndex(actual);
    if (
      parsed.description !== skill.description ||
      parsed.content !== skill.content ||
      JSON.stringify(parsed.allowedTools) !== JSON.stringify(skill.allowedTools) ||
      JSON.stringify(resources) !== JSON.stringify(skill.resources) ||
      skillHash(
        JSON.stringify([
          parsed.name,
          parsed.description,
          parsed.content,
          parsed.allowedTools,
          resources,
        ]),
      ) !== skill.selection.contentHash
    )
      throw new SkillError('SKILL_SNAPSHOT', 'Frozen Skill resource verification failed');
  }

  public async loadResource(
    skill: FrozenSkill,
    path: string,
    signal: AbortSignal,
  ): Promise<SkillResourceContent> {
    skillResourcePath(path);
    const resource = skill.resources.find((entry) => entry.path === path);
    if (!resource)
      throw new SkillError('SKILL_RESOURCE', 'Resource was not part of the accepted Skill');
    const bytes = await readSkillFile(
      join(this.options.snapshotDirectory, skill.selection.contentHash),
      path,
      signal,
    );
    if (skillHash(bytes) !== resource.hash || bytes.length !== resource.size)
      throw new SkillError(
        'SKILL_SNAPSHOT',
        'Frozen resource content does not match its recorded hash',
      );
    if (resource.mediaType.startsWith('image/'))
      return {
        type: 'image',
        data: Buffer.from(bytes).toString('base64'),
        mimeType: resource.mediaType,
        path,
        hash: resource.hash,
      };
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (cause) {
      throw new SkillError('SKILL_BINARY', 'This resource is binary; it cannot be loaded as text', {
        cause,
      });
    }
    return { type: 'text', text, path, hash: resource.hash };
  }

  public retainBindings(skills: readonly FrozenSkill[]): () => void {
    for (const skill of skills)
      this.leases.set(skill.selection.id, (this.leases.get(skill.selection.id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const skill of skills) {
        const count = (this.leases.get(skill.selection.id) ?? 0) - 1;
        if (count <= 0) this.leases.delete(skill.selection.id);
        else this.leases.set(skill.selection.id, count);
      }
    };
  }
  public assertRemovable(id: string): void {
    if (this.leases.has(id))
      throw new SkillError('SKILL_BUSY', 'An active Run still owns this Skill');
  }
}
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
function isExists(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')
  );
}
