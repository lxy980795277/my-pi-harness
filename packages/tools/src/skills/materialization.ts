import { chmod, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillError } from './errors';
import {
  checkedSkillDirectory,
  prepareSkillDirectory,
  readSkillTree,
  resourceIndex,
  writeOwnedSkillFile,
} from './files';
import { parseSkill } from './parser';
import type { SkillCatalog } from './catalog';
import type {
  AssertSkillAuthorized,
  FrozenSkill,
  MaterializedSkillBinding,
  SkillCatalogOptions,
  SkillResourceLease,
} from './types';

interface Materialization {
  root: string;
  skills: readonly FrozenSkill[];
  bindings: readonly MaterializedSkillBinding[];
  references: number;
  revoked: boolean;
  cleanup: Promise<void> | undefined;
}

/** Resource copies contain no profile data and remain owned until the last Run or command releases them. */
export class SkillMaterializer {
  private closed = false;
  private readonly entries = new Set<Materialization>();
  public constructor(
    private readonly options: SkillCatalogOptions,
    private readonly catalog: SkillCatalog,
  ) {}

  public async materialize(
    skills: readonly FrozenSkill[],
    signal: AbortSignal,
    assertAuthorized: AssertSkillAuthorized,
  ): Promise<SkillResourceLease> {
    this.assertOpen();
    const accepted = structuredClone(skills);
    const identities = new Set<string>();
    for (const skill of accepted) {
      if (identities.has(skill.selection.id))
        throw new SkillError('SKILL_RESOURCE', 'A Skill resource binding cannot be duplicated');
      identities.add(skill.selection.id);
      await assertAuthorized(skill, signal);
      await this.catalog.verifySnapshot(skill, signal);
    }
    signal.throwIfAborted();
    this.assertOpen();
    const parent = resolve(
      this.options.materializationDirectory ??
        join(await realpath(tmpdir()), 'my-pi-harness-skill-resources'),
    );
    const protectedRoots = [
      this.options.snapshotDirectory,
      ...(this.options.protectedDirectories ?? []),
    ].map((path) => resolve(path));
    if (protectedRoots.some((path) => contains(path, parent) || contains(parent, path)))
      throw new SkillError(
        'SKILL_PATH',
        'Materialized Skill resources must be outside protected profile directories',
      );
    await prepareSkillDirectory(parent);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await checkedSkillDirectory(parent);
    const root = await mkdtemp(join(parent, 'lease-'));
    const bindings: MaterializedSkillBinding[] = [];
    const releaseBinding = this.catalog.retainBindings(accepted);
    try {
      for (const skill of accepted) {
        const directory = join(root, `${bindings.length}-${skill.selection.contentHash}`);
        await mkdir(directory, { mode: 0o700 });
        const files = await readSkillTree(
          join(this.options.snapshotDirectory, skill.selection.contentHash),
          signal,
        );
        for (const file of files) {
          const target = join(directory, file.path);
          await mkdir(dirname(target), { recursive: true, mode: 0o700 });
          await writeOwnedSkillFile(target, file.content, 0o400, signal);
        }
        await setDirectoryModes(directory, 0o500);
        bindings.push(
          Object.freeze({ selection: Object.freeze({ ...skill.selection }), directory }),
        );
      }
      await chmod(root, 0o500);
      signal.throwIfAborted();
      this.assertOpen();
      const entry: Materialization = {
        root,
        skills: accepted,
        bindings: Object.freeze(bindings),
        references: 1,
        revoked: false,
        cleanup: undefined,
      };
      this.entries.add(entry);
      const lease = this.lease(entry, assertAuthorized, releaseBinding);
      try {
        await lease.verify(signal);
        return lease;
      } catch (error) {
        await lease.release();
        throw error;
      }
    } catch (error) {
      releaseBinding();
      await removeMaterialization(root);
      throw error;
    }
  }

  public revoke(ids: ReadonlySet<string>): void {
    for (const entry of this.entries)
      if (entry.skills.some((skill) => ids.has(skill.selection.id))) entry.revoked = true;
  }

  public close(): void {
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new SkillError('SKILL_REVOKED', 'Skill resource service is closed');
  }

  private lease(
    entry: Materialization,
    assertAuthorized: AssertSkillAuthorized,
    releaseBinding: () => void,
  ): SkillResourceLease {
    let released = false;
    const assertActive = (): void => {
      this.assertOpen();
      if (released || entry.revoked || entry.references === 0)
        throw new SkillError('SKILL_REVOKED', 'Skill resource lease is released or revoked');
    };
    const verify = async (signal: AbortSignal): Promise<void> => {
      assertActive();
      for (const [index, skill] of entry.skills.entries()) {
        signal.throwIfAborted();
        await assertAuthorized(skill, signal);
        await this.catalog.verifySnapshot(skill, signal);
        const binding = entry.bindings[index];
        if (binding === undefined)
          throw new SkillError('SKILL_RESOURCE', 'Skill resource binding is missing');
        const files = await readSkillTree(binding.directory, signal);
        const main = files.find((file) => file.path === 'SKILL.md');
        if (main === undefined)
          throw new SkillError('SKILL_SNAPSHOT', 'Materialized Skill content is missing');
        const parsed = parseSkill(
          new TextDecoder('utf-8', { fatal: true }).decode(main.content),
          skill.name,
        );
        if (
          parsed.content !== skill.content ||
          parsed.description !== skill.description ||
          JSON.stringify(parsed.allowedTools) !== JSON.stringify(skill.allowedTools) ||
          JSON.stringify(resourceIndex(files)) !== JSON.stringify(skill.resources)
        )
          throw new SkillError('SKILL_SNAPSHOT', 'Materialized Skill resource verification failed');
      }
      signal.throwIfAborted();
      assertActive();
    };
    return Object.freeze({
      bindings: entry.bindings,
      readOnlyDirectories: Object.freeze(entry.bindings.map((binding) => binding.directory)),
      verify,
      retain: async (signal: AbortSignal): Promise<SkillResourceLease> => {
        await verify(signal);
        assertActive();
        entry.references += 1;
        return this.lease(entry, assertAuthorized, this.catalog.retainBindings(entry.skills));
      },
      release: async (): Promise<void> => {
        if (released) return await entry.cleanup;
        released = true;
        releaseBinding();
        entry.references -= 1;
        if (entry.references === 0) {
          this.entries.delete(entry);
          entry.cleanup = removeMaterialization(entry.root);
          await entry.cleanup;
        }
      },
    });
  }
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

async function setDirectoryModes(directory: string, mode: number): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (entry.isDirectory()) await setDirectoryModes(join(directory, entry.name), mode);
  await chmod(directory, mode);
}

async function removeMaterialization(directory: string): Promise<void> {
  try {
    await chmod(directory, 0o700);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  await setDirectoryModes(directory, 0o700);
  await rm(directory, { recursive: true, force: true });
}
