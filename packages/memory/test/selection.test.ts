import { describe, expect, it } from 'vitest';
import type { MemoryEntry } from '@my-pi-harness/protocol';
import type { MemoryRecallSnapshot, MemoryRecallCandidate } from '@my-pi-harness/protocol/internal';
import { selectMemories } from '../src/selection';
import { encodeMemoryBlock, decodeMemoryBlock } from '../src/snapshot';

function entry(
  id: string,
  mode: MemoryEntry['mode'] = 'relevant',
  body = `Confirmed fact ${id}`,
): MemoryEntry {
  return {
    id,
    mode,
    body,
    scope: { kind: 'user' },
    category: 'fact',
    revision: 1,
    enabled: true,
    source: { kind: 'manual' },
    createdAt: 1,
    updatedAt: 1,
  };
}

function snapshot(entries: MemoryEntry[]): MemoryRecallSnapshot {
  return {
    access: { ownerUserId: 'owner', workspaceId: null, includeUser: true },
    fingerprint: 'a'.repeat(64),
    settings: { allowUse: true, allowLearning: false, revision: 0 },
    fixed: entries.filter((item) => item.mode === 'fixed' && item.enabled),
    candidates: entries.map(({ id, revision, mode, scope, enabled }) => ({
      id,
      revision,
      mode,
      scope,
      enabled,
    })),
  };
}

function candidate(item: MemoryEntry, score: number): MemoryRecallCandidate {
  return { entry: item, relevanceScore: score };
}

describe('locally verified related memory selection', () => {
  it('preserves fixed facts and leaves unrelated TopK candidates unused', () => {
    const fixed = entry('fixed', 'fixed');
    const related = Array.from({ length: 12 }, (_, index) => entry(`related-${index}`));
    const selected = selectMemories(
      snapshot([fixed, ...related]),
      related.map((item, index) => candidate(item, 0.4 - index / 1000)),
      {
        query: 'A task unrelated to remembered preferences',
        mode: 'hybrid',
        verification: 'local-model',
      },
    );
    expect(selected.entries.map((item) => item.id)).toEqual(['fixed']);
    expect(selected.selection).toMatchObject({
      candidateCount: 12,
      matchedCount: 0,
      omittedCount: 12,
      verification: 'local-model',
    });
    expect(selected.selection?.omissions.every((item) => item.reason === 'below-threshold')).toBe(
      true,
    );
  });

  it('accepts each verified candidate at the fixed probability cutoff independently of its rivals', () => {
    const first = entry('a');
    const second = entry('b');
    const source = snapshot([first, second]);
    const rejected = selectMemories(source, [candidate(first, 0.499), candidate(second, 0.1)], {
      query: 'query',
      mode: 'hybrid',
      verification: 'local-model',
    });
    expect(rejected.entries).toEqual([]);
    const accepted = selectMemories(source, [candidate(first, 0.5), candidate(second, 0.51)], {
      query: 'query',
      mode: 'hybrid',
      verification: 'local-model',
      truncated: true,
    });
    expect(accepted.entries.map((item) => item.id)).toEqual(['b', 'a']);
    expect(accepted.selection).toMatchObject({ matchedCount: 2, omittedCount: 0 });
  });

  it('does not turn an exact phrase or incomplete model check into verified evidence', () => {
    const fact = entry(
      'fact',
      'relevant',
      '请用简洁中文回答，并使用 read_file 读取内容。 Database is SQLite.',
    );
    const source = snapshot([fact]);
    for (const query of ['简洁中文回答', 'read_file', 'Database is SQLite']) {
      const selected = selectMemories(source, [{ entry: fact }], {
        query,
        mode: 'lexical',
        verification: 'local-model',
      });
      expect(selected.entries).toEqual([]);
      expect(selected.selection?.omissions).toMatchObject([{ reason: 'unverified' }]);
    }
    for (const score of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1]) {
      const selected = selectMemories(source, [candidate(fact, score)], {
        query: 'query',
        mode: 'hybrid',
        verification: 'local-model',
      });
      expect(selected.entries).toEqual([]);
      expect(selected.selection?.omissions).toMatchObject([{ reason: 'unverified' }]);
    }
  });

  it('preserves fixed facts and explains unavailable or absent verification without accepting a score', () => {
    const fixed = entry('fixed', 'fixed');
    const fact = entry('fact');
    for (const verification of [undefined, 'unavailable'] as const) {
      const selected = selectMemories(snapshot([fixed, fact]), [candidate(fact, 1)], {
        query: 'query',
        mode: 'hybrid',
        ...(verification === undefined ? {} : { verification }),
      });
      expect(selected.entries.map((item) => item.id)).toEqual(['fixed']);
      expect(selected.selection).toMatchObject({
        verification: 'unavailable',
        matchedCount: 0,
        omissions: [{ id: 'fact', reason: 'unverified' }],
      });
    }
  });

  it('adopts successful pair checks while leaving skipped or failed pairs unverified', () => {
    const verified = entry('verified');
    const tooLong = entry('too-long', 'relevant', 'A'.repeat(16_000));
    const missing = entry('not-retrieved');
    const selected = selectMemories(
      snapshot([verified, tooLong, missing]),
      [candidate(verified, 0.7), { entry: tooLong }],
      { query: 'query', mode: 'hybrid', verification: 'local-model' },
    );
    expect(selected.entries.map((item) => item.id)).toEqual(['verified']);
    expect(selected.selection).toMatchObject({ matchedCount: 1, omittedCount: 2 });
    expect(selected.selection?.omissions).toMatchObject([
      { id: 'too-long', reason: 'unverified' },
      { id: 'not-retrieved', reason: 'not-retrieved' },
    ]);
  });

  it('rejects candidates from a different revision or scope and ignores IDs outside the snapshot', () => {
    const fact = entry('fact');
    const source = snapshot([fact]);
    const changed = { ...fact, revision: 2 };
    const selected = selectMemories(
      source,
      [candidate(changed, 0.99), candidate(entry('unknown'), 1)],
      { query: 'query', mode: 'hybrid', verification: 'local-model' },
    );
    expect(selected.entries).toEqual([]);
    expect(selected.selection?.omissions).toEqual([
      { id: 'fact', revision: 1, mode: 'relevant', reason: 'stale', score: 0.99 },
    ]);
    expect(
      selectMemories(
        source,
        [candidate({ ...fact, scope: { kind: 'workspace', workspaceId: 'other' } }, 1)],
        { query: 'query', mode: 'hybrid', verification: 'local-model' },
      ).entries,
    ).toEqual([]);
  });

  it('caps positive related adoption at eight and bounded explanation metadata without filling negative slots', () => {
    const facts = Array.from({ length: 120 }, (_, index) =>
      entry(`fact-${String(index).padStart(3, '0')}`),
    );
    const source = snapshot(facts);
    const selected = selectMemories(
      source,
      facts.map((fact) => candidate(fact, 0.95)),
      { query: 'query', mode: 'hybrid', verification: 'local-model' },
    );
    expect(selected.entries).toHaveLength(8);
    expect(selected.selection).toMatchObject({ matchedCount: 120, omittedCount: 112 });
    expect(selected.selection?.omissions).toHaveLength(32);
    expect(selectMemories(source, [], { query: 'query', mode: 'lexical' }).entries).toEqual([]);
  });

  it('keeps disabled and empty-query explanations outside the prompt body', () => {
    const fixed = entry('fixed', 'fixed');
    const fact = entry('fact');
    const source = snapshot([fixed, fact]);
    const selected = selectMemories(source, [], { query: '', mode: 'fixed' });
    expect(selected.selection?.omissions).toMatchObject([{ id: 'fact', reason: 'no-query' }]);
    expect(selected.selection?.verification).toBe('not-needed');
    const encoded = encodeMemoryBlock(selected);
    expect(encoded).not.toContain('omissions');
    expect(encoded).not.toContain('verification');
    expect(decodeMemoryBlock(encoded, { start: 0, end: encoded.length })).toEqual({
      fingerprint: selected.fingerprint,
      entries: selected.entries,
    });
    source.settings.allowUse = false;
    const disabled = selectMemories(source, [candidate(fact, 1)], {
      query: 'query',
      mode: 'hybrid',
    });
    expect(disabled.entries).toEqual([]);
    expect(disabled.selection).toMatchObject({
      retrieval: 'disabled',
      verification: 'not-needed',
      omittedCount: 2,
    });
  });
});
