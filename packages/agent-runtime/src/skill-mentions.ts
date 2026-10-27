import type { FrozenSkill } from '@my-pi-harness/protocol';
import type { SkillsPort } from './capability-ports.js';

/** Explicit invocations use a standalone lowercase $skill-name token in user-authored text. */
export function explicitSkillNames(text: string): ReadonlySet<string> {
  const result = new Set<string>();
  let offset = text.indexOf('$');
  while (offset !== -1) {
    const before = text[offset - 1];
    let end = offset + 1;
    while (end < text.length && /[a-z0-9-]/.test(text[end] ?? '')) end += 1;
    const name = text.slice(offset + 1, end);
    const after = text[end];
    if (
      (before === undefined || before === '(' || /\s/u.test(before)) &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) &&
      (after === undefined || !/[a-z0-9_-]/.test(after))
    )
      result.add(name);
    offset = text.indexOf('$', Math.max(end, offset + 1));
  }
  return result;
}

/** A mention activates exact enabled content, never filesystem or tool execution authority. */
export async function freezeSkillMentions(
  port: SkillsPort | undefined,
  workspaceId: string | null,
  text: string,
  signal: AbortSignal,
): Promise<readonly FrozenSkill[]> {
  signal.throwIfAborted();
  const names = explicitSkillNames(text);
  if (!port || names.size === 0) return [];
  const catalog = await port.list(workspaceId, signal);
  const selections = catalog
    .filter((skill) => skill.enabled && !skill.shadowed && names.has(skill.name))
    .map((skill) => ({ id: skill.id, contentHash: skill.contentHash }));
  if (selections.length === 0) return [];
  return await port.freezeSelections(workspaceId, selections, signal);
}
