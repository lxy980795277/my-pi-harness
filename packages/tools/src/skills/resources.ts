import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { SkillError } from './errors';
import {
  checkedSkillDirectory,
  readSkillFile,
  readSkillTree,
  skillHash,
  skillResourcePath,
} from './files';
import type { SkillDownloadFile, SkillResourceSources } from './types';

export type SkillResourceManifest = Static<typeof manifestSchema>;

const manifestName = 'resource-manifest.json';
const manifestSchema = Type.Object(
  {
    version: Type.Literal(1),
    dependencies: Type.Array(
      Type.Object(
        {
          source: Type.String({ minLength: 1, maxLength: 512 }),
          target: Type.String({ minLength: 1, maxLength: 512 }),
          hash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 255 },
    ),
  },
  { additionalProperties: false },
);

/** Dependency declarations contain safe relative identifiers, unique targets and exact hashes. */
export function parseSkillResourceManifest(source: Uint8Array): SkillResourceManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source));
  } catch (cause) {
    throw new SkillError('SKILL_MANIFEST', 'Skill resource manifest must contain UTF-8 JSON', {
      cause,
    });
  }
  if (!Value.Check(manifestSchema, parsed))
    throw new SkillError('SKILL_MANIFEST', 'Skill resource manifest is invalid');
  const targets = new Set<string>();
  for (const dependency of parsed.dependencies) {
    skillResourcePath(dependency.source);
    skillResourcePath(dependency.target);
    if (
      dependency.target === 'SKILL.md' ||
      dependency.target === manifestName ||
      targets.has(dependency.target)
    )
      throw new SkillError('SKILL_MANIFEST', 'Shared dependencies require unique resource targets');
    targets.add(dependency.target);
  }
  return parsed;
}

/** Resolve shared dependencies only for source trees; snapshots contain the copied dependency bytes. */
export async function readSkillSource(
  directory: string,
  signal: AbortSignal,
  resourceSources: SkillResourceSources = {},
): Promise<SkillDownloadFile[]> {
  const files = await readSkillTree(directory, signal);
  const manifest = files.find((file) => file.path === manifestName);
  if (manifest === undefined) return files;
  const parsed = parseSkillResourceManifest(manifest.content);
  const paths = new Set(files.map((file) => file.path));
  let total = files.reduce((sum, file) => sum + file.content.length, 0);
  for (const dependency of parsed.dependencies) {
    const source = Object.hasOwn(resourceSources, dependency.source)
      ? resourceSources[dependency.source]
      : undefined;
    if (source === undefined)
      throw new SkillError('SKILL_MANIFEST', 'Shared resource source is not registered');
    if (paths.has(dependency.target))
      throw new SkillError('SKILL_MANIFEST', 'Shared dependency overwrites a Skill resource');
    const root = await checkedSkillDirectory(source.directory);
    const bytes = await readSkillFile(root, source.path, signal);
    if (skillHash(bytes) !== dependency.hash)
      throw new SkillError('SKILL_CHANGED', 'Shared dependency does not match its declared hash');
    total += bytes.length;
    if (files.length >= 256 || total > 16 * 1024 * 1024)
      throw new SkillError(
        'SKILL_LIMIT',
        'Skill and shared resources exceed the file or byte limit',
      );
    files.push({ path: dependency.target, content: bytes });
    paths.add(dependency.target);
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
