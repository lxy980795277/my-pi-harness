import { parseDocument } from 'yaml';
import { SkillError } from './errors.js';
import type { ParsedSkill } from './types.js';

/** Parse standard YAML frontmatter, rejecting aliases and malformed metadata. */
export function parseSkill(text: string, directoryName: string): ParsedSkill {
  if (Buffer.byteLength(text) > 131072)
    throw new SkillError('SKILL_TOO_LARGE', 'SKILL.md exceeds 128 KiB');
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(normalized);
  if (!match || match[1] === undefined || match[2] === undefined)
    throw new SkillError('SKILL_FORMAT', 'SKILL.md requires YAML frontmatter');
  const document = parseDocument(match[1], { uniqueKeys: true, strict: true });
  if (document.errors.length > 0 || document.warnings.length > 0)
    throw new SkillError('SKILL_FORMAT', 'Invalid or unsupported Skill YAML');
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (cause) {
    throw new SkillError('SKILL_FORMAT', 'Skill aliases are not supported', { cause });
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('name' in value) ||
    !('description' in value)
  )
    throw new SkillError('SKILL_FORMAT', 'Skill name and description are required');
  if (
    typeof value.name !== 'string' ||
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value.name) ||
    value.name.length > 64 ||
    value.name !== directoryName
  )
    throw new SkillError('SKILL_NAME', 'Skill name must match its directory');
  if (
    typeof value.description !== 'string' ||
    value.description.trim().length === 0 ||
    value.description.length > 1024
  )
    throw new SkillError('SKILL_DESCRIPTION', 'Skill description must contain 1–1024 characters');
  if (
    'compatibility' in value &&
    (typeof value.compatibility !== 'string' ||
      value.compatibility.length === 0 ||
      value.compatibility.length > 500)
  )
    throw new SkillError('SKILL_FORMAT', 'Skill compatibility must contain 1–500 characters');
  if (
    'license' in value &&
    (typeof value.license !== 'string' || value.license.trim().length === 0)
  )
    throw new SkillError('SKILL_FORMAT', 'Skill license must be a non-empty string');
  if ('metadata' in value) {
    if (
      typeof value.metadata !== 'object' ||
      value.metadata === null ||
      Array.isArray(value.metadata) ||
      Object.values(value.metadata).some((entry) => typeof entry !== 'string')
    )
      throw new SkillError('SKILL_FORMAT', 'Skill metadata must map keys to strings');
  }
  const content = match[2].trim();
  if (content.length === 0) throw new SkillError('SKILL_FORMAT', 'Skill instructions are empty');
  let allowedTools: string[] = [];
  if ('allowed-tools' in value) {
    if (typeof value['allowed-tools'] !== 'string')
      throw new SkillError('SKILL_FORMAT', 'allowed-tools must be a string');
    allowedTools = value['allowed-tools'].split(/\s+/).filter(Boolean);
    if (allowedTools.length > 128)
      throw new SkillError('SKILL_FORMAT', 'Skill declares too many tools');
  }
  return { name: value.name, description: value.description, content, allowedTools };
}
