import type { FrozenSkill, WorkState } from '@my-pi-harness/protocol';
import type { SkillsPort } from './ports.js';

export interface SkillContextDiagnostic {
  id: string;
  name: string;
  reason: 'unavailable';
}

/** Compaction retains instruction provenance; reset and selected checkpoints discard abandoned tails. */
export function skillHistoryIds(
  ids: readonly string[],
  state: WorkState | undefined,
  compactionContextStart: string | null = null,
): readonly string[] {
  const marker = state?.contextStartAfterMessageId;
  if (marker === undefined || marker === null) return ids;
  const reset = ids.indexOf(marker);
  if (reset < 0) return ids;
  const covered = state?.compaction?.throughMessageId;
  const boundary = covered === undefined ? -1 : ids.indexOf(covered);
  if (boundary >= 0 && boundary <= reset) {
    const sourceStart =
      compactionContextStart === null ? 0 : ids.indexOf(compactionContextStart) + 1;
    return [...ids.slice(sourceStart, boundary + 1), ...ids.slice(reset + 1)];
  }
  return ids.slice(reset + 1);
}

/** Invalid historical bindings are described and omitted; fresh selections remain separately strict. */
export async function availableSkillHistory(
  candidates: readonly FrozenSkill[],
  current: readonly FrozenSkill[],
  port: SkillsPort | undefined,
  signal: AbortSignal,
): Promise<{ skills: readonly FrozenSkill[]; diagnostics: readonly SkillContextDiagnostic[] }> {
  const selected = new Set(current.map((skill) => skill.selection.id));
  const skills: FrozenSkill[] = [];
  const diagnostics: SkillContextDiagnostic[] = [];
  const remaining = 16 - selected.size;
  if (remaining <= 0) return { skills, diagnostics };
  const recent = candidates.slice(-remaining);
  for (const skill of recent) {
    signal.throwIfAborted();
    if (selected.has(skill.selection.id)) continue;
    try {
      if (port === undefined) throw new Error('Skill service unavailable');
      await port.validateBindings([skill], signal);
      port.assertBindingsCurrent([skill]);
      skills.push(skill);
      selected.add(skill.selection.id);
    } catch {
      signal.throwIfAborted();
      diagnostics.push({ id: skill.selection.id, name: skill.name, reason: 'unavailable' });
    }
  }
  return { skills, diagnostics };
}
