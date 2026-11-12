import type { MemoryAdoptedEntry, MemoryOmission, MemorySelection } from '@my-pi-harness/protocol';
import type {
  MemoryRecallCandidate,
  MemoryRecallSnapshot,
  MemoryRequestSnapshot,
} from '@my-pi-harness/protocol/internal';

export interface MemorySelectionOptions {
  query: string;
  mode: 'fixed' | 'lexical' | 'hybrid';
  truncated?: boolean;
  verification?: MemorySelection['verification'];
}

const MIN_RELEVANCE_SCORE = 0.5;
const MAX_RELEVANT_ENTRIES = 8;
const MAX_OMISSIONS = 32;

/** Select positive evidence only; the runtime applies the remaining budget after preserving fixed facts. */
export function selectMemories(
  snapshot: MemoryRecallSnapshot,
  candidates: readonly MemoryRecallCandidate[],
  options: MemorySelectionOptions,
): MemoryRequestSnapshot {
  const enabled = snapshot.settings.allowUse;
  const related = snapshot.candidates.filter((key) => key.enabled && key.mode === 'relevant');
  const verification =
    enabled && options.query.trim() && related.length > 0
      ? (options.verification ?? 'unavailable')
      : 'not-needed';
  const selection: MemorySelection = {
    retrieval: enabled ? options.mode : 'disabled',
    candidateCount: related.length,
    matchedCount: 0,
    omittedCount: 0,
    omissions: [],
    verification,
    ...(options.truncated === undefined ? {} : { truncated: options.truncated }),
  };
  const entries: MemoryAdoptedEntry[] = enabled ? snapshot.fixed.map(adopt) : [];
  const keys = new Map(snapshot.candidates.map((key) => [key.id, key]));
  const retrieved = new Map<string, MemoryRecallCandidate>();
  for (const candidate of candidates) {
    const key = keys.get(candidate.entry.id);
    if (key === undefined || key.mode !== 'relevant' || !key.enabled) continue;
    const previous = retrieved.get(key.id);
    if (!previous || (relevance(candidate) ?? -1) > (relevance(previous) ?? -1))
      retrieved.set(key.id, candidate);
  }
  const passing: { candidate: MemoryRecallCandidate; score: number }[] = [];
  const rejected = new Map<string, MemoryOmission['reason']>();
  for (const key of related) {
    if (!enabled) {
      rejected.set(key.id, 'usage-disabled');
      continue;
    }
    if (!options.query.trim()) {
      rejected.set(key.id, 'no-query');
      continue;
    }
    if (verification !== 'local-model') {
      rejected.set(key.id, 'unverified');
      continue;
    }
    const candidate = retrieved.get(key.id);
    if (!candidate) {
      rejected.set(key.id, 'not-retrieved');
      continue;
    }
    if (
      candidate.entry.revision !== key.revision ||
      candidate.entry.mode !== key.mode ||
      !candidate.entry.enabled ||
      !sameScope(candidate.entry.scope, key.scope)
    ) {
      rejected.set(key.id, 'stale');
      continue;
    }
    const score = relevance(candidate);
    if (score === undefined) {
      rejected.set(key.id, 'unverified');
      continue;
    }
    if (score < MIN_RELEVANCE_SCORE) {
      rejected.set(key.id, 'below-threshold');
      continue;
    }
    passing.push({ candidate, score });
  }
  passing.sort(
    (left, right) =>
      right.score - left.score || left.candidate.entry.id.localeCompare(right.candidate.entry.id),
  );
  selection.matchedCount = passing.length;
  for (const [index, item] of passing.entries()) {
    if (index < MAX_RELEVANT_ENTRIES) entries.push(adopt(item.candidate.entry));
    else rejected.set(item.candidate.entry.id, 'limit');
  }
  for (const key of snapshot.candidates) {
    let reason: MemoryOmission['reason'] | undefined;
    if (!key.enabled) reason = 'disabled';
    else if (!enabled) reason = 'usage-disabled';
    else reason = rejected.get(key.id);
    if (reason === undefined) continue;
    selection.omittedCount += 1;
    if (selection.omissions.length < MAX_OMISSIONS) {
      const candidate = retrieved.get(key.id);
      const score = candidate === undefined ? undefined : relevance(candidate);
      selection.omissions.push({
        id: key.id,
        revision: key.revision,
        mode: key.mode,
        reason,
        ...(score !== undefined && Number.isFinite(score) ? { score } : {}),
      });
    }
  }
  return { fingerprint: snapshot.fingerprint, entries, selection };
}

function adopt(entry: MemoryRecallCandidate['entry']): MemoryAdoptedEntry {
  const { id, scope, category, body, revision, source, mode } = entry;
  return { id, scope, category, body, revision, source, mode };
}

function relevance(candidate: MemoryRecallCandidate): number | undefined {
  const score = candidate.relevanceScore;
  return score !== undefined && Number.isFinite(score) && score >= 0 && score <= 1
    ? score
    : undefined;
}

function sameScope(
  left: MemoryRecallCandidate['entry']['scope'],
  right: MemoryRecallCandidate['entry']['scope'],
): boolean {
  if (left.kind === 'user') return right.kind === 'user';
  return right.kind === 'workspace' && left.workspaceId === right.workspaceId;
}
